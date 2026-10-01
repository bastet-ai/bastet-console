import type { NextApiRequest, NextApiResponse } from 'next'
import type { Role } from '../../../../src/server/database'
import { database } from '../../../../src/server/runtime'
import { authenticatedUser, apiFailure } from '../../../../src/server/auth'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!['GET', 'POST', 'PUT', 'DELETE'].includes(req.method ?? '')) return res.status(405).json({ error: 'Method not allowed' })
  res.setHeader('Cache-Control', 'no-store')
  const userId = authenticatedUser(req, res)
  if (!userId) return
  const { id } = req.query
  if (typeof id !== 'string' || !id) return res.status(400).json({ error: 'Campaign ID is required' })
  try {
    const db = database()
    const actorRole = await db.campaignRole(userId, id)
    if (!actorRole) return res.status(403).json({ error: 'Access denied' })
    if (req.method === 'GET') return res.json({ success: true, members: await db.members(userId, id) })
    if (!['owner', 'manager'].includes(actorRole)) return res.status(403).json({ error: 'Only owners and managers can manage members' })
    const { user_id, member_id, role = req.method === 'POST' ? 'watcher' : undefined } = req.body ?? {}
    if (req.method === 'DELETE') {
      if (typeof member_id !== 'string' || !member_id) return res.status(400).json({ error: 'Member ID is required' })
      if (!await db.removeMember(userId, id, member_id)) return res.status(403).json({ error: 'Member cannot be removed' })
      return res.json({ success: true, message: 'Member removed successfully' })
    }
    if (!['owner', 'manager', 'collaborator', 'watcher'].includes(role)) return res.status(400).json({ error: 'Invalid role' })
    if (role === 'owner' && actorRole !== 'owner') return res.status(403).json({ error: 'Only owners can grant the owner role' })
    if (req.method === 'POST') {
      if (typeof user_id !== 'string' || !user_id) return res.status(400).json({ error: 'User ID is required' })
      if (!await db.userById(user_id)) return res.status(400).json({ error: 'User not found' })
      if ((await db.members(userId, id)).some(member => member.user_id === user_id)) return res.status(400).json({ error: 'User is already a member of this campaign' })
      const member = await db.addMember(userId, id, user_id, role as Role)
      return member ? res.status(201).json({ success: true, member }) : res.status(403).json({ error: 'Access denied' })
    }
    if (typeof member_id !== 'string' || !member_id) return res.status(400).json({ error: 'Member ID is required' })
    const member = await db.updateMember(userId, id, member_id, role as Role)
    return member ? res.json({ success: true, member }) : res.status(403).json({ error: 'Member cannot be updated' })
  } catch {
    return apiFailure(res, 'campaign_members')
  }
}
