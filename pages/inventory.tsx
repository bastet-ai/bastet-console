import { useEffect, useState, type FormEvent } from 'react';
import Head from 'next/head';
import Navbar from '../src/components/Navbar';
import { verifySession, type User } from '../src/lib/authClient';
type Row = Record<string, any>;
const pretty = (value: unknown) => JSON.stringify(value, null, 2);
const date = (value: string) => value ? new Date(value).toLocaleString() : 'Never';
const label = (state: string) => ({ affected_version: 'Affected version · unverified', possible: 'Needs investigation', not_affected: 'Outside declared range', withdrawn: 'Advisory withdrawn', ready: 'Queued' }[state] ?? state);
export default function Inventory() {
    const [user, setUser] = useState<User | null>(null), [data, setData] = useState<Row | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
    const [campaign, setCampaign] = useState(''), [filter, setFilter] = useState(''), [selected, setSelected] = useState<Row | null>(null);
    const [history, setHistory] = useState<Row | null>(null), [historyKind, setHistoryKind] = useState('fingerprints'), [historyDeployment, setHistoryDeployment] = useState<Row | null>(null);
    const [tokens, setTokens] = useState<Row[]>([]), [secret, setSecret] = useState(''), [review, setReview] = useState<Row | null>(null);
    async function api(query = '', body?: Row) {
        const response = await fetch(`/api/inventory${query}`, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${localStorage.getItem('auth_token') ?? ''}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
        const result = await response.json() as Row;
        if (!response.ok)
            throw new Error(result.error ?? 'Inventory request failed');
        return result;
    }
    async function refresh(id = campaign) { setData(await api(id ? `?campaign_id=${encodeURIComponent(id)}` : '')); }
    async function act(body: Row) { setBusy(true); setError(''); try {
        const result = await api('', body);
        await refresh();
        return result.result;
    }
    catch (e) {
        setError((e as Error).message);
    }
    finally {
        setBusy(false);
    } }
    useEffect(() => { let alive = true; verifySession().then(async (result) => { if (!alive)
        return; if (!result.user) {
        setError('Sign in to view stack inventory.');
        return;
    } setUser(result.user); await refresh(''); }).catch(() => setError('Could not load inventory.')); return () => { alive = false; }; }, []);
    useEffect(() => { if (!user)
        return; let active = true; const timer = setInterval(() => { if (!document.hidden)
        refresh().catch(() => { if (active)
            setError('Live refresh failed. Showing the last loaded inventory.'); }); }, 15000); return () => { active = false; clearInterval(timer); }; }, [user, campaign]);
    async function chooseCampaign(id: string) { setCampaign(id); setSelected(null); setSecret(''); setTokens([]); setHistory(null); setError(''); try {
        await refresh(id);
    }
    catch (e) {
        setError((e as Error).message);
    } }
    const campaigns: Row[] = data?.campaigns ?? [], deployments: Row[] = data?.deployments ?? [], fingerprints: Row[] = data?.fingerprints ?? [];
    const managed = (id: string) => campaigns.some(c => c.id === id && ['owner', 'manager'].includes(c.role));
    const deployment = (id: string) => deployments.find(d => d.id === id);
    const campaignName = (id: string) => campaigns.find(c => c.id === id)?.name ?? id;
    const matches = (...values: unknown[]) => values.join(' ').toLowerCase().includes(filter.toLowerCase());
    async function loadHistory(dep: Row, kind = historyKind, before?: string) { try {
        const result = await api(`?view=history&campaign_id=${encodeURIComponent(dep.campaign_id)}&deployment_id=${encodeURIComponent(dep.id)}&kind=${kind}${before ? `&before=${encodeURIComponent(before)}` : ''}`);
        setHistoryDeployment(dep);
        setHistoryKind(kind);
        setHistory(old => ({ ...result, records: before ? [...(old?.records ?? []), ...result.records] : result.records }));
    }
    catch (e) {
        setError((e as Error).message);
    } }
    async function submitResearch(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); const result = await act({ action: 'research', campaign_id: form.get('campaign'), release_id: selected!.release_id, hypothesis: form.get('hypothesis'), source_url: form.get('source'), source_revision: form.get('revision'), budget_minutes: Number(form.get('budget')) }); if (result)
        setSelected(null); }
    const cohorts: Row[] = (data?.cohorts ?? []).filter((c: Row) => matches(c.name, c.ecosystem, c.version));
    return <><Head><title>Stack inventory · Bastet</title></Head><Navbar user={user} onSignIn={() => location.assign('/')} onSignOut={() => { localStorage.removeItem('auth_token'); location.assign('/'); }}/>
    <main className="inventory-page">
      <div className="inventory-title"><div><p className="inventory-eyebrow">ASSETS & SOFTWARE</p><h1>Stack inventory</h1><p>Observed releases, changes, advisory exposure, and source research across your campaigns.</p></div><button onClick={() => refresh().catch(e => setError(e.message))}>Refresh</button></div>
      {error && <p role="alert" className="inventory-error">{error}</p>}
      {!data && user && <p>Loading inventory…</p>}
      {data?.configured === false && <section><h2>Inventory awaits activation</h2><p>{data.reason}</p></section>}
      {data?.configured && <>
        <div className="inventory-filters"><label>Campaign<select value={campaign} onChange={e => void chooseCampaign(e.target.value)}><option value="">All accessible campaigns</option>{campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Component or version<input type="search" placeholder="next, 14.2, nginx…" value={filter} onChange={e => setFilter(e.target.value)}/></label></div>
        {data.truncated?.length > 0 && <p role="status">Showing the first 2,000 records in {data.truncated.join(', ')}. Select a campaign to narrow the view; complete history remains available per deployment.</p>}
        <div className="inventory-health">Advisory sync: {data.health.length ? data.health.map((h: Row) => <span key={h.name}>{h.status} · last successful {date(h.last_success_at)}{!h.last_success_at || Date.now() - Date.parse(h.last_success_at) > 15 * 60000 ? ' · overdue' : ''} · {h.detail}</span>) : 'Not started'}<span>Refreshes every 15 seconds. Unknown versions and stale evidence require investigation.</span></div>
        <section><h2>Releases across deployments</h2><p>Counts use distinct deployments, so several endpoints in one app count once. A deployment may appear under multiple versions when observations disagree.</p>
          <div className="inventory-table"><table><thead><tr><th>Component</th><th>Version</th><th>Deployments</th><th>Campaigns</th><th>Latest evidence</th><th>Research</th></tr></thead><tbody>{cohorts.map((c, i) => <tr key={c.release_id ?? `${c.component_id}-${i}`}><td>{c.name}<small>{c.ecosystem}</small></td><td>{c.version ?? 'Unknown / estimated'}</td><td>{c.deployments}</td><td>{c.campaigns}</td><td>{date(c.newest_observation)}</td><td>{c.release_id && fingerprints.some(f => f.release_id === c.release_id && managed(f.campaign_id)) ? <button onClick={() => setSelected(c)}>Research release</button> : '—'}</td></tr>)}</tbody></table></div>{!cohorts.length && <p>No matching fingerprints yet. Import existing recon evidence or connect a fingerprint worker.</p>}
        </section>
        {selected && <section><h2>Research {selected.name} {selected.version}</h2><p>Queue a source review with a fixed commit and a time budget. A configured worker must claim it before it runs.</p><form onSubmit={submitResearch} className="inventory-form"><label>Campaign<select name="campaign" required>{campaigns.filter(c => managed(c.id) && fingerprints.some(f => f.campaign_id === c.id && f.release_id === selected.release_id)).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Source repository<input name="source" type="url" required placeholder="https://github.com/owner/repository"/></label><label>Full source commit<input name="revision" required pattern="[a-fA-F0-9]{40,64}" placeholder="Immutable commit SHA"/></label><label>Research hypothesis<textarea name="hypothesis" required maxLength={8000} placeholder="Which behavior should the agent investigate?"/></label><label>Minutes per attempt (up to 3 attempts)<input name="budget" type="number" min={1} max={240} defaultValue={30}/></label><div><button disabled={busy}>Queue research</button> <button type="button" onClick={() => setSelected(null)}>Cancel</button></div></form></section>}
        <section><h2>Advisory exposure</h2><p>An affected version is a triage lead. Application exploitability is recorded separately after review.</p><div className="inventory-table"><table><thead><tr><th>Advisory</th><th>Deployment</th><th>Assessment</th><th>Review</th></tr></thead><tbody>{(data.assessments ?? []).filter((a: Row) => matches(a.advisory_id, a.summary, ...(a.rationale ?? []).map((r: Row) => r.version), fingerprints.find(f => f.component_id === a.component_id)?.name)).map((a: Row) => <tr key={a.id}><td><a href={`https://osv.dev/vulnerability/${encodeURIComponent(a.advisory_id)}`} target="_blank" rel="noreferrer">{a.advisory_id}</a><small>{a.summary}</small><details><summary>Matching evidence</summary><pre>{pretty(a.rationale)}</pre></details></td><td>{deployment(a.deployment_id)?.name ?? a.deployment_id}<small>{campaignName(a.campaign_id)}</small></td><td><strong>{label(a.match_state)}</strong></td><td>{a.review ? <><strong>{label(a.review.verdict)}</strong><small>{a.review.reason}</small></> : 'Unreviewed'}{managed(a.campaign_id) && <button onClick={() => setReview(a)}>Record review</button>}</td></tr>)}</tbody></table></div>{!data.assessments.length && <p>No advisory assessments yet. This does not establish that the inventory is vulnerability-free.</p>}</section>
        {review && <section><h2>Review {review.advisory_id}</h2><form className="inventory-form" onSubmit={async (e) => { e.preventDefault(); const f = new FormData(e.currentTarget); const r = await act({ action: 'review', campaign_id: review.campaign_id, assessment_id: review.id, input_hash: review.input_hash, verdict: f.get('verdict'), reason: f.get('reason'), evidence: { reference: f.get('evidence') } }); if (r)
            setReview(null); }}><label>Verdict<select name="verdict"><option value="needs_information">Needs information</option><option value="confirmed">Confirmed exploitable</option><option value="not_affected">Not affected in this deployment</option></select></label><label>Reason<textarea name="reason" required/></label><label>Evidence reference<input name="evidence" required/></label><div><button disabled={busy}>Save review</button> <button type="button" onClick={() => setReview(null)}>Cancel</button></div></form></section>}
        <section><h2>Deployment evidence</h2><div className="inventory-table"><table><thead><tr><th>Deployment</th><th>Component</th><th>Version</th><th>Source / confidence</th><th>Observed</th><th>History</th></tr></thead><tbody>{fingerprints.filter(f => matches(f.name, f.version, f.version_range, deployment(f.deployment_id)?.name)).map(f => <tr key={f.id}><td>{deployment(f.deployment_id)?.name ?? f.deployment_id}<small>{campaignName(f.campaign_id)} · {deployment(f.deployment_id)?.environment}</small></td><td>{f.name}<small>{f.presence}</small></td><td>{f.version ?? f.version_range ?? 'Unknown'}</td><td>{f.source_key} · {Math.round(f.confidence * 100)}%<details><summary>Evidence</summary><pre>{pretty({ method: f.method, evidence: f.evidence, configuration: f.configuration, recorded_by: f.recorded_by, worker_id: f.worker_id })}</pre></details></td><td>{date(f.observed_at)}</td><td><button onClick={() => void loadHistory({ id: f.deployment_id, campaign_id: f.campaign_id, name: deployment(f.deployment_id)?.name })}>History</button></td></tr>)}</tbody></table></div></section>
        {history && historyDeployment && <section><h2>History · {historyDeployment.name}</h2><label>Record type<select value={historyKind} onChange={e => void loadHistory(historyDeployment, e.target.value)}><option value="fingerprints">Fingerprints</option><option value="assessments">Advisory assessments</option></select></label>{history.records.map((r: Row) => <details key={r.id}><summary>{date(r.observed_at ?? r.recorded_at)} · {r.name ?? r.match_state} {r.version ?? r.version_range ?? ''}</summary><pre>{pretty(r)}</pre></details>)}{history.next_cursor && <button onClick={() => void loadHistory(historyDeployment, historyKind, history.next_cursor)}>Load earlier records</button>} <button onClick={() => setHistory(null)}>Close history</button></section>}
        <section><h2>Changes requiring attention</h2><p>Latest 100 unacknowledged events. Full event history is available through the campaign event feed.</p>{data.alerts.map((a: Row) => <details key={a.id}><summary>{a.kind.replaceAll('.', ' · ')} · {campaignName(a.campaign_id)} · {date(a.created_at)}</summary><pre>{pretty(a.data)}</pre><button disabled={busy} onClick={() => void act({ action: 'acknowledge', campaign_id: a.campaign_id, event_id: String(a.id) })}>Acknowledge</button></details>)}{!data.alerts.length && <p>No unacknowledged changes.</p>}</section>
        <section><h2>Research jobs</h2><p>Latest 200 jobs. Results belong to their component release and source commit; they do not confirm any target is exploitable.</p>{data.tasks.map((task: Row) => <details key={task.id}><summary>{label(task.state)} · {task.hypothesis.slice(0, 120)} · attempt {task.attempt}/3</summary><p>{campaignName(task.campaign_id)} · {task.source_url} · {task.source_revision}</p><pre>{pretty(task.result ?? { hypothesis: task.hypothesis, budget_minutes: task.budget_minutes })}</pre>{managed(task.campaign_id) && ['ready', 'running'].includes(task.state) && <button disabled={busy} onClick={() => void act({ action: 'cancel', campaign_id: task.campaign_id, task_id: task.id })}>Cancel job</button>}</details>)}{!data.tasks.length && <p>No research jobs queued.</p>}</section>
        {campaign && managed(campaign) && <section><h2>Worker access</h2><p>Workers receive an expiring token for this campaign. Choose only the capability the worker needs.</p><form className="inventory-form" onSubmit={async (e) => { e.preventDefault(); const f = new FormData(e.currentTarget); const result = await act({ action: 'issue_token', campaign_id: campaign, name: f.get('name'), capabilities: [f.get('capability')], expires_in_days: 30 }); if (result) {
            setSecret(result.token);
            setTokens((await api(`?view=tokens&campaign_id=${encodeURIComponent(campaign)}`)).tokens);
        } }}><label>Worker name<input name="name" required maxLength={100}/></label><label>Capability<select name="capability"><option value="ingest">Record fingerprints</option><option value="research">Run source research</option><option value="read">Consume campaign events and history</option></select></label><button disabled={busy}>Create 30-day token</button></form>{secret && <div><p>Copy now. This secret is displayed once.</p><code className="inventory-secret">{secret}</code><button onClick={() => setSecret('')}>Hide token</button></div>}<button onClick={() => api(`?view=tokens&campaign_id=${encodeURIComponent(campaign)}`).then(r => setTokens(r.tokens)).catch(e => setError(e.message))}>List tokens</button>{tokens.map(t => <p key={t.id}>{t.name} · {t.capabilities.join(', ')} · expires {date(t.expires_at)} {t.revoked_at ? 'Revoked' : <button disabled={busy} onClick={async () => { await act({ action: 'revoke_token', campaign_id: campaign, token_id: t.id }); setTokens((await api(`?view=tokens&campaign_id=${encodeURIComponent(campaign)}`)).tokens); }}>Revoke</button>}</p>)}</section>}
      </>}
    </main>
    <style>{`.inventory-page{display:block;max-width:1320px;margin:auto;padding:36px 24px;color:#172033}.inventory-title{display:flex;justify-content:space-between;gap:20px;align-items:center}.inventory-page h1{font-size:34px;font-weight:700;margin:0}.inventory-eyebrow{font-size:12px;letter-spacing:.16em;color:#4d6590}.inventory-page h2{font-size:22px;font-weight:650;margin-bottom:12px}.inventory-page p{margin:10px 0;color:#526178}.inventory-page section{width:100%;backdrop-filter:none;box-shadow:none;background:#fff;border:1px solid #dae2ed;border-radius:12px;padding:24px;margin:24px 0}.inventory-filters{display:flex;gap:24px;margin:24px 0;flex-wrap:wrap}.inventory-page label{display:grid;gap:6px;font-size:14px;color:#344663}.inventory-page input,.inventory-page select,.inventory-page textarea{border:1px solid #acbbcf;border-radius:6px;padding:9px;background:#fff;color:#172033;min-width:200px;max-width:100%}.inventory-page button{border:1px solid #acbbcf;background:#f3f7fc;color:#183d70;border-radius:6px;padding:7px 12px;cursor:pointer}.inventory-page button:disabled{opacity:.5}.inventory-page button:focus-visible,.inventory-page input:focus-visible,.inventory-page select:focus-visible{outline:2px solid #2469c6;outline-offset:2px}.inventory-table{overflow-x:auto}.inventory-page table{width:100%;border-collapse:collapse;font-size:14px}.inventory-page th{text-align:left;background:#f4f7fb;color:#4c5b70;font-size:12px;letter-spacing:.02em}.inventory-page th,.inventory-page td{padding:13px 12px;border-bottom:1px solid #e5eaf2;vertical-align:top}.inventory-page small{display:block;color:#64748b;margin-top:4px}.inventory-page details{padding:10px 0}.inventory-page summary{cursor:pointer}.inventory-page pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:400px;overflow:auto;background:#f5f7fb;padding:12px;font-size:12px}.inventory-page a{color:#185db1}.inventory-form{display:grid;gap:16px;max-width:650px}.inventory-form textarea{min-height:96px}.inventory-health{display:grid;gap:6px;font-size:13px;color:#526178}.inventory-error{padding:12px;background:#fff0ed;border:1px solid #e4a18d;border-radius:6px}.inventory-secret{display:block;overflow-wrap:anywhere;padding:12px;background:#fff9df}@media(max-width:650px){.inventory-page{padding:20px 12px}.inventory-page section{padding:16px}.inventory-title{align-items:flex-start}.inventory-filters{display:grid}}`}</style>
  </>;
}
