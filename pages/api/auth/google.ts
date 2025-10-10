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
    
    console.log('=== Google OAuth Debug ===')
    console.log('Request body:', { code: code ? 'present' : 'missing', codeLength: code?.length })
    console.log('Environment check:', {
      GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ? 'present' : 'missing',
      GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET ? 'present' : 'missing',
      JWT_SECRET: process.env.JWT_SECRET ? 'present' : 'missing',
      SUPABASE_URL: process.env.SUPABASE_URL ? 'present' : 'missing',
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ? 'present' : 'missing',
      NEXTAUTH_URL: process.env.NEXTAUTH_URL || 'http://localhost:3000'
    })
    
    if (!code) {
      console.log('ERROR: No authorization code provided')
      return res.status(400).json({ error: 'Authorization code is required' })
    }
    
    const redirectUri = `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}`
    console.log('Using redirect_uri:', redirectUri)
    
    // Exchange authorization code for tokens
    const tokenRequestParams = {
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      code: code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri
    }
    
    console.log('Token exchange request params:', {
      ...tokenRequestParams,
      client_secret: '***hidden***',
      code: code.substring(0, 10) + '...'
    })
    
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(tokenRequestParams)
    })

    console.log('Token response status:', tokenResponse.status, tokenResponse.statusText)
    console.log('Token response headers:', Object.fromEntries(tokenResponse.headers.entries()))
    
    const tokenData = await tokenResponse.json()
    console.log('Token response data:', tokenData)
    
    if (!tokenResponse.ok) {
      console.error('Token exchange failed - HTTP error:', {
        status: tokenResponse.status,
        statusText: tokenResponse.statusText,
        data: tokenData
      })
      return res.status(400).json({ 
        error: 'Failed to exchange code for tokens', 
        details: tokenData,
        status: tokenResponse.status,
        statusText: tokenResponse.statusText
      })
    }
    
    if (!tokenData.access_token) {
      console.error('No access token in response:', tokenData)
      return res.status(400).json({ 
        error: 'Failed to exchange code for tokens - no access token', 
        details: tokenData 
      })
    }
    
    console.log('Token exchange successful, access_token length:', tokenData.access_token.length)

    // Get user info from Google
    console.log('Fetching user info from Google...')
    const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`
      }
    })

    console.log('User info response status:', userResponse.status, userResponse.statusText)
    const userData = await userResponse.json()
    console.log('User info response data:', userData)
    
    if (!userResponse.ok) {
      console.error('User info fetch failed - HTTP error:', {
        status: userResponse.status,
        statusText: userResponse.statusText,
        data: userData
      })
      return res.status(400).json({ 
        error: 'Failed to get user information', 
        details: userData,
        status: userResponse.status,
        statusText: userResponse.statusText
      })
    }
    
    if (!userData.id) {
      console.error('No user ID in response:', userData)
      return res.status(400).json({ 
        error: 'Failed to get user information - no user ID', 
        details: userData 
      })
    }
    
    console.log('User info fetch successful, user ID:', userData.id)
    
    const { id: googleId, email, name, picture } = userData
    console.log('Extracted user data:', { googleId, email, name, picture: picture ? 'present' : 'missing' })
    
    // Check if user exists in database
    console.log('Checking if user exists in database...')
    let { data: user, error: fetchError } = await supabase
      .from('users')
      .select('*')
      .eq('google_id', googleId)
      .single()
    
    console.log('Database fetch result:', { user: user ? 'found' : 'not found', error: fetchError })
    
    if (fetchError && fetchError.code !== 'PGRST116') {
      console.error('Error fetching user:', fetchError)
      return res.status(500).json({ error: 'Database error', details: fetchError })
    }
    
    // Create user if doesn't exist
    if (!user) {
      console.log('Creating new user in database...')
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
      
      console.log('User creation result:', { user: newUser ? 'created' : 'failed', error: createError })
      
      if (createError) {
        console.error('Error creating user:', createError)
        return res.status(500).json({ error: 'Failed to create user', details: createError })
      }
      
      user = newUser
    } else {
      console.log('Updating existing user last login...')
      // Update last login
      const { error: updateError } = await supabase
        .from('users')
        .update({ 
          last_login: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', user.id)
      
      if (updateError) {
        console.error('Error updating user:', updateError)
      } else {
        console.log('User last login updated successfully')
      }
    }
    
    // Generate JWT token for session management
    console.log('Generating JWT token...')
    const sessionToken = jwt.sign(
      { 
        userId: user.id, 
        email: user.email,
        googleId: user.google_id
      },
      process.env.JWT_SECRET!,
      { expiresIn: '7d' }
    )
    
    console.log('JWT token generated successfully, length:', sessionToken.length)
    console.log('=== Google OAuth Success ===')
    
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
    console.error('=== Google OAuth Error ===')
    console.error('Error type:', typeof error)
    console.error('Error message:', error instanceof Error ? error.message : 'Unknown error')
    console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace')
    console.error('Full error object:', error)
    
    res.status(500).json({ 
      error: 'Authentication failed', 
      details: error instanceof Error ? error.message : 'Unknown error',
      type: typeof error
    })
  }
}
