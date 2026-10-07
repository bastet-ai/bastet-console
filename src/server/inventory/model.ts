import { createHash, randomUUID } from 'node:crypto';
export class InventoryError extends Error {
    constructor(public status: number, message: string) { super(message); }
}
export const id = () => randomUUID();
export function stable(value: unknown): string {
    if (value instanceof Date)
        return JSON.stringify(value.toISOString());
    if (Array.isArray(value))
        return `[${value.map(stable).join(',')}]`;
    if (value && typeof value === 'object')
        return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`).join(',')}}`;
    return JSON.stringify(value);
}
export const hash = (value: unknown) => createHash('sha256').update(stable(value)).digest('hex');
export function text(value: unknown, label: string, max = 512): string {
    if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))
        throw new InventoryError(400, `Invalid ${label}`);
    return value.trim();
}
export function object(value: unknown, label = 'object'): Record<string, any> {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new InventoryError(400, `Invalid ${label}`);
    return value as Record<string, any>;
}
export function jsonObject(value: unknown, label: string, limit = 65536) {
    const result = object(value, label);
    if (Buffer.byteLength(JSON.stringify(result)) > limit)
        throw new InventoryError(400, `${label} is too large`);
    return result;
}
export function componentIdentity(ecosystem: unknown, name: unknown) {
    const eco = text(ecosystem, 'ecosystem', 100);
    const raw = text(name, 'component name', 512);
    // Preserve ecosystem-specific identities. Never guess a package name from a
    // product label except the small explicit httpx mapping below.
    const normalized = eco === 'PyPI' ? raw.toLowerCase().replace(/[-_.]+/g, '-') : eco === 'npm' ? raw.toLowerCase() : raw;
    if (eco === 'npm' && !/^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/.test(normalized))
        throw new InventoryError(400, 'Invalid npm package name');
    return { id: hash([eco, normalized]), ecosystem: eco, name: normalized };
}
export function canonicalAsset(input: unknown) {
    const a = object(input, 'asset'), kind = text(a.kind, 'asset kind', 20);
    let value = text(a.value, 'asset value', 8192);
    if (!['domain', 'url', 'app', 'repo', 'cidr', 'other'].includes(kind))
        throw new InventoryError(400, 'Unsupported asset kind');
    let subtype: string | null = null;
    if (kind === 'url') {
        let url: URL;
        try {
            url = new URL(value);
        }
        catch {
            throw new InventoryError(400, 'Invalid asset URL');
        }
        if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
            throw new InventoryError(400, 'Asset URL must omit credentials, query strings and fragments; retain those only in private evidence if needed');
        subtype = ['ws:', 'wss:'].includes(url.protocol) ? 'websocket' : 'http';
        value = url.href;
    }
    else if (kind === 'domain')
        value = value.toLowerCase().replace(/\.$/, '');
    return { kind, value, subtype };
}
export function fingerprintInput(raw: unknown, now = Date.now()) {
    const a = object(raw), component = componentIdentity(a.ecosystem, a.name);
    const observed = Date.parse(text(a.observed_at, 'observed_at', 50));
    if (!Number.isFinite(observed) || observed > now + 30000)
        throw new InventoryError(400, 'Observation time is invalid or in the future');
    if (typeof a.confidence !== 'number' || !Number.isFinite(a.confidence) || a.confidence < 0 || a.confidence > 1)
        throw new InventoryError(400, 'Confidence must be between 0 and 1');
    const presence = a.presence ?? 'present';
    if (!['present', 'absent'].includes(presence))
        throw new InventoryError(400, 'Invalid presence');
    if (presence === 'absent' && a.explicit_absence !== true)
        throw new InventoryError(400, 'Absence requires explicit evidence; a missed detection is not removal');
    const version = a.version == null ? null : text(a.version, 'version', 200);
    const versionRange = a.version_range == null ? null : text(a.version_range, 'version range', 500);
    if (version && versionRange)
        throw new InventoryError(400, 'Supply an exact version or an estimated range');
    const state = { component, version, version_range: versionRange, presence,
        allow_advisory_lookup: a.allow_advisory_lookup === true,
        confidence: a.confidence, configuration: jsonObject(a.configuration ?? {}, 'configuration', 16384) };
    return { ...state, deployment_id: text(a.deployment_id, 'deployment ID', 100),
        source_key: text(a.source_key, 'source key', 200), method: text(a.method, 'method', 200),
        event_key: text(a.event_key, 'event key', 200), observed_at: new Date(observed).toISOString(),
        evidence: jsonObject(a.evidence, 'evidence'), state_hash: hash(state) };
}
/** Only recognized mappings become package identities; unknown product labels
 * remain Product fingerprints and are not silently treated as npm packages. */
export function technology(label: string) {
    const match = label.match(/^(.+?)(?::([^:]+))?$/);
    const product = text(match?.[1], 'technology', 200);
    const packages: Record<string, string> = { 'next.js': 'next', 'nextjs': 'next', 'react': 'react', 'express': 'express' };
    return { ecosystem: packages[product.toLowerCase()] ? 'npm' : 'Product', name: packages[product.toLowerCase()] ?? product,
        version: match?.[2] ?? null };
}
