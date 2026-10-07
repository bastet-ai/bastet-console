import { canonicalAsset, hash, object, technology, text } from './model';
/** Consume existing run_recon.py JSONL. This function performs no target probes. */
export function reconFingerprints(raw: unknown, deploymentId: string) {
    const row = object(raw, 'recon observation');
    if (row.tool !== 'httpx')
        return [];
    const evidence = object(row.evidence), tech = evidence.tech ?? [];
    if (!Array.isArray(tech) || tech.length > 100 || tech.some(t => typeof t !== 'string'))
        throw new Error('Invalid recon technology list');
    const target = canonicalAsset({ kind: 'url', value: row.target }).value;
    const observed = text(row.ts, 'recon timestamp', 50), proof = text(row.scope_proof, 'scope proof', 200);
    if (!Number.isFinite(Date.parse(observed)))
        throw new Error('Invalid recon timestamp');
    return [...new Set<string>(tech)].map(label => {
        const c = technology(label);
        return { ...c, deployment_id: deploymentId, observed_at: observed, source_key: `httpx:${hash(target)}`, method: 'httpx technology detection',
            confidence: 0.7, allow_advisory_lookup: c.ecosystem === 'npm', event_key: `recon:${hash([row, c])}`,
            evidence: { target, raw_technology: label, tool_version: row.tool_version ?? null, scope_proof: proof, observation_sha256: hash(row), status_code: evidence.status_code ?? evidence.status ?? null }, configuration: {} };
    });
}
