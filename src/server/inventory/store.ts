import type { Pool } from 'pg';
import { randomBytes } from 'node:crypto';
import { advisoryRevision, matchAdvisory, type OSV, validateAdvisory } from './advisories';
import { canonicalAsset, componentIdentity, fingerprintInput, hash, id, InventoryError, jsonObject, object, text } from './model';
export type Row = Record<string, any>;
export interface Query {
    query(sql: string, values?: any[]): Promise<{
        rows: Row[];
    }>;
}
export interface Storage extends Query {
    transaction<T>(fn: (q: Query) => Promise<T>): Promise<T>;
}
export const pgStorage = (pool: Pool): Storage => ({
    query: (sql, values) => pool.query(sql, values),
    async transaction(fn) {
        const q = await pool.connect();
        try {
            await q.query('BEGIN');
            const result = await fn(q);
            await q.query('COMMIT');
            return result;
        }
        catch (error) {
            await q.query('ROLLBACK');
            throw error;
        }
        finally {
            q.release();
        }
    },
});
export type Actor = {
    userId: string;
} | {
    token: string;
};
export type Capability = 'read' | 'ingest' | 'research';
const query = async (q: Query, sql: string, values: any[] = []) => (await q.query(sql, values)).rows;
const first = async (q: Query, sql: string, values: any[] = []) => (await query(q, sql, values))[0];
const writerLock = (q: Query) => q.query('SELECT pg_advisory_xact_lock(70631008)');
const emit = (q: Query, campaign: string, kind: string, subject: string, data: unknown) => q.query('INSERT INTO inventory.events(campaign_id,kind,subject_id,data) VALUES($1,$2,$3,$4::jsonb)', [campaign, kind, subject, JSON.stringify(data)]);
const time = (value: string | Date) => value instanceof Date ? value.getTime() : Date.parse(value);
const accessSql = `(c.owner_id=$1 OR EXISTS(SELECT 1 FROM console.campaign_members m WHERE m.campaign_id=c.id AND m.user_id=$1))`;
export class InventoryStore {
    constructor(public readonly storage: Storage) { }
    async available() { return Boolean((await first(this.storage, "SELECT to_regclass('inventory.schema_version') AS version"))?.version); }
    private async authorize(q: Query, actor: Actor, campaignId: string, capability: Capability, manage = false) {
        const campaign = await first(q, 'SELECT * FROM console.campaigns WHERE id=$1 FOR SHARE', [campaignId]);
        if (!campaign)
            throw new InventoryError(403, 'Campaign access denied');
        let userId: string, worker: Row | undefined;
        if ('token' in actor) {
            if (manage)
                throw new InventoryError(403, 'A user session is required');
            worker = await first(q, `SELECT * FROM inventory.worker_tokens WHERE campaign_id=$1 AND token_hash=$2
        AND revoked_at IS NULL AND expires_at>now() FOR SHARE`, [campaignId, hash(actor.token)]);
            if (!worker || !worker.capabilities.includes(capability))
                throw new InventoryError(403, 'Worker capability denied');
            userId = worker.created_by;
        }
        else
            userId = actor.userId;
        const membership = await first(q, 'SELECT role FROM console.campaign_members WHERE campaign_id=$1 AND user_id=$2 FOR SHARE', [campaignId, userId]);
        const role = campaign.owner_id === userId ? 'owner' : membership?.role;
        if (!role || ((manage || worker) && !['owner', 'manager'].includes(role)) || (capability === 'ingest' && role === 'watcher'))
            throw new InventoryError(403, 'Campaign access denied');
        return { campaign, userId, role, worker };
    }
    private async access<T>(actor: Actor, campaign: string, capability: Capability, write: boolean, fn: (q: Query, auth: Awaited<ReturnType<InventoryStore['authorize']>>) => Promise<T>, manage = false) {
        return this.storage.transaction(async (q) => {
            if (write)
                await writerLock(q);
            const auth = await this.authorize(q, actor, campaign, capability, manage);
            return fn(q, auth);
        });
    }
    async createDeployment(actor: Actor, campaign: string, input: unknown) {
        const a = object(input), name = text(a.name, 'deployment name', 200), environment = text(a.environment ?? 'unknown', 'environment', 100);
        const assets = a.assets ?? [];
        if (!Array.isArray(assets) || assets.length > 100)
            throw new InventoryError(400, 'At most 100 assets per request');
        const normalized = assets.map(canonicalAsset);
        return this.access(actor, campaign, 'ingest', true, async (q, auth) => {
            let deployment = await first(q, 'SELECT * FROM inventory.deployments WHERE campaign_id=$1 AND name=$2 AND environment=$3', [campaign, name, environment]);
            if (!deployment) {
                deployment = await first(q, `INSERT INTO inventory.deployments(id,campaign_id,name,environment,created_by) VALUES($1,$2,$3,$4,$5) RETURNING *`, [id(), campaign, name, environment, auth.userId]);
                await emit(q, campaign, 'deployment.created', deployment.id, { name, environment });
            }
            for (const asset of normalized)
                await q.query(`INSERT INTO inventory.assets(id,campaign_id,deployment_id,kind,value,subtype)
        VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(campaign_id,deployment_id,kind,value) DO NOTHING`, [id(), campaign, deployment.id, asset.kind, asset.value, asset.subtype]);
            return deployment;
        });
    }
    async fingerprint(actor: Actor, campaign: string, input: unknown) {
        const a = fingerprintInput(input), inputHash = hash(a);
        return this.access(actor, campaign, 'ingest', true, async (q, auth) => {
            if (!await first(q, 'SELECT id FROM inventory.deployments WHERE campaign_id=$1 AND id=$2', [campaign, a.deployment_id]))
                throw new InventoryError(404, 'Deployment not found');
            const existing = await first(q, 'SELECT id,input_hash FROM inventory.fingerprints WHERE campaign_id=$1 AND event_key=$2', [campaign, a.event_key]);
            if (existing) {
                if (existing.input_hash !== inputHash)
                    throw new InventoryError(409, 'Event key already describes different evidence');
                return { id: existing.id, replayed: true };
            }
            const c = a.component;
            await q.query('INSERT INTO inventory.components(id,ecosystem,name) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [c.id, c.ecosystem, c.name]);
            const release = a.version ? hash([c.id, a.version]) : null;
            if (release)
                await q.query('INSERT INTO inventory.releases(id,component_id,version) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [release, c.id, a.version]);
            const previous = await first(q, 'SELECT * FROM inventory.current_fingerprints WHERE deployment_id=$1 AND component_id=$2 AND source_key=$3', [a.deployment_id, c.id, a.source_key]);
            const observationId = id();
            await q.query(`INSERT INTO inventory.fingerprints(id,campaign_id,deployment_id,component_id,release_id,version_range,presence,source_key,method,confidence,evidence,configuration,observed_at,event_key,input_hash,state_hash,recorded_by,worker_id,allow_advisory_lookup)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,$14,$15,$16,$17,$18,$19)`, [observationId, campaign, a.deployment_id, c.id, release, a.version_range, a.presence, a.source_key, a.method, a.confidence, JSON.stringify(a.evidence), JSON.stringify(a.configuration), a.observed_at, a.event_key, inputHash, a.state_hash, auth.userId, auth.worker?.id ?? null, a.allow_advisory_lookup]);
            await emit(q, campaign, 'fingerprint.recorded', observationId, { deployment_id: a.deployment_id, component_id: c.id, release_id: release });
            // Equal-time conflicting observations are retained and surfaced in history.
            // Out-of-order ingestion must never roll the current projection backwards.
            if ((!previous || time(a.observed_at) >= time(previous.observed_at)) && previous?.state_hash !== a.state_hash) {
                await emit(q, campaign, 'component.changed', a.deployment_id, { component_id: c.id, previous_fingerprint_id: previous?.id ?? null, fingerprint_id: observationId,
                    last_previous_observation_at: previous?.observed_at ?? null, first_new_observation_at: a.observed_at });
            }
            await this.recompute(q, c.id, a.deployment_id);
            return { id: observationId, replayed: false };
        });
    }
    async saveAdvisory(raw: unknown) {
        const a = validateAdvisory(raw), revision = advisoryRevision(a);
        return this.storage.transaction(async (q) => {
            await writerLock(q);
            const old = await first(q, 'SELECT * FROM inventory.advisories WHERE id=$1', [a.id]);
            await q.query('INSERT INTO inventory.advisory_revisions(id,advisory_id,modified_at,document) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT DO NOTHING', [revision, a.id, a.modified, JSON.stringify(a)]);
            if (old && time(old.modified_at) > time(a.modified))
                return { updated: false };
            await q.query(`INSERT INTO inventory.advisories(id,revision_id,modified_at) VALUES($1,$2,$3)
        ON CONFLICT(id) DO UPDATE SET revision_id=excluded.revision_id,modified_at=excluded.modified_at,last_checked_at=now()`, [a.id, revision, a.modified]);
            const components = new Set<string>((await query(q, 'SELECT component_id FROM inventory.advisory_components WHERE advisory_id=$1', [a.id])).map(r => r.component_id));
            for (const entry of a.affected) {
                const c = componentIdentity(entry.package.ecosystem, entry.package.name);
                await q.query('INSERT INTO inventory.components(id,ecosystem,name) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [c.id, c.ecosystem, c.name]);
                await q.query('INSERT INTO inventory.advisory_components(advisory_id,component_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [a.id, c.id]);
                components.add(c.id);
            }
            // Keep historical package links so removal/correction/withdrawal re-evaluates
            // every previously matched deployment, including changes to affected[].
            for (const c of components)
                await this.recompute(q, c, undefined, a.id);
            return { updated: old?.revision_id !== revision };
        });
    }
    private async recompute(q: Query, component: string, deployment?: string, advisoryId?: string) {
        const rows = await query(q, `SELECT f.*,r.version,c.ecosystem,c.name,
      EXISTS(SELECT 1 FROM inventory.fingerprints x WHERE x.deployment_id=f.deployment_id AND x.component_id=f.component_id
        AND x.source_key=f.source_key AND x.observed_at=f.observed_at AND x.state_hash<>f.state_hash) AS time_conflict
      FROM inventory.current_fingerprints f
      JOIN inventory.components c ON c.id=f.component_id LEFT JOIN inventory.releases r ON r.id=f.release_id
      WHERE f.component_id=$1 ${deployment ? 'AND f.deployment_id=$2' : ''}`, [component, ...(deployment ? [deployment] : [])]);
        const advisories = await query(q, `SELECT a.id,a.revision_id,r.document FROM inventory.advisory_components ac
      JOIN inventory.advisories a ON a.id=ac.advisory_id JOIN inventory.advisory_revisions r ON r.id=a.revision_id
      WHERE ac.component_id=$1 ${advisoryId ? 'AND a.id=$2' : ''}`, [component, ...(advisoryId ? [advisoryId] : [])]);
        for (const dep of new Set<string>(rows.map(r => r.deployment_id))) {
            const facts = rows.filter(r => r.deployment_id === dep).sort((a, b) => a.source_key.localeCompare(b.source_key)), campaign = facts[0].campaign_id;
            const conflicting = facts.some(f => f.time_conflict) || new Set(facts.map(f => hash([f.presence, f.version, f.version_range]))).size > 1;
            for (const a of advisories) {
                const reasons = facts.map(f => {
                    const match = matchAdvisory(a.document as OSV, { ecosystem: f.ecosystem, name: f.name, version: f.version, version_range: f.version_range, presence: f.presence });
                    const stale = Date.now() - time(f.observed_at) > 7 * 86400000;
                    const state = match.state !== 'withdrawn' && (stale || f.confidence < 0.9 || conflicting) ? 'possible' : match.state;
                    return { fingerprint_id: f.id, version: f.version, version_range: f.version_range, source_key: f.source_key, presence: f.presence,
                        observed_at: f.observed_at, confidence: f.confidence, stale, conflicting, state, reason: match.reason };
                });
                const states = reasons.map(r => r.state);
                const state = states.includes('withdrawn') ? 'withdrawn' : states.includes('affected_version') ? 'affected_version' : states.includes('possible') ? 'possible' : 'not_affected';
                // A same-state refresh preserves a review; version/configuration/source,
                // advisory, confidence, conflict or freshness changes invalidate it.
                const inputHash = hash({ revision: a.revision_id, inputs: facts.map((f, i) => ({ source: f.source_key, state_hash: f.state_hash,
                        stale: reasons[i].stale, conflicting, state: reasons[i].state })) });
                const assessmentId = hash([dep, component, a.id]);
                const previous = await first(q, 'SELECT * FROM inventory.assessments WHERE id=$1', [assessmentId]);
                if (previous?.input_hash === inputHash) {
                    await q.query('UPDATE inventory.assessments SET rationale=$2::jsonb WHERE id=$1', [assessmentId, JSON.stringify(reasons)]);
                    continue;
                }
                await q.query(`INSERT INTO inventory.assessments(id,campaign_id,deployment_id,component_id,advisory_id,revision_id,match_state,input_hash,rationale)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) ON CONFLICT(id) DO UPDATE SET revision_id=excluded.revision_id,
          match_state=excluded.match_state,input_hash=excluded.input_hash,rationale=excluded.rationale,updated_at=now()`, [assessmentId, campaign, dep, component, a.id, a.revision_id, state, inputHash, JSON.stringify(reasons)]);
                await q.query('INSERT INTO inventory.assessment_history(id,assessment_id,input_hash,match_state,rationale,revision_id) VALUES($1,$2,$3,$4,$5::jsonb,$6)', [id(), assessmentId, inputHash, state, JSON.stringify(reasons), a.revision_id]);
                // Evidence refreshes remain in fingerprint history without repeat alerts.
                if (!previous || previous.match_state !== state || previous.revision_id !== a.revision_id)
                    await emit(q, campaign, 'assessment.changed', assessmentId, { advisory_id: a.id, component_id: component, deployment_id: dep, state, previous_state: previous?.match_state ?? null, revision_id: a.revision_id });
            }
        }
    }
    async refreshAssessments() {
        for (const c of await query(this.storage, 'SELECT DISTINCT component_id FROM inventory.current_fingerprints'))
            await this.storage.transaction(async (q) => { await writerLock(q); await this.recompute(q, c.component_id); });
    }
    async overview(userId: string, campaignId?: string) {
        // Every private row is filtered by current membership, including global views.
        const campaigns = await query(this.storage, `SELECT c.id,c.name,c.owner_id,CASE WHEN c.owner_id=$1 THEN 'owner'
      ELSE (SELECT role FROM console.campaign_members WHERE campaign_id=c.id AND user_id=$1) END AS role
      FROM console.campaigns c WHERE ${accessSql} ${campaignId ? 'AND c.id=$2' : ''} ORDER BY c.name`, [userId, ...(campaignId ? [campaignId] : [])]);
        const ids = campaigns.map(c => c.id);
        if (campaignId && !ids.length)
            throw new InventoryError(403, 'Campaign access denied');
        const deployments = await query(this.storage, 'SELECT * FROM inventory.deployments WHERE campaign_id=ANY($1::text[]) ORDER BY name LIMIT 2001', [ids]);
        const fingerprints = await query(this.storage, `SELECT f.*,c.ecosystem,c.name,r.version FROM inventory.current_fingerprints f
      JOIN inventory.components c ON c.id=f.component_id LEFT JOIN inventory.releases r ON r.id=f.release_id
      WHERE campaign_id=ANY($1::text[]) ORDER BY c.name,f.observed_at DESC LIMIT 2001`, [ids]);
        const assessments = await query(this.storage, `SELECT a.*,r.document->>'summary' AS summary,r.document->'aliases' AS aliases,
      (SELECT jsonb_build_object('verdict',v.verdict,'reason',v.reason,'created_at',v.created_at) FROM inventory.reviews v
       WHERE v.assessment_id=a.id AND v.input_hash=a.input_hash ORDER BY v.created_at DESC,v.id DESC LIMIT 1) AS review
      FROM inventory.assessments a JOIN inventory.advisory_revisions r ON r.id=a.revision_id
      WHERE a.campaign_id=ANY($1::text[]) ORDER BY a.updated_at DESC LIMIT 2001`, [ids]);
        const tasks = await query(this.storage, `SELECT id,campaign_id,component_id,release_id,hypothesis,source_revision,source_url,budget_minutes,state,attempt,created_at,completed_at,result
      FROM inventory.research_tasks WHERE campaign_id=ANY($1::text[]) ORDER BY created_at DESC LIMIT 200`, [ids]);
        const alerts = await query(this.storage, `SELECT e.* FROM inventory.events e WHERE campaign_id=ANY($1::text[])
      AND kind IN ('assessment.changed','component.changed','research.completed','research.failed')
      AND NOT EXISTS(SELECT 1 FROM inventory.event_receipts r WHERE r.event_id=e.id AND r.user_id=$2) ORDER BY e.id DESC LIMIT 100`, [ids, userId]);
        const assets = await query(this.storage, 'SELECT * FROM inventory.assets WHERE campaign_id=ANY($1::text[]) ORDER BY value LIMIT 2001', [ids]);
        const health = await query(this.storage, 'SELECT name,last_started_at,last_success_at,status,detail FROM inventory.worker_health');
        const cohorts = await query(this.storage, `SELECT c.id AS component_id,c.name,c.ecosystem,r.id AS release_id,r.version,
      count(DISTINCT f.deployment_id)::integer AS deployments,count(DISTINCT f.campaign_id)::integer AS campaigns,
      min(f.observed_at) AS oldest_observation,max(f.observed_at) AS newest_observation
      FROM inventory.current_fingerprints f JOIN inventory.components c ON c.id=f.component_id
      LEFT JOIN inventory.releases r ON r.id=f.release_id WHERE f.campaign_id=ANY($1::text[]) AND f.presence='present'
      GROUP BY c.id,r.id ORDER BY deployments DESC,c.name LIMIT 2001`, [ids]);
        const collections = { deployments, assets, fingerprints, assessments, cohorts };
        return { configured: true, campaigns, ...Object.fromEntries(Object.entries(collections).map(([k, v]) => [k, v.slice(0, 2000)])),
            truncated: Object.entries(collections).filter(([, v]) => v.length > 2000).map(([k]) => k), tasks, alerts, health };
    }
    async history(actor: Actor, campaign: string, deployment: string, kind = 'fingerprints', before?: string) {
        if (!['fingerprints', 'assessments'].includes(kind))
            throw new InventoryError(400, 'Invalid history kind');
        let cursor: string[] | undefined;
        if (before) {
            try {
                cursor = JSON.parse(Buffer.from(before, 'base64url').toString('utf8'));
            }
            catch {
                throw new InventoryError(400, 'Invalid history cursor');
            }
            if (!Array.isArray(cursor) || cursor.length !== 2 || !Number.isFinite(time(cursor[0])) || typeof cursor[1] !== 'string' || cursor[1].length > 100)
                throw new InventoryError(400, 'Invalid history cursor');
        }
        return this.access(actor, campaign, 'read', false, async (q) => {
            const fingerprint = kind === 'fingerprints';
            const records = await query(q, fingerprint
                ? `SELECT f.*,c.name,c.ecosystem,r.version,to_char(f.received_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time FROM inventory.fingerprints f JOIN inventory.components c ON c.id=f.component_id
          LEFT JOIN inventory.releases r ON r.id=f.release_id WHERE f.campaign_id=$1 AND f.deployment_id=$2
          ${cursor ? 'AND (f.received_at,f.id)<($3::timestamptz,$4)' : ''} ORDER BY f.received_at DESC,f.id DESC LIMIT 101`
                : `SELECT h.*,to_char(h.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time FROM inventory.assessment_history h JOIN inventory.assessments a ON a.id=h.assessment_id
          WHERE a.campaign_id=$1 AND a.deployment_id=$2 ${cursor ? 'AND (h.recorded_at,h.id)<($3::timestamptz,$4)' : ''}
          ORDER BY h.recorded_at DESC,h.id DESC LIMIT 101`, [campaign, deployment, ...(cursor ?? [])]);
            const last = records[99];
            return { kind, records: records.slice(0, 100), next_cursor: records.length > 100 ? Buffer.from(JSON.stringify([last.cursor_time, last.id])).toString('base64url') : null };
        });
    }
    async events(actor: Actor, campaign: string, after: string) {
        if (!/^\d{1,19}$/.test(after) || BigInt(after) > 9223372036854775807n)
            throw new InventoryError(400, 'Invalid event cursor');
        return this.access(actor, campaign, 'read', false, async (q) => {
            const events = await query(q, 'SELECT * FROM inventory.events WHERE campaign_id=$1 AND id>$2::bigint ORDER BY id LIMIT 200', [campaign, after]);
            return { events, next_cursor: events.at(-1)?.id?.toString() ?? after, has_more: events.length === 200 };
        });
    }
    async acknowledge(userId: string, campaign: string, event: string) {
        if (!/^\d{1,19}$/.test(event) || BigInt(event) > 9223372036854775807n)
            throw new InventoryError(400, 'Invalid event ID');
        return this.access({ userId }, campaign, 'read', true, async (q) => {
            await q.query(`INSERT INTO inventory.event_receipts(user_id,event_id) SELECT $1,id FROM inventory.events WHERE campaign_id=$2 AND id=$3::bigint ON CONFLICT DO NOTHING`, [userId, campaign, text(event, 'event ID', 20)]);
            return { acknowledged: true };
        });
    }
    async review(actor: Actor, campaign: string, input: unknown) {
        const a = object(input), verdict = text(a.verdict, 'verdict', 30), reason = text(a.reason, 'review reason', 8000), evidence = jsonObject(a.evidence ?? {}, 'review evidence');
        if (!['confirmed', 'not_affected', 'needs_information'].includes(verdict))
            throw new InventoryError(400, 'Invalid verdict');
        return this.access(actor, campaign, 'read', true, async (q, auth) => {
            const assessment = await first(q, 'SELECT * FROM inventory.assessments WHERE campaign_id=$1 AND id=$2', [campaign, text(a.assessment_id, 'assessment ID', 100)]);
            if (!assessment)
                throw new InventoryError(404, 'Assessment not found');
            if (assessment.input_hash !== a.input_hash)
                throw new InventoryError(409, 'Assessment evidence changed; review the latest state');
            const reviewId = id();
            await q.query(`INSERT INTO inventory.reviews(id,campaign_id,assessment_id,input_hash,verdict,reason,evidence,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`, [reviewId, campaign, assessment.id, assessment.input_hash, verdict, reason, JSON.stringify(evidence), auth.userId]);
            await emit(q, campaign, 'assessment.reviewed', assessment.id, { review_id: reviewId, verdict });
            return { id: reviewId };
        }, true);
    }
    async issueToken(actor: Actor, campaign: string, input: unknown) {
        const a = object(input), name = text(a.name, 'worker name', 100), capabilities = a.capabilities;
        if (!Array.isArray(capabilities) || !capabilities.length || capabilities.some(c => !['read', 'ingest', 'research'].includes(c)))
            throw new InventoryError(400, 'Invalid capabilities');
        const days = Number(a.expires_in_days ?? 30);
        if (!Number.isInteger(days) || days < 1 || days > 90)
            throw new InventoryError(400, 'Token lifetime must be 1–90 days');
        return this.access(actor, campaign, 'read', true, async (q, auth) => {
            const token = `binv_${randomBytes(32).toString('base64url')}`, tokenId = id();
            await q.query(`INSERT INTO inventory.worker_tokens(id,campaign_id,token_hash,name,capabilities,created_by,expires_at)
        VALUES($1,$2,$3,$4,$5::jsonb,$6,now()+$7*interval '1 day')`, [tokenId, campaign, hash(token), name, JSON.stringify([...new Set(capabilities)]), auth.userId, days]);
            return { id: tokenId, token };
        }, true);
    }
    async revokeToken(actor: Actor, campaign: string, tokenId: string) {
        return this.access(actor, campaign, 'read', true, async (q) => {
            await q.query('UPDATE inventory.worker_tokens SET revoked_at=now() WHERE campaign_id=$1 AND id=$2', [campaign, tokenId]);
            return { revoked: true };
        }, true);
    }
    async tokens(actor: Actor, campaign: string) {
        return this.access(actor, campaign, 'read', false, q => query(q, 'SELECT id,name,capabilities,expires_at,revoked_at FROM inventory.worker_tokens WHERE campaign_id=$1 ORDER BY created_at DESC', [campaign]), true);
    }
    async research(actor: Actor, campaign: string, input: unknown) {
        const a = object(input), hypothesis = text(a.hypothesis, 'research hypothesis', 8000), sourceRevision = text(a.source_revision, 'source revision', 100), sourceUrl = text(a.source_url, 'source repository URL', 2000);
        // Research is against a pinned source tree, not a list of private target URLs.
        if (!/^[a-f0-9]{40,64}$/i.test(sourceRevision))
            throw new InventoryError(400, 'An immutable source commit is required');
        let url: URL;
        try {
            url = new URL(sourceUrl);
        }
        catch {
            throw new InventoryError(400, 'Invalid source URL');
        }
        if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
            throw new InventoryError(400, 'Use a credential-free HTTPS source repository URL');
        const minutes = Number(a.budget_minutes ?? 30);
        if (!Number.isInteger(minutes) || minutes < 1 || minutes > 240)
            throw new InventoryError(400, 'Research budget must be 1–240 minutes');
        return this.access(actor, campaign, 'read', true, async (q, auth) => {
            const release = await first(q, `SELECT r.* FROM inventory.releases r WHERE r.id=$1 AND EXISTS(SELECT 1 FROM inventory.fingerprints f WHERE f.campaign_id=$2 AND f.release_id=r.id)`, [text(a.release_id, 'release ID', 100), campaign]);
            if (!release)
                throw new InventoryError(404, 'Observed component release not found');
            const key = hash([release.id, hypothesis, sourceUrl, sourceRevision]);
            const existing = await first(q, 'SELECT id,state FROM inventory.research_tasks WHERE campaign_id=$1 AND dedupe_key=$2', [campaign, key]);
            if (existing)
                return existing;
            const taskId = id();
            await q.query(`INSERT INTO inventory.research_tasks(id,campaign_id,component_id,release_id,hypothesis,source_revision,source_url,budget_minutes,created_by,dedupe_key)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [taskId, campaign, release.component_id, release.id, hypothesis, sourceRevision, sourceUrl, minutes, auth.userId, key]);
            await emit(q, campaign, 'research.ready', taskId, { component_id: release.component_id, release_id: release.id });
            return { id: taskId, state: 'ready' };
        }, true);
    }
    async claim(actor: Actor, campaign: string) {
        return this.access(actor, campaign, 'research', true, async (q, auth) => {
            if (!auth.worker)
                throw new InventoryError(403, 'Research workers require a scoped worker token');
            const task = await first(q, `SELECT * FROM inventory.research_tasks WHERE campaign_id=$1 AND
        (state='ready' OR (state='running' AND lease_until<now())) AND attempt<3 ORDER BY created_at,id LIMIT 1 FOR UPDATE`, [campaign]);
            if (!task)
                return null;
            if (task.state === 'running')
                await q.query(`UPDATE inventory.research_attempts SET finished_at=now(),outcome='lease_expired' WHERE task_id=$1 AND attempt=$2 AND finished_at IS NULL`, [task.id, task.attempt]);
            const lease = id(), attempt = task.attempt + 1;
            await q.query(`UPDATE inventory.research_tasks SET state='running',attempt=$2,lease_token=$3,lease_until=now()+interval '5 minutes',worker_id=$4 WHERE id=$1`, [task.id, attempt, lease, auth.worker.id]);
            await q.query('INSERT INTO inventory.research_attempts(id,task_id,attempt,worker_id) VALUES($1,$2,$3,$4)', [id(), task.id, attempt, auth.worker.id]);
            await emit(q, campaign, 'research.started', task.id, { attempt });
            const component = await first(q, 'SELECT c.name,c.ecosystem,r.version FROM inventory.releases r JOIN inventory.components c ON c.id=r.component_id WHERE r.id=$1', [task.release_id]);
            return { id: task.id, attempt, lease_token: lease, lease_seconds: 300, mode: 'source_only', component, hypothesis: task.hypothesis,
                source_url: task.source_url, source_revision: task.source_revision, budget_minutes: task.budget_minutes };
        });
    }
    async researchAction(actor: Actor, campaign: string, input: unknown) {
        const a = object(input), action = text(a.action, 'action', 30);
        if (!['heartbeat', 'complete', 'fail', 'cancel'].includes(action))
            throw new InventoryError(400, 'Invalid research action');
        return this.access(actor, campaign, action === 'cancel' ? 'read' : 'research', true, async (q, auth) => {
            const task = await first(q, 'SELECT * FROM inventory.research_tasks WHERE campaign_id=$1 AND id=$2 FOR UPDATE', [campaign, text(a.task_id, 'task ID', 100)]);
            if (!task)
                throw new InventoryError(404, 'Task not found');
            if (action === 'cancel') {
                if (!['ready', 'running'].includes(task.state))
                    throw new InventoryError(409, 'Task is already finished');
                await q.query("UPDATE inventory.research_tasks SET state='cancelled',lease_token=NULL,lease_until=NULL,completed_at=now() WHERE id=$1", [task.id]);
                await q.query("UPDATE inventory.research_attempts SET outcome='cancelled',finished_at=now() WHERE task_id=$1 AND finished_at IS NULL", [task.id]);
                await emit(q, campaign, 'research.cancelled', task.id, {});
                return { state: 'cancelled' };
            }
            if (!auth.worker || task.worker_id !== auth.worker.id || task.state !== 'running' || task.lease_token !== a.lease_token || task.attempt !== a.attempt || time(task.lease_until) <= Date.now())
                throw new InventoryError(409, 'Research lease is stale or invalid');
            const attempt = await first(q, 'SELECT started_at FROM inventory.research_attempts WHERE task_id=$1 AND attempt=$2', [task.id, task.attempt]);
            if (Date.now() - time(attempt.started_at) > (task.budget_minutes + 1) * 60000)
                throw new InventoryError(409, 'Research budget expired');
            if (action === 'heartbeat') {
                await q.query("UPDATE inventory.research_tasks SET lease_until=LEAST(now()+interval '5 minutes',$2::timestamptz+$3*interval '1 minute') WHERE id=$1", [task.id, attempt.started_at, task.budget_minutes + 1]);
                return { renewed: true };
            }
            const result = jsonObject(a.result, 'research result', 120000);
            text(result.summary, 'result summary', 32000);
            if (action === 'complete' && !['candidate', 'negative', 'inconclusive'].includes(result.outcome))
                throw new InventoryError(400, 'Research result needs candidate, negative, or inconclusive outcome');
            if (action === 'complete' && result.source_revision !== task.source_revision)
                throw new InventoryError(400, 'Research result must attest the requested source revision');
            const state = action === 'complete' ? 'completed' : 'failed';
            await q.query('UPDATE inventory.research_tasks SET state=$2,result=$3::jsonb,completed_at=now(),lease_token=NULL,lease_until=NULL WHERE id=$1', [task.id, state, JSON.stringify(result)]);
            await q.query('UPDATE inventory.research_attempts SET outcome=$3,result=$4::jsonb,finished_at=now() WHERE task_id=$1 AND attempt=$2', [task.id, task.attempt, state, JSON.stringify(result)]);
            await emit(q, campaign, `research.${state}`, task.id, { component_id: task.component_id, release_id: task.release_id, outcome: result.outcome ?? 'error' });
            return { state };
        }, action === 'cancel');
    }
    async expireResearch() {
        return this.storage.transaction(async (q) => {
            await writerLock(q);
            const tasks = await query(q, "SELECT * FROM inventory.research_tasks WHERE state='running' AND lease_until<now() AND attempt>=3 FOR UPDATE");
            for (const task of tasks) {
                await q.query("UPDATE inventory.research_tasks SET state='failed',lease_token=NULL,lease_until=NULL,completed_at=now(),result='{\"summary\":\"Worker lease expired after three attempts\"}'::jsonb WHERE id=$1", [task.id]);
                await q.query("UPDATE inventory.research_attempts SET outcome='lease_expired',finished_at=now() WHERE task_id=$1 AND finished_at IS NULL", [task.id]);
                await emit(q, task.campaign_id, 'research.failed', task.id, { reason: 'lease_expired' });
            }
        });
    }
}
