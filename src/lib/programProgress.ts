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
}

export interface ProgramProgressResponse {
  configured: boolean
  progress: ProgramProgress | null
}
