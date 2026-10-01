import type { NextApiRequest, NextApiResponse } from 'next'
import { database } from '../../../src/server/runtime'
import { authenticatedUser, apiFailure } from '../../../src/server/auth'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  res.setHeader('Cache-Control', 'no-store')
  const userId = authenticatedUser(req, res)
  if (!userId) return
  try {
    const user = await database().userById(userId)
    if (!user) return res.status(401).json({ error: 'Invalid token' })
    return res.json({ valid: true, user })
  } catch {
    return apiFailure(res, 'verify_session')
  }
}
