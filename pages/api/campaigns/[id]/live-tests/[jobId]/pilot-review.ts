import type { NextApiRequest, NextApiResponse } from 'next'
import { database } from '../../../../../../src/server/runtime'
import { authenticatedUser, apiFailure } from '../../../../../../src/server/auth'
import type { PilotReviewProof } from '../../../../../../src/lib/programProgress'

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i
const sha256 = /^[a-f0-9]{64}$/
const digestFields = [
  'fixture_ownership_sha256', 'request_trace_sha256', 'negative_control_sha256',
  'before_state_sha256', 'after_cleanup_state_sha256', 'cleanup_sha256',
  'independent_replay_sha256'
] as const
const distinctFields = digestFields.filter(key => key !== 'after_cleanup_state_sha256')
const allowedFields = new Set<string>(['cleanup_status', ...digestFields])

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const userId = authenticatedUser(req, res)
  if (!userId) return
  const { id, jobId } = req.query
  if (typeof id !== 'string' || !id || typeof jobId !== 'string' || !uuid.test(jobId)) {
    return res.status(400).json({ error: 'Campaign and test job IDs are required' })
  }
  const body = req.body as Record<string, unknown> | null
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).length !== allowedFields.size ||
      Object.keys(body).some(key => !allowedFields.has(key)) ||
      !['clean', 'not_applicable'].includes(String(body.cleanup_status)) ||
      digestFields.some(key => typeof body[key] !== 'string' || !sha256.test(body[key] as string)) ||
      new Set(distinctFields.map(key => body[key])).size !== distinctFields.length ||
      body.before_state_sha256 !== body.after_cleanup_state_sha256 ||
      JSON.stringify(body).length > 1500) {
    return res.status(400).json({ error: 'A complete redacted pilot review is required' })
  }
  try {
    const db = database()
    if (await db.campaignRole(userId, id) !== 'owner') {
      return res.status(403).json({ error: 'Only the campaign owner can review a pilot' })
    }
    if (!await db.pilotReviewAvailable()) {
      return res.status(503).json({ error: 'Pilot review is not configured for this backend' })
    }
    const review = await db.reviewLiveTestPilot(userId, id, jobId, body as unknown as PilotReviewProof)
    return res.json({ success: true, review })
  } catch { return apiFailure(res, 'pilot_review') }
}
