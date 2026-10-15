import type { NextApiRequest, NextApiResponse } from 'next'
import { database } from '../../../../../../src/server/runtime'
import { authenticatedUser, apiFailure } from '../../../../../../src/server/auth'
import type { CandidateReviewDecision } from '../../../../../../src/lib/programProgress'

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i
const sha256 = /^[a-f0-9]{64}$/

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const userId = authenticatedUser(req, res)
  if (!userId) return
  const { id, candidateId } = req.query
  if (typeof id !== 'string' || !id || typeof candidateId !== 'string' || !uuid.test(candidateId)) {
    return res.status(400).json({ error: 'Campaign and candidate IDs are required' })
  }
  const body = req.body as Record<string, unknown> | null
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).some(key => !['decision', 'note', 'result_id', 'reproduction_sha256'].includes(key))) {
    return res.status(400).json({ error: 'Invalid candidate review' })
  }
  const { decision, note, result_id: resultId, reproduction_sha256: reproductionSha256 } = body
  if (!['reportable', 'rejected', 'duplicate'].includes(String(decision)) ||
      typeof note !== 'string' || note.trim().length < (decision === 'reportable' ? 40 : 20) || note.trim().length > 1200 ||
      (decision === 'reportable'
        ? typeof resultId !== 'string' || !uuid.test(resultId) || typeof reproductionSha256 !== 'string' || !sha256.test(reproductionSha256)
        : resultId != null || reproductionSha256 != null)) {
    return res.status(400).json({ error: 'A valid decision and review evidence are required' })
  }
  try {
    const db = database()
    if (await db.campaignRole(userId, id) !== 'owner') {
      return res.status(403).json({ error: 'Only the campaign owner can disposition candidates' })
    }
    if (!await db.candidateReviewAvailable()) {
      return res.status(503).json({ error: 'Candidate review is not configured for this backend' })
    }
    const review = await db.reviewCandidate(userId, id, candidateId, decision as CandidateReviewDecision,
      note.trim(), decision === 'reportable' ? resultId as string : null,
      decision === 'reportable' ? reproductionSha256 as string : null)
    return res.json({ success: true, review })
  } catch { return apiFailure(res, 'candidate_review') }
}
