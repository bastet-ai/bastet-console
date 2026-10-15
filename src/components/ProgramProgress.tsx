import React, { useEffect, useState } from 'react'
import type { CandidateReviewDecision, ProgramControlAction, ProgramProgress as Progress, ProgramProgressResponse } from '../lib/programProgress'

const date = (value: string | null) => value ? new Date(value).toLocaleString() : 'Not yet recorded'
const count = (value: number) => new Intl.NumberFormat().format(value)
type ReviewSubmission = { candidateId: string; decision: CandidateReviewDecision; note: string; resultId: string | null; reproductionSha256: string | null }

function CandidateReviewForm({ candidateId, options, busy, onReview }: {
  candidateId: string; options: { result_id: string; recorded_at: string }[]; busy: boolean
  onReview: (submission: ReviewSubmission) => Promise<void>
}) {
  const [decision, setDecision] = useState<CandidateReviewDecision>('rejected')
  const [note, setNote] = useState('')
  const [resultId, setResultId] = useState('')
  const [reproductionSha256, setReproductionSha256] = useState<string | null>(null)
  const [evidenceName, setEvidenceName] = useState<string | null>(null)
  const [evidenceError, setEvidenceError] = useState<string | null>(null)
  const [independent, setIndependent] = useState(false)
  const hashSequence = React.useRef(0)
  const hashEvidence = async (file: File | undefined) => {
    const sequence = ++hashSequence.current
    setReproductionSha256(null); setEvidenceName(null); setEvidenceError(null)
    if (!file) return
    if (file.size > 10 * 1024 * 1024) { setEvidenceError('Choose an evidence file no larger than 10 MiB.'); return }
    try {
      const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
      if (sequence !== hashSequence.current) return
      setReproductionSha256(Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join(''))
      setEvidenceName(file.name)
    } catch { if (sequence === hashSequence.current) setEvidenceError('The evidence file could not be hashed locally.') }
  }
  const reportable = decision === 'reportable'
  const valid = note.trim().length >= (reportable ? 40 : 20) &&
    (!reportable || Boolean(resultId && reproductionSha256 && independent))
  return <form className="program-candidate-review" onSubmit={event => {
    event.preventDefault()
    if (!valid || busy) return
    void onReview({ candidateId, decision, note: note.trim(), resultId: reportable ? resultId : null,
      reproductionSha256: reportable ? reproductionSha256 : null })
  }}>
    <h4>Owner decision</h4>
    <label>Disposition <select value={decision} disabled={busy} onChange={event => setDecision(event.target.value as CandidateReviewDecision)}>
      <option value="rejected">Reject</option><option value="duplicate">Duplicate</option>
      {options.length > 0 && <option value="reportable">Reportable after independent reproduction</option>}
    </select></label>
    {reportable && <>
      <label>Verified runtime result <select value={resultId} disabled={busy} onChange={event => setResultId(event.target.value)}>
        <option value="">Select the matching result</option>
        {options.map(option => <option key={option.result_id} value={option.result_id}>{date(option.recorded_at)} · {option.result_id}</option>)}
      </select></label>
      <label>Independent reproduction evidence file <input type="file" disabled={busy}
        onChange={event => { void hashEvidence(event.currentTarget.files?.[0]) }} /></label>
      <p className="form-help">The file stays on this device; only its SHA-256 digest is saved. Retain the private original for human audit. Use an independent owned-instance reproduction, not the automated test output.</p>
      {evidenceName && <p>Hashed locally: {evidenceName} · <code>{reproductionSha256}</code></p>}
      {evidenceError && <p role="alert">{evidenceError}</p>}
      <label><input type="checkbox" checked={independent} disabled={busy}
        onChange={event => setIndependent(event.target.checked)} /> I independently reproduced the impact using an authorized identity and reviewed the negative control and cleanup.</label>
    </>}
    <label>Review note <textarea value={note} maxLength={1200} disabled={busy}
      onChange={event => setNote(event.target.value)} placeholder="Explain the human decision and evidence limitations" /></label>
    <button type="submit" className="form-button form-button-secondary" disabled={busy || !valid}>
      {busy ? 'Saving decision...' : 'Save owner decision'}
    </button>
  </form>
}

export function ProgramProgressView({ progress, canReview = false, reviewBusy = false, onReview }: {
  progress: Progress; canReview?: boolean; reviewBusy?: boolean; onReview?: (submission: ReviewSubmission) => Promise<void>
}) {
  const funnel = progress.research_funnel
  return <div className="program-progress-content">
    <dl className="program-progress-summary">
      <div><dt>Run status</dt><dd>{progress.status}</dd></div>
      <div><dt>Run ID</dt><dd><code>{progress.run_id}</code></dd></div>
      <div><dt>Deadline</dt><dd>{date(progress.deadline)}</dd></div>
      <div><dt>Worker limit</dt><dd>{progress.max_workers}</dd></div>
      <div><dt>Private Buzz channel</dt><dd>{progress.buzz_channel_id || 'Not yet created'}</dd></div>
      <div><dt>Approved scope digest</dt><dd><code>{progress.scope_hash}</code></dd></div>
    </dl>
    <h3>Research funnel</h3>
    {!funnel ? <p>Research funnel metrics are not available from this backend.</p> : <>
      <dl className="program-progress-summary">
        <div><dt>Fresh-eligible approved asset entries</dt><dd>{count(funnel.eligible_asset_count)} / {count(funnel.approved_asset_entries)}</dd></div>
        <div><dt>Hypotheses</dt><dd>{count(funnel.hypotheses.total)} total · {count(funnel.hypotheses.untested)} untested</dd></div>
        <div><dt>Test outcomes</dt><dd>{count(funnel.hypotheses.negative)} negative · {count(funnel.hypotheses.inconclusive)} inconclusive · {count(funnel.hypotheses.verified_runtime)} verified runtime</dd></div>
        <div><dt>Live-test jobs</dt><dd>{count(funnel.test_jobs.total)} total · {count(funnel.test_jobs.pending + funnel.test_jobs.running)} open · {count(funnel.test_jobs.cleanup_failed)} cleanup failed</dd></div>
        <div><dt>Bounded test requests</dt><dd>{count(funnel.test_requests)}</dd></div>
        <div><dt>Human decisions</dt><dd>{count(funnel.candidate_decisions.human_reviewed)} reviewed · {count(funnel.candidate_decisions.reportable)} marked reportable · {count(funnel.candidate_decisions.pending)} pending</dd></div>
        <div><dt>Failed tasks</dt><dd>{count(funnel.task_failures)}{funnel.task_failures_by_kind.length ? ` (${funnel.task_failures_by_kind.map(item => `${item.kind}: ${item.count}`).join(', ')})` : ''}</dd></div>
        <div><dt>Completed cycle time</dt><dd>{count(funnel.completed_cycle_seconds)} seconds across {count(funnel.completed_cycles)} cycles</dd></div>
        <div><dt>Model calls</dt><dd>{count(funnel.model_calls)} · monetary cost unavailable</dd></div>
        <div><dt>Last created task</dt><dd>{date(funnel.last_task_created_at)}</dd></div>
        <div><dt>Last test result</dt><dd>{date(funnel.last_test_result_at)}</dd></div>
        <div><dt>Last policy refresh</dt><dd>{date(funnel.policy_refresh_at)}</dd></div>
      </dl>
      <p className="form-help">Counts come from durable run records, not service health or agent heartbeats. Approved entries are not permission to test; fresh eligibility may be zero while a run is paused. A verified runtime result is not a human-reviewed, reportable bug.</p>
    </>}
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
    <h3>Research candidates ({Array.isArray(progress.candidates)
      ? `${progress.candidates.length} shown of ${progress.candidate_count ?? 'unknown'}; ${progress.pending_candidate_count ?? 'unknown'} awaiting review`
      : 'unavailable'})</h3>
    {!Array.isArray(progress.candidates) ? <p>Candidate review data is not available from this backend.</p>
      : !progress.candidates.length ? <p>No candidate proposals have been recorded.</p>
        : progress.candidates.map(candidate => <details className="program-progress-item" key={candidate.id}>
          <summary>{candidate.title} · {candidate.status} · severity {candidate.severity}</summary>
          <p>Generation {candidate.generation} · Task <code>{candidate.task_id}</code> ({candidate.task_kind ?? 'task link unavailable'}) · Created {date(candidate.created_at)}</p>
          <p>Task scope digest: {candidate.task_scope_hash ? <code>{candidate.task_scope_hash}</code> : 'unavailable; check provenance'}</p>
          <pre className="program-progress-text">{candidate.summary}</pre>
          <h4>Recorded evidence and verification proposal</h4>
          <pre className="program-progress-text">{JSON.stringify(candidate.evidence, null, 2)}</pre>
          {candidate.reviewed_at && <p>Reviewed {date(candidate.reviewed_at)}</p>}
          {candidate.review_note && <pre className="program-progress-text">{candidate.review_note}</pre>}
          {canReview && onReview && funnel && candidate.status === 'needs_review' && <CandidateReviewForm
            candidateId={candidate.id} options={funnel.candidate_review_options.filter(option => option.candidate_id === candidate.id)}
            busy={reviewBusy} onReview={onReview} />}
        </details>)}
    <p className="form-help">Desired state is a controller request, not proof of a running worker. Reports and candidate proposals are untrusted agent output, displayed as text for private human review; the candidate list is capped at 20 with needs_review first. A needs_review proposal is not a verified or reportable bug. Run status is distinct from campaign metadata; authorized controls can request a guarded transition.</p>
  </div>
}

export function ProgramControlActions({ status, available, busy, campaignName, onControl }: {
  status: string; available: boolean; busy: boolean; campaignName: string; onControl: (action: ProgramControlAction) => void
}) {
  const action: ProgramControlAction | null = status === 'active' ? 'pause' : status === 'paused' ? 'resume' : null
  if (!action) return null
  return <div className="program-control-actions">
    <button type="button" className={`form-button ${action === 'pause' ? 'form-button-secondary' : 'form-button-primary'}`}
      disabled={busy || !available} onClick={() => onControl(action)}
      aria-label={`${action === 'pause' ? 'Pause' : 'Resume'} ${campaignName} program run`}>
      {busy ? 'Applying...' : action === 'pause' ? '⏸ Pause program' : '▶ Resume program'}
    </button>
    {!available && <p className="form-help">Run control is not available on this backend. No status change will be made.</p>}
    {action === 'resume' && available && <p className="form-help">Resume is allowed only after fresh program eligibility and run approvals pass. A hold or stale attestation blocks it.</p>}
  </div>
}

export default function ProgramProgress({ campaignId, campaignName, canManage, canReview = false }: { campaignId: string; campaignName: string; canManage: boolean; canReview?: boolean }) {
  const [data, setData] = useState<ProgramProgressResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [updated, setUpdated] = useState<string | null>(null)
  const [controlBusy, setControlBusy] = useState(false)
  const [controlMessage, setControlMessage] = useState<string | null>(null)
  const [controlError, setControlError] = useState<string | null>(null)
  const [reviewBusy, setReviewBusy] = useState(false)
  const [reviewMessage, setReviewMessage] = useState<string | null>(null)
  const [reviewError, setReviewError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
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
  }, [campaignId, reloadKey])

  const control = async (action: ProgramControlAction) => {
    const token = localStorage.getItem('auth_token')
    if (!token) { setControlError('Sign in before controlling this program.'); return }
    setControlBusy(true); setControlError(null); setControlMessage(null)
    try {
      const response = await fetch(`/api/campaigns/${encodeURIComponent(campaignId)}/control`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action }), cache: 'no-store',
      })
      const result = await response.json() as { success?: boolean; error?: string; control?: { status: string; changed?: boolean } }
      if (!response.ok || !result.success) throw new Error(result.error || 'Program control was not applied. Refresh the run state before trying again.')
      setControlMessage(result.control?.changed === false
        ? `The run was already ${result.control.status}.`
        : `The ${action} request was applied. Refreshing observed run state; worker activity may take time to change.`)
      setReloadKey(value => value + 1)
    } catch (cause) {
      setControlError(cause instanceof Error ? cause.message : 'Program control could not be confirmed. Refresh the run state before retrying.')
    } finally { setControlBusy(false) }
  }
  const review = async ({ candidateId, decision, note, resultId, reproductionSha256 }: ReviewSubmission) => {
    const token = localStorage.getItem('auth_token')
    if (!token) { setReviewError('Sign in before reviewing candidates.'); return }
    setReviewBusy(true); setReviewError(null); setReviewMessage(null)
    try {
      const response = await fetch(`/api/campaigns/${encodeURIComponent(campaignId)}/candidates/${encodeURIComponent(candidateId)}/review`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ decision, note, result_id: resultId, reproduction_sha256: reproductionSha256 }), cache: 'no-store',
      })
      const result = await response.json() as { success?: boolean; error?: string }
      if (!response.ok || !result.success) throw new Error(result.error || 'Candidate decision was not saved.')
      setReviewMessage(`The owner decision was recorded as ${decision}. This did not submit a bounty report or resume research.`)
      setReloadKey(value => value + 1)
    } catch (cause) { setReviewError(cause instanceof Error ? cause.message : 'Candidate review could not be confirmed.') }
    finally { setReviewBusy(false) }
  }
  return <section className="campaign-scope-section program-progress" aria-label="Live program progress">
    <h2 className="section-title">Live program progress</h2>
    <p className="form-help">Refreshes every 30 seconds.{updated ? ` Last refreshed ${date(updated)}.` : ''}</p>
    {error && <p role="alert">{error}</p>}
    {!data && !error && <p>Loading program progress...</p>}
    {data && (!data.configured ? <p>Program orchestration is not configured for this backend.</p> : !data.progress ? <p>No orchestration run is linked to this campaign.</p> : <ProgramProgressView progress={data.progress}
      canReview={canReview} reviewBusy={reviewBusy} onReview={review} />)}
    {data?.progress && canManage && <ProgramControlActions status={data.progress.status} available={data.control_available}
      busy={controlBusy} campaignName={campaignName} onControl={action => { void control(action) }} />}
    {controlError && <p role="alert">{controlError}</p>}
    {controlMessage && <p role="status">{controlMessage}</p>}
    {reviewError && <p role="alert">{reviewError}</p>}
    {reviewMessage && <p role="status">{reviewMessage}</p>}
  </section>
}
