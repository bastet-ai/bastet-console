import type { NextApiRequest, NextApiResponse } from 'next'
import { database } from '../../../src/server/runtime'
import { authenticatedUser, apiFailure } from '../../../src/server/auth'
import { campaignInput } from '../../../src/server/campaign-validation'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!['GET', 'PUT', 'DELETE'].includes(req.method ?? '')) return res.status(405).json({ error: 'Method not allowed' })
  res.setHeader('Cache-Control', 'no-store')
  const userId = authenticatedUser(req, res)
  if (!userId) return
  const { id } = req.query
  if (typeof id !== 'string' || !id) return res.status(400).json({ error: 'Campaign ID is required' })
  try {
    const db = database()
    const role = await db.campaignRole(userId, id)
    if (!role) return res.status(403).json({ error: 'Access denied' })
    if (req.method === 'GET') {
      const campaign = await db.campaign(userId, id)
      if (!campaign) return res.status(404).json({ error: 'Campaign not found' })
      return res.json({ success: true, campaign: { ...campaign, campaign_members: await db.members(userId, id), userRole: role } })
    }
    if (req.method === 'DELETE') {
      if (role !== 'owner') return res.status(403).json({ error: 'Only campaign owners can delete campaigns' })
      if (!await db.deleteCampaign(userId, id)) return res.status(403).json({ error: 'Access denied' })
      return res.json({ success: true, message: 'Campaign deleted successfully' })
    }
    if (!['owner', 'manager'].includes(role)) return res.status(403).json({ error: 'Only owners and managers can update campaigns' })
    const { value, error } = campaignInput(req.body, true)
    if (error || !value) return res.status(400).json({ error })
    const existingCampaign = await db.campaign(userId, id)
    if (!existingCampaign) return res.status(404).json({ error: 'Campaign not found' })
    if (existingCampaign.hackerone_handle) {
      if (value.privacy === 'public') return res.status(400).json({ error: 'HackerOne-linked campaigns must remain private' })
      if (value.scope !== undefined) return res.status(400).json({ error: 'Use HackerOne sync to review and update the authoritative scope' })
      value.privacy = 'private'
    }
    const campaign = await db.updateCampaign(userId, id, value)
    return campaign ? res.json({ success: true, campaign }) : res.status(403).json({ error: 'Access denied' })
  } catch {
    return apiFailure(res, 'campaign')
  }
}
