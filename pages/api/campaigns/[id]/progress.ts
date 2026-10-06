import type { NextApiRequest, NextApiResponse } from 'next'
import { database } from '../../../../src/server/runtime'
import { authenticatedUser, apiFailure } from '../../../../src/server/auth'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const userId = authenticatedUser(req, res)
  if (!userId) return
  const { id } = req.query
  if (typeof id !== 'string' || !id) return res.status(400).json({ error: 'Campaign ID is required' })
  try {
    const result = await database().campaignProgress(userId, id)
    if (!result) return res.status(403).json({ error: 'Access denied' })
    return res.json({ success: true, ...result })
  } catch { return apiFailure(res, 'campaign_progress') }
}
