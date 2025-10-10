import { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import jwt from 'jsonwebtoken'

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Middleware to verify JWT token
function verifyToken(req: NextApiRequest) {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) {
    throw new Error('No token provided')
  }
  
  return jwt.verify(token, process.env.JWT_SECRET!) as any
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // Verify authentication
    const { userId } = verifyToken(req)
    const { id } = req.query
    
    if (!id || typeof id !== 'string') {
      return res.status(400).json({ error: 'Invalid node ID' })
    }
    
    switch (req.method) {
      case 'GET':
        return await getNode(req, res, userId, id)
      case 'PUT':
        return await updateNode(req, res, userId, id)
      case 'DELETE':
        return await deleteNode(req, res, userId, id)
      default:
        return res.status(405).json({ error: 'Method not allowed' })
    }
  } catch (error) {
    console.error('API Error:', error)
    return res.status(401).json({ error: 'Unauthorized' })
  }
}

async function getNode(req: NextApiRequest, res: NextApiResponse, userId: string, nodeId: string) {
  try {
    const { data: node, error } = await supabase
      .from('bastet_nodes')
      .select('*')
      .eq('id', nodeId)
      .eq('user_id', userId)
      .single()
    
    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'Node not found' })
      }
      console.error('Error fetching node:', error)
      return res.status(500).json({ error: 'Failed to fetch node' })
    }
    
    res.json({ node })
  } catch (error) {
    console.error('Error in getNode:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}

async function updateNode(req: NextApiRequest, res: NextApiResponse, userId: string, nodeId: string) {
  try {
    const { name, description, status } = req.body
    
    const updateData: any = {
      updated_at: new Date().toISOString()
    }
    
    if (name !== undefined) updateData.name = name
    if (description !== undefined) updateData.description = description
    if (status !== undefined) updateData.status = status
    
    const { data: node, error } = await supabase
      .from('bastet_nodes')
      .update(updateData)
      .eq('id', nodeId)
      .eq('user_id', userId)
      .select()
      .single()
    
    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'Node not found' })
      }
      console.error('Error updating node:', error)
      return res.status(500).json({ error: 'Failed to update node' })
    }
    
    res.json({ node })
  } catch (error) {
    console.error('Error in updateNode:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}

async function deleteNode(req: NextApiRequest, res: NextApiResponse, userId: string, nodeId: string) {
  try {
    const { error } = await supabase
      .from('bastet_nodes')
      .delete()
      .eq('id', nodeId)
      .eq('user_id', userId)
    
    if (error) {
      console.error('Error deleting node:', error)
      return res.status(500).json({ error: 'Failed to delete node' })
    }
    
    res.json({ success: true, message: 'Node deleted successfully' })
  } catch (error) {
    console.error('Error in deleteNode:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}
