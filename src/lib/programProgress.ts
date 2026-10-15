export interface ProgramProgress {
  run_id: string
  handle: string
  status: string
  scope_hash: string
  deadline: string | null
  buzz_channel_id: string | null
  max_workers: number
  agents: {
    id: string; name: string; template: string; role: string
    desired_state: string; observed_state: string; last_seen: string | null
    model_calls: number; model_call_limit: number
  }[]
  tasks: {
    id: string; kind: string; state: string; attempt: number
    result: unknown; error: string | null; created_at: string; completed_at: string | null
  }[]
  reports: { id: string; title: string; markdown: string; scope_hash: string; created_at: string }[]
  candidate_count?: number
  pending_candidate_count?: number
  candidates?: {
    id: string; generation: number; task_id: string; task_kind: string | null; task_scope_hash: string | null
    title: string; summary: string; severity: string; evidence: unknown; status: string
    created_at: string; reviewed_at: string | null; review_note: string | null
  }[]
  research_funnel?: ResearchFunnel
}

export interface ResearchFunnel {
  approved_asset_entries: number
  eligible_asset_count: number
  policy_refresh_at: string | null
  hypotheses: { total: number; untested: number; negative: number; inconclusive: number; verified_runtime: number }
  test_jobs: { total: number; pending: number; running: number; complete: number; inconclusive: number; failed: number; cleanup_failed: number; cancelled: number }
  test_requests: number
  candidate_decisions: { pending: number; human_reviewed: number; reportable: number; rejected: number; duplicate: number }
  task_failures: number
  task_failures_by_kind: { kind: string; count: number }[]
  model_calls: number
  completed_cycles: number
  completed_cycle_seconds: number
  last_task_created_at: string | null
  last_test_result_at: string | null
  candidate_review_options: { candidate_id: string; result_id: string; recorded_at: string }[]
}

export type CandidateReviewDecision = 'reportable' | 'rejected' | 'duplicate'

export interface CandidateReviewResult {
  ok: boolean
  candidate_id: string
  status: CandidateReviewDecision
  reviewed_at: string
}

export type RuntimeImpactKind = 'unauthorized_read' | 'unauthorized_write' | 'cross_account_access' | 'privilege_escalation' | 'authentication_bypass'

export interface RuntimeAttestationProof {
  impact_kind: RuntimeImpactKind
  cleanup_status: 'clean' | 'not_applicable'
  fixture_ownership_sha256: string
  before_state_sha256: string
  after_state_sha256: string
  impact_evidence_sha256: string
  negative_control_sha256: string
  cleanup_sha256: string
  independent_reproduction_sha256: string
}

export interface RuntimeAttestationResult {
  ok: true
  attestation_id: string
  result_id: string
  job_id: string
  hypothesis_id: string
  classification: 'verified_runtime'
  candidate_created: false
}

export interface PilotReviewProof {
  cleanup_status: 'clean' | 'not_applicable'
  fixture_ownership_sha256: string
  request_trace_sha256: string
  negative_control_sha256: string
  before_state_sha256: string
  after_cleanup_state_sha256: string
  cleanup_sha256: string
  independent_replay_sha256: string
}

export interface PilotReviewResult {
  ok: true
  review_id: string
  job_id: string
  manifest_id: string
  hypothesis_id: string
  classification: 'controlled_pilot'
  candidate_created: false
}

export interface ProgramProgressResponse {
  configured: boolean
  control_available: boolean
  progress: ProgramProgress | null
}

export type ProgramControlAction = 'pause' | 'resume'

export interface ProgramControlResult {
  ok: boolean
  action: ProgramControlAction
  status: string
  changed?: boolean
  reason?: 'eligibility_refresh_required' | 'operator_hold' | 'agent_hold' | 'not_continuous' | 'scope_mismatch' | 'run_not_controllable'
}
