import type { NextApiRequest, NextApiResponse } from 'next'
import { database } from '../../../src/server/runtime'
import { authenticatedUser, apiFailure } from '../../../src/server/auth'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  res.setHeader('Cache-Control', 'no-store')
  const userId = authenticatedUser(req, res)
  if (!userId) return
  const { campaign_id, limit = '50', offset = '0' } = req.query
  if ((campaign_id !== undefined && typeof campaign_id !== 'string') || typeof limit !== 'string' || typeof offset !== 'string' ||
    !/^\d+$/.test(limit) || !/^\d+$/.test(offset) || !Number.isSafeInteger(Number(offset)) || Number(limit) < 1 || Number(limit) > 100) {
    return res.status(400).json({ error: 'Invalid pagination or campaign ID' })
  }
  try {
    const db = database()
    if (campaign_id && !await db.campaignRole(userId, campaign_id)) return res.status(403).json({ error: 'Access denied' })
    const activities = await db.activities(userId, campaign_id || null, Number(limit), Number(offset))
    return res.json({ success: true, activities })
  } catch {
    return apiFailure(res, 'campaign_activities')
  }
}
