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

  // Validate required environment variables
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !process.env.JWT_SECRET) {
    console.error('Missing required environment variables')
    return res.status(500).json({ error: 'Server configuration error' })
  }

  try {
    const { code } = req.body
    
    if (!code) {
      return res.status(400).json({ error: 'Authorization code is required' })
    }
    
    // Exchange authorization code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        code: code,
        grant_type: 'authorization_code',
        redirect_uri: `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}`
      })
    })

    const tokenData = await tokenResponse.json()
    
    if (!tokenResponse.ok) {
      console.error('Token exchange failed:', tokenData)
      return res.status(400).json({ error: 'Failed to exchange code for tokens', details: tokenData })
    }
    
    if (!tokenData.access_token) {
      console.error('No access token in response:', tokenData)
      return res.status(400).json({ error: 'Failed to exchange code for tokens', details: tokenData })
    }

    // Get user info from Google
    const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`
      }
    })

    const userData = await userResponse.json()
    
    if (!userResponse.ok) {
      console.error('User info fetch failed:', userData)
      return res.status(400).json({ error: 'Failed to get user information', details: userData })
    }
    
    if (!userData.id) {
      console.error('No user ID in response:', userData)
      return res.status(400).json({ error: 'Failed to get user information', details: userData })
    }
    
    const { id: googleId, email, name, picture } = userData
    
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
