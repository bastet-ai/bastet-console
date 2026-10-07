import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, stat } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { inventoryClient } from './client';
import { object, text } from './model';
export type Harness = {
    command: string;
    args: string[];
    env: Record<string, string>;
};
export function validateHarness(raw: unknown): Harness {
    const a = object(raw);
    if (!isAbsolute(text(a.command, 'harness command', 4096)) || !Array.isArray(a.args) || a.args.some((x: unknown) => typeof x !== 'string'))
        throw new Error('Harness requires an absolute executable and fixed argument array');
    const env = object(a.env ?? {});
    if (Object.entries(env).some(([k, v]) => typeof v !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) || /^(INVENTORY_|CONSOLE_|HACKERONE_|BOUNTY_|PG|DATABASE_|JWT_)/i.test(k)))
        throw new Error('Harness environment must not contain control-plane credentials');
    return { command: a.command, args: a.args, env };
}
function stop(child: ChildProcess) {
    if (child.pid) {
        try {
            process.kill(-child.pid, 'SIGKILL');
        }
        catch {
            child.kill('SIGKILL');
        }
    }
}
export async function executeHarness(harness: Harness, workdir: string, task: Record<string, any>, signal?: AbortSignal) {
    // The control token and lease are kept in the supervisor, never task.json or
    // the child environment. Harness configuration is operator-controlled only.
    const { lease_token, attempt, lease_seconds, ...job } = task;
    await writeFile(join(workdir, 'task.json'), JSON.stringify(job, null, 2), { mode: 0o600 });
    const child = spawn(harness.command, [...harness.args, join(workdir, 'task.json'), join(workdir, 'result.json')], {
        cwd: workdir, env: { PATH: '/usr/local/bin:/usr/bin:/bin', LANG: 'C.UTF-8', ...harness.env } as unknown as NodeJS.ProcessEnv, shell: false, detached: true, stdio: 'ignore',
    });
    const abort = () => stop(child), timer = setTimeout(abort, task.budget_minutes * 60000);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted)
        abort();
    try {
        await new Promise<void>((resolve, reject) => { child.once('error', reject); child.once('exit', (code) => code === 0 ? resolve() : reject(new Error('Harness stopped or failed'))); });
        if (signal?.aborted)
            throw new Error('Research lease lost');
        const path = join(workdir, 'result.json');
        if ((await stat(path)).size > 120000)
            throw new Error('Research result too large');
        const result = object(JSON.parse(await readFile(path, 'utf8')));
        text(result.summary, 'research summary', 32000);
        if (!['candidate', 'negative', 'inconclusive'].includes(result.outcome))
            throw new Error('Invalid research outcome');
        if (result.source_revision !== task.source_revision)
            throw new Error('Research result must attest the requested source revision');
        return result;
    }
    finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        stop(child);
    }
}
export async function researchWorker() {
    process.umask(0o077);
    const configPath = text(process.env.INVENTORY_HARNESS_CONFIG, 'harness configuration', 4096);
    const metadata = await stat(configPath);
    if (metadata.mode & 0o077)
        throw new Error('Harness configuration must be accessible only to its owner');
    const harness = validateHarness(JSON.parse(await readFile(configPath, 'utf8')));
    const campaign = text(process.env.INVENTORY_CAMPAIGN_ID, 'campaign ID'), root = text(process.env.INVENTORY_RESEARCH_DIR, 'research directory', 4096);
    const send = inventoryClient(process.env.INVENTORY_API_URL!, process.env.INVENTORY_WORKER_TOKEN!);
    await mkdir(root, { recursive: true, mode: 0o700 });
    let stopping = false, active: AbortController | undefined;
    const stopWorker = () => { stopping = true; active?.abort(); };
    process.once('SIGTERM', stopWorker);
    process.once('SIGINT', stopWorker);
    try {
        do {
            let task: Record<string, any> | null;
            try {
                task = await send({ action: 'claim', campaign_id: campaign });
            }
            catch {
                console.error(JSON.stringify({ event: 'research_claim_failed' }));
                if (!process.argv.includes('--watch'))
                    throw new Error('Research claim failed');
                await delay(10000);
                continue;
            }
            if (!task) {
                if (!process.argv.includes('--watch'))
                    return;
                await delay(10000);
                continue;
            }
            const controller = new AbortController();
            active = controller;
            const lease = { campaign_id: campaign, task_id: task.id, attempt: task.attempt, lease_token: task.lease_token };
            const workdir = await mkdtemp(join(root, `research-${task.id}-${task.attempt}-`));
            let heartbeatBusy = false;
            const heartbeat = setInterval(() => { if (heartbeatBusy)
                return; heartbeatBusy = true; send({ action: 'heartbeat', ...lease }).catch(() => controller.abort()).finally(() => { heartbeatBusy = false; }); }, 60000);
            try {
                const result = await executeHarness(harness, workdir, task, active.signal);
                await send({ action: 'complete', ...lease, result });
                console.log(JSON.stringify({ event: 'research_completed', task_id: task.id }));
            }
            catch {
                // No stale lease may publish a result. Local outputs remain for recovery.
                if (!active.signal.aborted)
                    await send({ action: 'fail', ...lease, result: { summary: 'Harness failed or timed out; retained run artifacts require operator review' } }).catch(() => { });
                console.error(JSON.stringify({ event: 'research_attempt_failed', task_id: task.id }));
            }
            finally {
                clearInterval(heartbeat);
                active = undefined;
            }
        } while (!stopping && process.argv.includes('--watch'));
    }
    finally {
        process.removeListener('SIGTERM', stopWorker);
        process.removeListener('SIGINT', stopWorker);
    }
}
