import { NextApiRequest, NextApiResponse } from 'next'
import jwt from 'jsonwebtoken'
import { createClient } from '@supabase/supabase-js'

// Initialize Supabase client with service role key for backend operations
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const token = req.headers.authorization?.replace('Bearer ', '')
    
    if (!token) {
      return res.status(401).json({ error: 'No token provided' })
    }
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any
    
    // Fetch fresh user data
    const { data: user, error } = await supabase
      .from('users')
      .select('id, email, name, avatar_url, last_login')
      .eq('id', decoded.userId)
      .single()
    
    if (error || !user) {
      return res.status(401).json({ error: 'Invalid token' })
    }
    
    res.json({
      valid: true,
      user: user
    })
    
  } catch (error) {
    console.error('Token verification error:', error)
    res.status(401).json({ error: 'Invalid token' })
  }
}
