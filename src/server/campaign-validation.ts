import type { CampaignInput } from './database'

export function campaignInput(body: unknown, partial = false): { value?: Partial<CampaignInput>; error?: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Invalid campaign data' }
  const data = body as Record<string, unknown>
  const value: Partial<CampaignInput> = {}
  for (const field of ['name', 'scope'] as const) {
    if (!partial || data[field] !== undefined) {
      if (typeof data[field] !== 'string' || !data[field].trim()) return { error: `Campaign ${field} is required` }
      if (field === 'name' && data[field].length > 255) return { error: 'Campaign name must be 255 characters or less' }
      value[field] = data[field].trim()
    }
  }
  if (data.description !== undefined) {
    if (typeof data.description !== 'string') return { error: 'Description must be a string' }
    value.description = data.description.trim()
  }
  if (data.privacy !== undefined) {
    if (data.privacy !== 'public' && data.privacy !== 'private') return { error: 'Invalid privacy' }
    value.privacy = data.privacy
  }
  if (data.status !== undefined) {
    if (typeof data.status !== 'string' || !['active', 'paused', 'completed', 'archived'].includes(data.status)) return { error: 'Invalid status' }
    value.status = data.status
  }
  if (!partial && data.hackerone_handle !== undefined) {
    if (typeof data.hackerone_handle !== 'string' || !/^[a-zA-Z0-9_-]{1,255}$/.test(data.hackerone_handle)) return { error: 'Invalid HackerOne handle' }
    value.hackerone_handle = data.hackerone_handle
    value.hackerone_metadata = data.hackerone_metadata ?? null
  }
  return { value }
}
