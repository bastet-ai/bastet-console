import type { NextApiRequest, NextApiResponse } from 'next'
import { database } from '../../../src/server/runtime'
import { authenticatedUser, apiFailure } from '../../../src/server/auth'
import { fetchHackerOneProgram, hackerOneScope, hackerOneMetadata } from '../../../src/server/hackerone'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  res.setHeader('Cache-Control', 'no-store')
  const userId = authenticatedUser(req, res)
  if (!userId) return
  const { campaignId } = req.body ?? {}
  if (typeof campaignId !== 'string' || !campaignId) return res.status(400).json({ error: 'Campaign ID is required' })
  try {
    const db = database()
    const role = await db.campaignRole(userId, campaignId)
    if (!role || !['owner', 'manager'].includes(role)) return res.status(403).json({ error: 'Only campaign owners and managers can sync campaigns' })
    const campaign = await db.campaign(userId, campaignId)
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' })
    if (typeof campaign.hackerone_handle !== 'string' || !campaign.hackerone_handle) {
      return res.status(400).json({ error: 'This campaign is not linked to a HackerOne program' })
    }
    const team = await fetchHackerOneProgram(campaign.hackerone_handle)
    if (!team) return res.status(404).json({ error: 'Program not found on HackerOne' })
    const timestamp = new Date().toISOString()
    const updatedCampaign = await db.updateCampaign(userId, campaignId, {
      name: team.name || String(campaign.name),
      description: team.about || (campaign.description as string | null),
      scope: hackerOneScope(team),
      hackerone_last_synced: timestamp,
      hackerone_metadata: { ...hackerOneMetadata(team), synced_at: timestamp }
    })
    if (!updatedCampaign) return res.status(403).json({ error: 'Access denied' })
    return res.json({ success: true, campaign: updatedCampaign, message: 'Campaign synced successfully with HackerOne' })
  } catch {
    return apiFailure(res, 'campaign_sync')
  }
}
