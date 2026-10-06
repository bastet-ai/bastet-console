import type { CampaignInput } from './database'
import { normalizeHackerOneHandle } from './hackerone'

// A client digest is an optimistic-concurrency claim, never authoritative metadata.
export function hackerOneSnapshotDigest(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const snapshot = (metadata as Record<string, unknown>).scope_snapshot
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null
  const sha256 = (snapshot as Record<string, unknown>).sha256
  return typeof sha256 === 'string' && /^[a-f0-9]{64}$/.test(sha256) ? sha256 : null
}

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
    if (typeof data.hackerone_handle !== 'string') return { error: 'Invalid HackerOne handle or program URL' }
    try { value.hackerone_handle = normalizeHackerOneHandle(data.hackerone_handle) }
    catch { return { error: 'Invalid HackerOne handle or program URL' } }
  }
  return { value }
}
