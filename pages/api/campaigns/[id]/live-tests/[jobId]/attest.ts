import type { NextApiRequest, NextApiResponse } from 'next'
import { database } from '../../../../../../src/server/runtime'
import { authenticatedUser, apiFailure } from '../../../../../../src/server/auth'
import type { RuntimeAttestationProof, RuntimeImpactKind } from '../../../../../../src/lib/programProgress'

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i
const sha256 = /^[a-f0-9]{64}$/
const digestFields = [
  'fixture_ownership_sha256', 'before_state_sha256', 'after_state_sha256',
  'impact_evidence_sha256', 'negative_control_sha256', 'cleanup_sha256',
  'independent_reproduction_sha256'
] as const
const allowedFields = new Set<string>(['impact_kind', 'cleanup_status', ...digestFields])
const impactKinds = new Set<RuntimeImpactKind>([
  'unauthorized_read', 'unauthorized_write', 'cross_account_access',
  'privilege_escalation', 'authentication_bypass'
])

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
      !impactKinds.has(body.impact_kind as RuntimeImpactKind) ||
      !['clean', 'not_applicable'].includes(String(body.cleanup_status)) ||
      digestFields.some(key => typeof body[key] !== 'string' || !sha256.test(body[key] as string)) ||
      new Set(digestFields.map(key => body[key])).size !== digestFields.length) {
    return res.status(400).json({ error: 'A complete redacted runtime attestation is required' })
  }
  try {
    const db = database()
    if (await db.campaignRole(userId, id) !== 'owner') {
      return res.status(403).json({ error: 'Only the campaign owner can attest runtime impact' })
    }
    if (!await db.runtimeAttestationAvailable()) {
      return res.status(503).json({ error: 'Runtime attestation is not configured for this backend' })
    }
    const attestation = await db.attestLiveTest(userId, id, jobId, body as unknown as RuntimeAttestationProof)
    return res.json({ success: true, attestation })
  } catch { return apiFailure(res, 'runtime_attestation') }
}
