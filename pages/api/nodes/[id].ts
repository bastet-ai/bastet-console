import type { NextApiRequest, NextApiResponse } from 'next'
import { database } from '../../../src/server/runtime'
import { authenticatedUser, apiFailure } from '../../../src/server/auth'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!['GET', 'PUT', 'DELETE'].includes(req.method ?? '')) return res.status(405).json({ error: 'Method not allowed' })
  res.setHeader('Cache-Control', 'no-store')
  const userId = authenticatedUser(req, res)
  if (!userId) return
  const { id } = req.query
  if (typeof id !== 'string' || !id) return res.status(400).json({ error: 'Invalid node ID' })
  try {
    const db = database()
    if (req.method === 'DELETE') {
      if (!await db.deleteNode(userId, id)) return res.status(404).json({ error: 'Node not found' })
      return res.json({ success: true, message: 'Node deleted successfully' })
    }
    if (req.method === 'GET') {
      const node = await db.node(userId, id)
      return node ? res.json({ node }) : res.status(404).json({ error: 'Node not found' })
    }
    const { name, description, status } = req.body ?? {}
    if (name !== undefined && (typeof name !== 'string' || !name.trim() || name.length > 255)) return res.status(400).json({ error: 'Invalid name' })
    if (description != null && typeof description !== 'string') return res.status(400).json({ error: 'Invalid description' })
    if (status !== undefined && !['online', 'offline', 'error'].includes(status)) return res.status(400).json({ error: 'Invalid status' })
    const node = await db.updateNode(userId, id, { name: name?.trim(), description, status })
    return node ? res.json({ node }) : res.status(404).json({ error: 'Node not found' })
  } catch {
    return apiFailure(res, 'node')
  }
}
