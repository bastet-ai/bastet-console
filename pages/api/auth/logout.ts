import { NextApiRequest, NextApiResponse } from 'next'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // In a stateless JWT setup, logout is handled client-side
  // You could implement token blacklisting here if needed
  res.json({ success: true, message: 'Logged out successfully' })
}
