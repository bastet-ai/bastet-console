import { NextApiRequest, NextApiResponse } from 'next'
import { OAuth2Client } from 'google-auth-library'
import jwt from 'jsonwebtoken'
import { createClient } from '@supabase/supabase-js'

// Initialize Google OAuth client
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID)

// Initialize Supabase client with service role key for backend operations
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { idToken } = req.body
    
    if (!idToken) {
      return res.status(400).json({ error: 'ID token is required' })
    }
    
    // Verify Google ID token
    const ticket = await googleClient.verifyIdToken({
      idToken: idToken,
      audience: process.env.GOOGLE_CLIENT_ID!
    })
    
    const payload = ticket.getPayload()
    if (!payload) {
      return res.status(400).json({ error: 'Invalid token payload' })
    }
    
    const { sub: googleId, email, name, picture } = payload
    
    // Check if user exists in database
    let { data: user, error: fetchError } = await supabase
      .from('users')
      .select('*')
      .eq('google_id', googleId)
      .single()
    
    if (fetchError && fetchError.code !== 'PGRST116') {
      console.error('Error fetching user:', fetchError)
      return res.status(500).json({ error: 'Database error' })
    }
    
    // Create user if doesn't exist
    if (!user) {
      const { data: newUser, error: createError } = await supabase
        .from('users')
        .insert([{
          google_id: googleId,
          email: email,
          name: name,
          avatar_url: picture,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }])
        .select()
        .single()
      
      if (createError) {
        console.error('Error creating user:', createError)
        return res.status(500).json({ error: 'Failed to create user' })
      }
      
      user = newUser
    } else {
      // Update last login
      await supabase
        .from('users')
        .update({ 
          last_login: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', user.id)
    }
    
    // Generate JWT token for session management
    const sessionToken = jwt.sign(
      { 
        userId: user.id, 
        email: user.email,
        googleId: user.google_id
      },
      process.env.JWT_SECRET!,
      { expiresIn: '7d' }
    )
    
    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatar_url: user.avatar_url
      },
      token: sessionToken
    })
    
  } catch (error) {
    console.error('Google OAuth error:', error)
    res.status(500).json({ error: 'Authentication failed' })
  }
}
