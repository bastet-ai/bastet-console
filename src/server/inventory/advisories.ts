import semver from 'semver';
import { componentIdentity, hash, InventoryError, object, text } from './model';
export interface OSV {
    id: string;
    modified: string;
    published?: string;
    withdrawn?: string;
    aliases?: string[];
    summary?: string;
    affected: {
        package: {
            ecosystem: string;
            name: string;
            purl?: string;
        };
        versions?: string[];
        ranges?: {
            type: string;
            events: {
                introduced?: string;
                fixed?: string;
                last_affected?: string;
                limit?: string;
            }[];
        }[];
    }[];
    references?: {
        type: string;
        url: string;
    }[];
}
export function validateAdvisory(value: unknown): OSV {
    const a = object(value, 'OSV advisory');
    if (Buffer.byteLength(JSON.stringify(a)) > 2 * 1024 * 1024 || !Array.isArray(a.affected) || a.affected.length > 2000)
        throw new InventoryError(400, 'Invalid or oversized OSV advisory');
    text(a.id, 'advisory ID', 200);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]+$/.test(a.id) || !Number.isFinite(Date.parse(a.modified)))
        throw new InventoryError(400, 'Invalid advisory identity or modification time');
    if (a.withdrawn && !Number.isFinite(Date.parse(a.withdrawn)))
        throw new InventoryError(400, 'Invalid withdrawal date');
    for (const entry of a.affected) {
        object(entry);
        const p = object(entry.package);
        componentIdentity(p.ecosystem, p.name);
        if (entry.versions && (!Array.isArray(entry.versions) || entry.versions.some((v: unknown) => typeof v !== 'string')))
            throw new InventoryError(400, 'Invalid affected versions');
        if (entry.ranges && (!Array.isArray(entry.ranges) || entry.ranges.some((r: any) => !r || typeof r.type !== 'string' || !Array.isArray(r.events) || r.events.some((e: any) => !e || typeof e !== 'object' || Object.keys(e).length !== 1 || !['introduced', 'fixed', 'last_affected', 'limit'].includes(Object.keys(e)[0]) || typeof Object.values(e)[0] !== 'string'))))
            throw new InventoryError(400, 'Invalid affected ranges');
    }
    return a as OSV;
}
type Match = 'affected_version' | 'possible' | 'not_affected' | 'withdrawn';
// Explicit OSV interval comparison includes prereleases and handles multiple
// release branches. Unsupported version schemes remain unknown, never "safe".
function intervals(range: OSV['affected'][number]['ranges'] extends (infer R)[] | undefined ? R : never): string[] | null {
    let lower: string | null = null, open = false;
    const result: string[] = [];
    for (const e of range.events) {
        if (e.introduced !== undefined) {
            if (open || (e.introduced !== '0' && !semver.valid(e.introduced)))
                return null;
            lower = e.introduced === '0' ? null : e.introduced;
            open = true;
        }
        else {
            const upper = e.fixed ?? e.last_affected ?? e.limit;
            if (!open || !upper || !semver.valid(upper) || (lower && semver.gt(lower, upper)))
                return null;
            result.push([lower ? `>=${lower}` : '', `${e.last_affected !== undefined ? '<=' : '<'}${upper}`].filter(Boolean).join(' '));
            open = false;
            lower = null;
        }
    }
    if (open)
        result.push(lower ? `>=${lower}` : '*');
    return result.length ? result : null;
}
export function matchAdvisory(advisory: OSV, fingerprint: {
    ecosystem: string;
    name: string;
    version?: string | null;
    version_range?: string | null;
    presence?: string;
}): {
    state: Match;
    reason: string;
} {
    if (advisory.withdrawn)
        return { state: 'withdrawn', reason: 'The source advisory has been withdrawn.' };
    const identity = componentIdentity(fingerprint.ecosystem, fingerprint.name);
    const entries = advisory.affected.filter(a => componentIdentity(a.package.ecosystem, a.package.name).id === identity.id);
    if (!entries.length)
        return { state: 'not_affected', reason: 'This advisory does not identify this component.' };
    if (fingerprint.presence === 'absent')
        return { state: 'not_affected', reason: 'Explicit absence was observed by this source; other sources are evaluated separately.' };
    if (!fingerprint.version && !fingerprint.version_range)
        return { state: 'possible', reason: 'The component is present, but its version is unknown.' };
    let uncertain = false;
    for (const entry of entries) {
        if (fingerprint.version && entry.versions?.includes(fingerprint.version))
            return { state: 'affected_version', reason: 'The observed version is explicitly listed by the advisory; application exploitability is unverified.' };
        const ranges = entry.ranges ?? [];
        if (!ranges.length && !entry.versions?.length)
            uncertain = true;
        for (const r of ranges) {
            if (r.type !== 'SEMVER' && !(r.type === 'ECOSYSTEM' && identity.ecosystem === 'npm')) {
                uncertain = true;
                continue;
            }
            const rs = intervals(r);
            if (!rs) {
                uncertain = true;
                continue;
            }
            if (fingerprint.version) {
                if (!semver.valid(fingerprint.version)) {
                    uncertain = true;
                    continue;
                }
                if (rs.some(x => semver.satisfies(fingerprint.version!, x, { includePrerelease: true })))
                    return { state: 'affected_version', reason: 'The observed version matches an affected range; application exploitability is unverified.' };
            }
            else {
                if (!semver.validRange(fingerprint.version_range!)) {
                    uncertain = true;
                    continue;
                }
                if (rs.some(x => semver.intersects(fingerprint.version_range!, x, { includePrerelease: true })))
                    return { state: 'possible', reason: 'The estimated version range overlaps an affected range.' };
            }
        }
        if (fingerprint.version_range && entry.versions?.length) {
            if (!semver.validRange(fingerprint.version_range) || entry.versions.some(v => !semver.valid(v)))
                uncertain = true;
            else if (entry.versions.some(v => semver.satisfies(v, fingerprint.version_range!, { includePrerelease: true })))
                return { state: 'possible', reason: 'An affected version is inside the estimated range.' };
        }
    }
    return uncertain ? { state: 'possible', reason: 'The version scheme or advisory range cannot be resolved by this matcher.' }
        : { state: 'not_affected', reason: 'The observed version is outside the advisory’s declared affected versions/ranges.' };
}
const API = 'https://api.osv.dev';
export async function osvRequest(path: string, body?: unknown, fetchImpl = fetch): Promise<any> {
    // No target host, deployment identifier, credentials or evidence leaves here.
    const response = await fetchImpl(`${API}${path}`, { method: body ? 'POST' : 'GET',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: AbortSignal.timeout(30000) });
    if (!response.ok || !response.body)
        throw new Error('OSV request failed');
    let size = 0;
    const chunks: Uint8Array[] = [];
    const reader = response.body.getReader();
    try {
        for (;;) {
            const { value, done } = await reader.read();
            if (done)
                break;
            size += value.length;
            if (size > 8 * 1024 * 1024)
                throw new Error('OSV response too large');
            chunks.push(value);
        }
    }
    catch (e) {
        await reader.cancel();
        throw e;
    }
    finally {
        reader.releaseLock();
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export async function fetchPackageAdvisories(ecosystem: string, name: string, fetchImpl = fetch) {
    const result: OSV[] = [], tokens = new Set<string>();
    let token: string | undefined;
    for (let page = 0; page < 100; page++) {
        const data = object(await osvRequest('/v1/query', { package: { ecosystem, name }, ...(token ? { page_token: token } : {}) }, fetchImpl));
        if (data.vulns !== undefined && !Array.isArray(data.vulns))
            throw new Error('Invalid OSV page');
        for (const vuln of data.vulns ?? [])
            result.push(validateAdvisory(vuln));
        if (result.length > 10000)
            throw new Error('OSV package result limit exceeded');
        if (!data.next_page_token)
            return result;
        token = text(data.next_page_token, 'OSV page token', 2000);
        if (tokens.has(token))
            throw new Error('Repeated OSV page');
        tokens.add(token);
    }
    throw new Error('Incomplete OSV package traversal');
}
export const advisoryRevision = (a: OSV) => hash(a);
