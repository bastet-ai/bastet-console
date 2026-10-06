import React, { useEffect, useState } from 'react'
import type { ProgramProgress as Progress, ProgramProgressResponse } from '../lib/programProgress'

const date = (value: string | null) => value ? new Date(value).toLocaleString() : 'Not yet recorded'

export function ProgramProgressView({ progress }: { progress: Progress }) {
  return <div className="program-progress-content">
    <dl className="program-progress-summary">
      <div><dt>Run status</dt><dd>{progress.status}</dd></div>
      <div><dt>Run ID</dt><dd><code>{progress.run_id}</code></dd></div>
      <div><dt>Deadline</dt><dd>{date(progress.deadline)}</dd></div>
      <div><dt>Worker limit</dt><dd>{progress.max_workers}</dd></div>
      <div><dt>Private Buzz channel</dt><dd>{progress.buzz_channel_id || 'Not yet created'}</dd></div>
      <div><dt>Approved scope digest</dt><dd><code>{progress.scope_hash}</code></dd></div>
    </dl>
    <h3>Program head and workers</h3>
    {!progress.agents.length ? <p>No agents have been registered for this run.</p> : <div className="program-progress-table"><table>
      <thead><tr><th>Agent</th><th>Role / template</th><th>Desired / observed</th><th>Last seen</th><th>Model calls</th></tr></thead>
      <tbody>{progress.agents.map(agent => <tr key={agent.id}>
        <td>{agent.name}</td><td>{agent.role} / {agent.template}</td>
        <td>{agent.desired_state} / {agent.observed_state}</td><td>{date(agent.last_seen)}</td>
        <td>{agent.model_calls} / {agent.model_call_limit}</td>
      </tr>)}</tbody>
    </table></div>}
    <h3>Recent tasks ({progress.tasks.length})</h3>
    {!progress.tasks.length ? <p>No tasks have been recorded.</p> : progress.tasks.map(task => <details className="program-progress-item" key={task.id}>
      <summary>{task.kind} · {task.state} · attempt {task.attempt}</summary>
      <p><code>{task.id}</code> · Created {date(task.created_at)}{task.completed_at ? ` · Completed ${date(task.completed_at)}` : ''}</p>
      {task.error && <pre className="program-progress-text">{task.error}</pre>}
      {task.result != null && <pre className="program-progress-text">{JSON.stringify(task.result, null, 2)}</pre>}
    </details>)}
    <h3>Reports ({progress.reports.length})</h3>
    {!progress.reports.length ? <p>No reports have been saved yet.</p> : progress.reports.map(report => <details className="program-progress-item" key={report.id}>
      <summary>{report.title} · {date(report.created_at)}</summary>
      <p>Scope digest: <code>{report.scope_hash}</code></p>
      <pre className="program-progress-text">{report.markdown}</pre>
    </details>)}
    <p className="form-help">Desired state is a controller request, not proof of a running worker. Reports are untrusted agent output, displayed as text for review. This read-only view does not start or resume work.</p>
  </div>
}

export default function ProgramProgress({ campaignId }: { campaignId: string }) {
  const [data, setData] = useState<ProgramProgressResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [updated, setUpdated] = useState<string | null>(null)
  useEffect(() => {
    let disposed = false, pending = false
    let controller: AbortController | undefined
    setData(null); setError(null); setUpdated(null)
    const refresh = async () => {
      if (pending || disposed) return
      const token = localStorage.getItem('auth_token')
      if (!token) return
      pending = true
      controller = new AbortController()
      const timeout = setTimeout(() => controller?.abort(), 20000)
      try {
        const response = await fetch(`/api/campaigns/${encodeURIComponent(campaignId)}/progress`, {
          headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal,
        })
        if (!response.ok) {
          if ([401, 403].includes(response.status) && !disposed) setData(null)
          throw new Error('Progress request failed')
        }
        const result = await response.json() as ProgramProgressResponse & { success: boolean }
        if (!result.success) throw new Error('Progress request failed')
        if (!disposed) { setData(result); setError(null); setUpdated(new Date().toISOString()) }
      } catch {
        if (!disposed) setError('Progress could not be refreshed. Any displayed state is from the last successful refresh.')
      } finally { clearTimeout(timeout); pending = false }
    }
    void refresh()
    const timer = setInterval(() => { void refresh() }, 30000)
    return () => { disposed = true; clearInterval(timer); controller?.abort() }
  }, [campaignId])
  return <section className="campaign-scope-section program-progress" aria-label="Live program progress">
    <h2 className="section-title">Live program progress</h2>
    <p className="form-help">Refreshes every 30 seconds.{updated ? ` Last refreshed ${date(updated)}.` : ''}</p>
    {error && <p role="alert">{error}</p>}
    {!data && !error && <p>Loading program progress...</p>}
    {data && (!data.configured ? <p>Program orchestration is not configured for this backend.</p> : !data.progress ? <p>No orchestration run is linked to this campaign.</p> : <ProgramProgressView progress={data.progress} />)}
  </section>
}
