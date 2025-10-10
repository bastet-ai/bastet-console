import { NextApiRequest, NextApiResponse } from 'next'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const redirectUri = `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}`
  
  res.json({
    message: 'OAuth Configuration Check',
    redirect_uri: redirectUri,
    redirect_uri_length: redirectUri.length,
    redirect_uri_encoded: encodeURIComponent(redirectUri),
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret_length: process.env.GOOGLE_CLIENT_SECRET?.length || 0,
    google_oauth_url: `https://accounts.google.com/o/oauth2/v2/auth?client_id=${process.env.GOOGLE_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=openid%20email%20profile&response_type=code&access_type=offline`,
    instructions: {
      step1: 'Copy the google_oauth_url and paste it in your browser',
      step2: 'Complete the OAuth flow to get a real authorization code',
      step3: 'Use that code to test the /api/auth/google endpoint',
      step4: 'Check the logs for detailed debugging information'
    }
  })
}
