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
