import { NextApiRequest, NextApiResponse } from 'next'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  res.json({
    environment_check: {
      GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ? 'present' : 'missing',
      GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET ? 'present' : 'missing',
      JWT_SECRET: process.env.JWT_SECRET ? 'present' : 'missing',
      SUPABASE_URL: process.env.SUPABASE_URL ? 'present' : 'missing',
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ? 'present' : 'missing',
      NEXTAUTH_URL: process.env.NEXTAUTH_URL || 'http://localhost:3000',
      NEXT_PUBLIC_GOOGLE_CLIENT_ID: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ? 'present' : 'missing'
    },
    client_id_length: process.env.GOOGLE_CLIENT_ID?.length || 0,
    client_secret_length: process.env.GOOGLE_CLIENT_SECRET?.length || 0,
    public_client_id_length: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.length || 0,
    redirect_uri: `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}`,
    client_ids_match: process.env.GOOGLE_CLIENT_ID === process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
    client_id_prefix: process.env.GOOGLE_CLIENT_ID?.substring(0, 20) + '...',
    public_client_id_prefix: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.substring(0, 20) + '...'
  })
}
