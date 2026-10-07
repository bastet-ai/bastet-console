import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createApiServer } from '../src/server/api-server';
import { inventoryClient } from '../src/server/inventory/client';
import { reconFingerprints } from '../src/server/inventory/recon';
import { executeHarness, validateHarness } from '../src/server/inventory/research-runner';
import { PGlite } from '@electric-sql/pglite';
import { InventoryStore, type Storage } from '../src/server/inventory/store';
import { canonicalAsset, hash, technology } from '../src/server/inventory/model';
import { matchAdvisory, validateAdvisory, fetchPackageAdvisories, type OSV } from '../src/server/inventory/advisories';
const advisory: OSV = { id: 'TEST-2026-1', modified: '2026-10-01T00:00:00Z', summary: 'Synthetic vulnerability', affected: [{
            package: { ecosystem: 'npm', name: 'next' }, ranges: [{ type: 'SEMVER', events: [{ introduced: '14.0.0' }, { fixed: '14.2.9' }, { introduced: '15.0.0' }, { last_affected: '15.0.3' }] }],
        }] };
const fingerprint = { ecosystem: 'npm', name: 'next', version: '14.2.8' };
test('OSV matching handles fixed boundaries, disjoint branches, prereleases and uncertainty', () => {
    for (const [version, state] of [['14.2.8', 'affected_version'], ['14.2.9', 'not_affected'], ['14.3.0', 'not_affected'], ['15.0.3', 'affected_version'], ['15.0.4', 'not_affected'], ['14.2.9-rc.1', 'affected_version'], ['unknown', 'possible']])
        assert.equal(matchAdvisory(advisory, { ...fingerprint, version }).state, state, version);
    assert.equal(matchAdvisory(advisory, { ...fingerprint, version: null }).state, 'possible');
    assert.equal(matchAdvisory(advisory, { ...fingerprint, version: null, version_range: '>=14.2.0 <14.3.0' }).state, 'possible');
    assert.equal(matchAdvisory(advisory, { ...fingerprint, version: null, version_range: '>=16' }).state, 'not_affected');
    assert.equal(matchAdvisory({ ...advisory, withdrawn: '2026-10-02T00:00:00Z' }, fingerprint).state, 'withdrawn');
    const unsupported = structuredClone(advisory);
    unsupported.affected[0].ranges![0].type = 'GIT';
    assert.equal(matchAdvisory(unsupported, fingerprint).state, 'possible');
    const malformed = structuredClone(advisory);
    malformed.affected[0].ranges![0].events = [{ fixed: '14.2.9' }];
    assert.equal(matchAdvisory(malformed, fingerprint).state, 'possible');
    assert.throws(() => validateAdvisory({ ...advisory, affected: [{ package: { ecosystem: 'npm', name: 'next' }, ranges: [{ type: 'SEMVER', events: [{ introduced: '0', fixed: '14.0.0' }] }] }] }));
});
test('canonical assets support WebSocket endpoints and never guess unknown package identities', () => {
    assert.deepEqual(canonicalAsset({ kind: 'url', value: 'wss://EXAMPLE.test:443/chat' }), { kind: 'url', value: 'wss://example.test/chat', subtype: 'websocket' });
    for (const value of ['https://user:secret@example.test', 'https://example.test/?token=secret', 'javascript:alert(1)'])
        assert.throws(() => canonicalAsset({ kind: 'url', value }));
    assert.deepEqual(technology('Next.js:14.2.8'), { ecosystem: 'npm', name: 'next', version: '14.2.8' });
    assert.deepEqual(technology('Custom service'), { ecosystem: 'Product', name: 'Custom service', version: null });
    assert.notEqual(hash(new Date(0)), hash(new Date(1)));
});
test('OSV pagination sends only component identity and refuses incomplete traversal', async () => {
    const bodies: any[] = [];
    const mock = async (url: any, options: any) => {
        assert.equal(url, 'https://api.osv.dev/v1/query');
        assert.equal(options.redirect, 'error');
        bodies.push(JSON.parse(options.body));
        return Response.json(bodies.length === 1 ? { vulns: [advisory], next_page_token: 'next' } : { vulns: [] });
    };
    assert.equal((await fetchPackageAdvisories('npm', 'next', mock as typeof fetch)).length, 1);
    assert.deepEqual(bodies, [{ package: { ecosystem: 'npm', name: 'next' } }, { package: { ecosystem: 'npm', name: 'next' }, page_token: 'next' }]);
    await assert.rejects(fetchPackageAdvisories('npm', 'next', (async () => Response.json({ next_page_token: 'same' })) as typeof fetch), /Repeated/);
});
test('recon bridge is replayable, preserves provenance and leaves versionless detections unknown', () => {
    const raw = { tool: 'httpx', tool_version: 'synthetic', target: 'https://example.test/', ts: '2026-10-01T00:00:00Z', scope_proof: 'synthetic-blob', evidence: { tech: ['Next.js:14.2.8', 'React', 'PrivateProduct'] } };
    const rows = reconFingerprints(raw, 'deployment');
    assert.equal(rows[0].version, '14.2.8');
    assert.equal(rows[0].confidence, 0.7);
    assert.equal(rows[1].version, null);
    assert.equal(rows[2].allow_advisory_lookup, false);
    assert.equal(rows[0].event_key, reconFingerprints(raw, 'deployment')[0].event_key);
    assert.equal(rows[0].evidence.scope_proof, 'synthetic-blob');
    assert.deepEqual(reconFingerprints({ ...raw, tool: 'nuclei' }, 'deployment'), []);
});
test('research supervisor uses fixed argv, excludes control credentials and validates source attestation', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'inventory-harness-'));
    const script = join(dir, 'synthetic.cjs');
    try {
        await writeFile(script, `const fs=require('node:fs');const job=JSON.parse(fs.readFileSync(process.argv[2]));if(process.env.INVENTORY_WORKER_TOKEN||job.lease_token)process.exit(9);fs.writeFileSync(process.argv[3],JSON.stringify({summary:'Synthetic source review',outcome:'negative',source_revision:job.source_revision}));`);
        const config = validateHarness({ command: process.execPath, args: [script] });
        assert.throws(() => validateHarness({ command: 'sh', args: [] }));
        assert.throws(() => validateHarness({ command: process.execPath, args: [], env: { CONSOLE_SERVICE_KEY: 'denied' } }));
        const result = await executeHarness(config, dir, { id: 'test', budget_minutes: 1, source_revision: 'a'.repeat(40), lease_token: 'private-control-token', hypothesis: '$(must not execute)' });
        assert.equal(result.outcome, 'negative');
        const controller = new AbortController();
        controller.abort();
        await assert.rejects(executeHarness(config, dir, { budget_minutes: 1 }, controller.signal));
    }
    finally {
        await rm(dir, { recursive: true, force: true });
    }
});
test('PostgreSQL inventory enforces history, tenant access, matching, review freshness and fenced research leases', async (t) => {
    const db = new PGlite();
    try {
        await db.exec(await readFile('migrations/postgres/0001_console.sql', 'utf8'));
        await db.exec('CREATE ROLE console_api');
        await db.exec(await readFile('migrations/postgres/0002_inventory.sql', 'utf8'));
        for (const u of ['owner', 'watcher', 'other'])
            await db.query('INSERT INTO console.users(id,email,name,google_id) VALUES($1,$2,$1,$1)', [u, `${u}@example.test`]);
        await db.exec("INSERT INTO console.campaigns(id,name,scope,owner_id) VALUES('c1','Synthetic A','example.test','owner'),('c2','Synthetic B','other.test','other'); INSERT INTO console.campaign_members(id,campaign_id,user_id,role) VALUES('m','c1','watcher','watcher')");
        const storage: Storage = { query: (s, v) => db.query(s, v), transaction: fn => db.transaction(q => fn(q as any)) };
        const store = new InventoryStore(storage), actor = { userId: 'owner' };
        const dep = await store.createDeployment(actor, 'c1', { name: 'Synthetic app', assets: [{ kind: 'url', value: 'wss://example.test/chat' }] });
        const old = new Date(Date.now() - 60000).toISOString(), now = new Date().toISOString();
        const input = { ...fingerprint, deployment_id: dep.id, source_key: 'manifest', method: 'package manifest', confidence: 1, evidence: { artifact_sha256: 'a'.repeat(64) }, observed_at: old, event_key: 'e1' };
        await t.test('membership and least privilege', async () => {
            await assert.rejects(store.createDeployment({ userId: 'watcher' }, 'c1', { name: 'denied' }), /access denied/);
            await assert.rejects(store.history({ userId: 'other' }, 'c1', dep.id), /access denied/);
            assert.equal((await store.overview('other')).deployments.length, 0);
            const worker = await store.issueToken(actor, 'c1', { name: 'read only', capabilities: ['read'] });
            await assert.rejects(store.fingerprint({ token: worker.token }, 'c1', input), /capability denied/);
            await assert.rejects(store.events({ token: worker.token }, 'c2', '0'), /capability denied/);
            await store.revokeToken(actor, 'c1', worker.id);
            await assert.rejects(store.events({ token: worker.token }, 'c1', '0'), /capability denied/);
        });
        await t.test('idempotent immutable evidence and late arrival', async () => {
            const first = await store.fingerprint(actor, 'c1', input);
            assert.deepEqual(await store.fingerprint(actor, 'c1', input), { id: first.id, replayed: true });
            await assert.rejects(store.fingerprint(actor, 'c1', { ...input, version: '14.2.7' }), /different evidence/);
            await store.fingerprint(actor, 'c1', { ...input, event_key: 'late', observed_at: new Date(Date.now() - 120000).toISOString(), version: '14.0.0' });
            assert.equal((await store.overview('owner')).fingerprints[0].version, '14.2.8');
            await assert.rejects(db.query('UPDATE inventory.fingerprints SET confidence=0'), /append-only/);
            await assert.rejects(db.query("DELETE FROM console.campaigns WHERE id='c1'"), /foreign key/);
            await assert.rejects(store.fingerprint(actor, 'c1', { ...input, event_key: 'no', presence: 'absent' }), /explicit evidence/);
            await assert.rejects(store.events(actor, 'c1', '9999999999999999999'), /cursor/);
        });
        await t.test('advisory changes immediately match all observed deployments', async () => {
            await store.saveAdvisory(advisory);
            let view = await store.overview('owner'), a = view.assessments[0];
            assert.equal(a.match_state, 'affected_version');
            await store.review(actor, 'c1', { assessment_id: a.id, input_hash: a.input_hash, verdict: 'not_affected', reason: 'Synthetic backport evidence', evidence: { patch: 'synthetic' } });
            await store.fingerprint(actor, 'c1', { ...input, event_key: 'refresh', observed_at: now });
            view = await store.overview('owner');
            assert.equal(view.assessments[0].review.verdict, 'not_affected');
            await store.fingerprint(actor, 'c1', { ...input, event_key: 'upgrade', observed_at: new Date(Date.now() + 1000).toISOString(), version: '14.2.9' });
            view = await store.overview('owner');
            assert.equal(view.assessments[0].match_state, 'not_affected');
            assert.equal(view.assessments[0].review, null);
            await assert.rejects(store.review(actor, 'c1', { assessment_id: a.id, input_hash: a.input_hash, verdict: 'confirmed', reason: 'stale' }), /changed/);
            const correction = structuredClone(advisory);
            correction.modified = '2026-10-02T00:00:00Z';
            correction.affected[0].ranges![0].events = [{ introduced: '0' }, { fixed: '14.3.0' }];
            await store.saveAdvisory(correction);
            assert.equal((await store.overview('owner')).assessments[0].match_state, 'affected_version');
            await store.saveAdvisory({ ...correction, modified: '2026-10-03T00:00:00Z', affected: [] });
            assert.equal((await store.overview('owner')).assessments[0].match_state, 'not_affected');
            await store.saveAdvisory(advisory);
            assert.equal((await store.overview('owner')).assessments[0].match_state, 'not_affected');
            await store.saveAdvisory({ ...correction, modified: '2026-10-04T00:00:00Z', withdrawn: '2026-10-04T00:00:00Z' });
            assert.equal((await store.overview('owner')).assessments[0].match_state, 'withdrawn');
            const events = await store.events(actor, 'c1', '0');
            assert.ok(events.events.some(e => e.kind === 'component.changed'));
            assert.equal((await store.events(actor, 'c1', events.next_cursor)).events.length, 0);
        });
        await t.test('research authorization, retries, lease fencing and reusable results', async () => {
            const release = (await store.overview('owner')).fingerprints[0].release_id;
            const request = { release_id: release, hypothesis: 'Inspect parsing of synthetic inputs', source_revision: 'a'.repeat(40), source_url: 'https://github.com/example/synthetic', budget_minutes: 5 };
            const task = await store.research(actor, 'c1', request);
            assert.equal((await store.research(actor, 'c1', request)).id, task.id);
            await assert.rejects(store.research({ userId: 'watcher' }, 'c1', request), /access denied/);
            await assert.rejects(store.claim(actor, 'c1'), /scoped worker token/);
            const token = await store.issueToken(actor, 'c1', { name: 'synthetic researcher', capabilities: ['research'] });
            const worker = { token: token.token };
            const lease = await store.claim(worker, 'c1');
            assert.equal(lease!.mode, 'source_only');
            assert.equal('assets' in lease!, false);
            assert.equal(await store.claim(worker, 'c1'), null);
            await db.query("UPDATE inventory.research_tasks SET lease_until=now()-interval '1 second' WHERE id=$1", [task.id]);
            const next = await store.claim(worker, 'c1');
            assert.equal(next!.attempt, 2);
            await assert.rejects(store.researchAction(worker, 'c1', { ...lease, task_id: task.id, action: 'complete', result: { summary: 'stale', outcome: 'negative' } }), /stale/);
            await store.researchAction(worker, 'c1', { ...next, task_id: task.id, action: 'heartbeat' });
            await store.researchAction(worker, 'c1', { ...next, task_id: task.id, action: 'complete', result: { summary: 'Synthetic result', source_revision: 'a'.repeat(40), outcome: 'inconclusive', artifacts: ['sha256:synthetic'] } });
            const view = await store.overview('owner');
            assert.equal(view.tasks[0].state, 'completed');
            assert.equal(view.tasks[0].result.outcome, 'inconclusive');
        });
        await t.test('uncertain, stale and conflicting sources remain possible; all history is pageable', async () => {
            await store.saveAdvisory({ ...advisory, id: 'TEST-UNCERTAINTY' });
            const uncertain = await store.createDeployment(actor, 'c1', { name: 'Uncertain app' });
            await store.fingerprint(actor, 'c1', { ...input, deployment_id: uncertain.id, event_key: 'unknown', version: null });
            let view: any = await store.overview('owner');
            assert.equal(view.assessments.find((a: any) => a.deployment_id === uncertain.id && a.advisory_id === 'TEST-UNCERTAINTY').match_state, 'possible');
            const stale = await store.createDeployment(actor, 'c1', { name: 'Stale app' });
            await store.fingerprint(actor, 'c1', { ...input, deployment_id: stale.id, event_key: 'stale', version: '99.0.0', observed_at: new Date(Date.now() - 8 * 86400000).toISOString() });
            view = await store.overview('owner');
            assert.equal(view.assessments.find((a: any) => a.deployment_id === stale.id && a.advisory_id === 'TEST-UNCERTAINTY').match_state, 'possible');
            await store.fingerprint(actor, 'c1', { ...input, event_key: 'conflicting-source', source_key: 'header' });
            view = await store.overview('owner');
            assert.equal(view.assessments.find((a: any) => a.deployment_id === dep.id && a.advisory_id === 'TEST-UNCERTAINTY').match_state, 'possible');
            const rows = await store.history(actor, 'c1', dep.id);
            assert.ok(rows.records.length > 1);
            assert.ok(rows.records[0].recorded_by);
            assert.ok((await store.history(actor, 'c1', dep.id, 'assessments')).records.length > 1);
            await assert.rejects(store.history(actor, 'c1', dep.id, 'fingerprints', 'bad'), /cursor/);
            // PostgreSQL has microsecond timestamp precision; a JS Date cursor would
            // silently skip rows within the same millisecond.
            const paged = await store.createDeployment(actor, 'c1', { name: 'Pagination fixture' });
            await db.query(`INSERT INTO inventory.fingerprints(id,campaign_id,deployment_id,component_id,release_id,version_range,presence,source_key,method,confidence,evidence,observed_at,received_at,event_key,input_hash,state_hash,recorded_by)
        SELECT 'page-'||n,'c1',$1,component_id,release_id,version_range,presence,source_key,method,confidence,evidence,observed_at,
          '2026-10-01T00:00:00Z'::timestamptz+n*interval '1 microsecond','page-'||n,input_hash,state_hash,recorded_by
        FROM inventory.fingerprints CROSS JOIN generate_series(1,110) n WHERE event_key='e1'`, [paged.id]);
            const page1 = await store.history(actor, 'c1', paged.id);
            const page2 = await store.history(actor, 'c1', paged.id, 'fingerprints', page1.next_cursor!);
            assert.equal(page1.records.length, 100);
            assert.equal(page2.records.length, 10);
            assert.equal(page2.next_cursor, null);
            assert.equal(new Set([...page1.records, ...page2.records].map(r => r.id)).size, 110);
        });
        await t.test('real HTTP route separates service authentication and campaign worker capabilities', async () => {
            const serviceKey = 's'.repeat(40), debugKey = 'd'.repeat(40);
            const server = createApiServer({ database: {} as any, inventory: store, serviceKey, debugKey, debugUserId: 'owner' });
            server.listen(0, '127.0.0.1');
            await once(server, 'listening');
            const endpoint = `http://127.0.0.1:${(server.address() as any).port}/api/inventory`;
            try {
                assert.equal((await fetch(endpoint)).status, 401);
                assert.equal((await fetch(endpoint, { headers: { 'x-console-service-key': serviceKey } })).status, 401);
                const response = await fetch(endpoint, { headers: { 'x-console-service-key': serviceKey, 'x-console-debug-key': debugKey } });
                assert.equal(response.status, 200);
                assert.equal((await response.json() as any).configured, true);
                const token = await store.issueToken(actor, 'c1', { name: 'HTTP ingestion', capabilities: ['ingest'] });
                const workerFetch: typeof fetch = (url, options) => fetch(url, { ...options, headers: { ...options?.headers, 'x-console-service-key': serviceKey } });
                const client = inventoryClient(endpoint, token.token, workerFetch);
                const created = await client({ action: 'deployment', campaign_id: 'c1', name: 'HTTP-created app' });
                assert.equal(created!.name, 'HTTP-created app');
                await assert.rejects(client({ action: 'deployment', campaign_id: 'c2', name: 'denied' }), /403/);
                await assert.rejects(client({ action: 'issue_token', campaign_id: 'c1', name: 'elevate', capabilities: ['research'] }), /403/);
                assert.equal((await fetch(endpoint, { headers: { 'x-console-service-key': serviceKey, Authorization: `Bearer ${token.token}` } })).status, 403);
                assert.equal((await fetch(endpoint.replace('/inventory', '/campaigns'), { headers: { 'x-console-service-key': serviceKey, Authorization: `Bearer ${token.token}` } })).status, 401);
            }
            finally {
                await new Promise<void>(resolve => server.close(() => resolve()));
            }
        });
        await t.test('runtime DB grants allow ingestion but prohibit evidence mutation', async () => {
            await db.exec('GRANT USAGE ON SCHEMA console TO console_api; GRANT SELECT ON ALL TABLES IN SCHEMA console TO console_api; SET ROLE console_api');
            assert.equal((await db.query('SELECT count(*) FROM inventory.fingerprints')).rows.length, 1);
            await assert.rejects(db.query('DELETE FROM inventory.events'), /permission denied/);
            await db.exec('RESET ROLE');
        });
    }
    finally {
        await db.close();
    }
});
