import type { NextApiRequest, NextApiResponse } from 'next'
import { database } from '../../../../src/server/runtime'
import { authenticatedUser, apiFailure } from '../../../../src/server/auth'
import type { ProgramControlAction } from '../../../../src/lib/programProgress'

const blockedMessage: Record<string, string> = {
  eligibility_refresh_required: 'Resume blocked: a fresh verified program-eligibility attestation is required.',
  operator_hold: 'Resume blocked by an operator hold. Review the run before trying again.',
  agent_hold: 'Resume blocked because an agent is held or stopped. Review the run before trying again.',
  not_continuous: 'Resume blocked: this run is not approved for continuous work.',
  scope_mismatch: 'Resume blocked: the saved console scope or policy no longer matches the approved run.',
  run_not_controllable: 'This run is not active or paused and cannot be controlled from the console.',
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const userId = authenticatedUser(req, res)
  if (!userId) return
  const { id } = req.query
  if (typeof id !== 'string' || !id) return res.status(400).json({ error: 'Campaign ID is required' })
  const action: unknown = req.body?.action
  if (action !== 'pause' && action !== 'resume') return res.status(400).json({ error: 'Invalid program action' })
  try {
    const db = database()
    const role = await db.campaignRole(userId, id)
    if (!role) return res.status(403).json({ error: 'Access denied' })
    if (role !== 'owner' && role !== 'manager') return res.status(403).json({ error: 'Only owners and managers can control programs' })
    if (!await db.programControlAvailable()) return res.status(503).json({ error: 'Program control is not configured for this backend' })
    const progress = await db.campaignProgress(userId, id)
    if (!progress?.progress) return res.status(409).json({ error: 'No orchestration run is linked to this campaign' })
    const result = await db.controlProgram(userId, id, action as ProgramControlAction)
    if (!result.ok) return res.status(409).json({ error: blockedMessage[result.reason ?? ''] ?? 'Program control was blocked; review the run state.', reason: result.reason, control: result })
    return res.json({ success: true, control: result })
  } catch { return apiFailure(res, 'program_control') }
}
