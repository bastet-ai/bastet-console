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
    
    switch (req.method) {
      case 'GET':
        return await getNodes(req, res, userId)
      case 'POST':
        return await createNode(req, res, userId)
      default:
        return res.status(405).json({ error: 'Method not allowed' })
    }
  } catch (error) {
    console.error('API Error:', error)
    return res.status(401).json({ error: 'Unauthorized' })
  }
}

async function getNodes(req: NextApiRequest, res: NextApiResponse, userId: string) {
  try {
    const { data: nodes, error } = await supabase
      .from('bastet_nodes')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
    
    if (error) {
      console.error('Error fetching nodes:', error)
      return res.status(500).json({ error: 'Failed to fetch nodes' })
    }
    
    res.json({ nodes })
  } catch (error) {
    console.error('Error in getNodes:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}

async function createNode(req: NextApiRequest, res: NextApiResponse, userId: string) {
  try {
    const { name, description, node_type } = req.body
    
    if (!name || !node_type) {
      return res.status(400).json({ error: 'Name and node_type are required' })
    }
    
    const { data: node, error } = await supabase
      .from('bastet_nodes')
      .insert([{
        user_id: userId,
        name,
        description,
        node_type,
        status: 'offline',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }])
      .select()
      .single()
    
    if (error) {
      console.error('Error creating node:', error)
      return res.status(500).json({ error: 'Failed to create node' })
    }
    
    res.status(201).json({ node })
  } catch (error) {
    console.error('Error in createNode:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}
