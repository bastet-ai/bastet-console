import type { NextApiRequest, NextApiResponse } from 'next'
import jwt from 'jsonwebtoken'
import { database } from '../../../src/server/runtime'
import { apiFailure } from '../../../src/server/auth'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  res.setHeader('Cache-Control', 'no-store')
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !process.env.JWT_SECRET || !process.env.NEXTAUTH_URL) {
    return res.status(500).json({ error: 'Server configuration error' })
  }
  const { code } = req.body ?? {}
  if (typeof code !== 'string' || !code || code.length > 8192) {
    return res.status(400).json({ error: 'Authorization code is required' })
  }
  try {
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: process.env.NEXTAUTH_URL
      }),
      signal: AbortSignal.timeout(15000)
    })
    const tokenData = await tokenResponse.json() as { access_token?: string }
    if (!tokenResponse.ok || !tokenData.access_token) {
      return res.status(400).json({ error: 'Failed to exchange code for tokens' })
    }
    const profileResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
      signal: AbortSignal.timeout(15000)
    })
    const profile = await profileResponse.json() as { id?: string; email?: string; name?: string; picture?: string; verified_email?: boolean }
    if (!profileResponse.ok || !profile.id || !profile.email || profile.verified_email !== true) {
      return res.status(400).json({ error: 'Failed to verify Google user information' })
    }
    const user = await database().signInGoogle({
      googleId: profile.id,
      email: profile.email,
      name: profile.name || profile.email,
      avatar: profile.picture || null
    })
    if (!user) return apiFailure(res, 'google_user_upsert')
    const token = jwt.sign({ userId: user.id, email: user.email, googleId: user.google_id }, process.env.JWT_SECRET,
      { algorithm: 'HS256', expiresIn: '7d' })
    return res.json({ success: true, user, token })
  } catch {
    return apiFailure(res, 'google_sign_in')
  }
}
