import type { NextApiRequest, NextApiResponse } from 'next'
import { database } from '../../../src/server/runtime'
import { authenticatedUser, apiFailure } from '../../../src/server/auth'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!['GET', 'POST'].includes(req.method ?? '')) return res.status(405).json({ error: 'Method not allowed' })
  res.setHeader('Cache-Control', 'no-store')
  const userId = authenticatedUser(req, res)
  if (!userId) return
  try {
    const db = database()
    if (req.method === 'GET') return res.json({ nodes: await db.nodes(userId) })
    const { name, description, node_type } = req.body ?? {}
    if (typeof name !== 'string' || !name.trim() || name.length > 255 || typeof node_type !== 'string' || !node_type.trim() || node_type.length > 100) {
      return res.status(400).json({ error: 'Name and node_type are required' })
    }
    if (description != null && typeof description !== 'string') return res.status(400).json({ error: 'Description must be a string' })
    const node = await db.createNode(userId, { name: name.trim(), description: description ?? null, node_type: node_type.trim() })
    return res.status(201).json({ node })
  } catch {
    return apiFailure(res, 'nodes')
  }
}
