import type { NextApiRequest, NextApiResponse } from 'next'
import type { CampaignInput } from '../../../src/server/database'
import { database } from '../../../src/server/runtime'
import { authenticatedUser, apiFailure } from '../../../src/server/auth'
import { campaignInput } from '../../../src/server/campaign-validation'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!['GET', 'POST'].includes(req.method ?? '')) return res.status(405).json({ error: 'Method not allowed' })
  res.setHeader('Cache-Control', 'no-store')
  const userId = authenticatedUser(req, res)
  if (!userId) return
  try {
    const db = database()
    if (req.method === 'GET') return res.json({ success: true, campaigns: await db.campaigns(userId) })
    const { value, error } = campaignInput(req.body)
    if (error || !value) return res.status(400).json({ error })
    const campaign = await db.createCampaign(userId, value as CampaignInput)
    return res.status(201).json({ success: true, campaign: { ...campaign, campaign_members: [{ role: 'owner' }] } })
  } catch {
    return apiFailure(res, 'campaigns')
  }
}
