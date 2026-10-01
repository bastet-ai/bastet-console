import type { NextApiRequest, NextApiResponse } from 'next'
import jwt from 'jsonwebtoken'

export function authenticatedUser(req: NextApiRequest, res: NextApiResponse): string | null {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'No authorization token provided' })
    return null
  }
  try {
    const decoded = jwt.verify(header.slice(7), process.env.JWT_SECRET!, { algorithms: ['HS256'] })
    if (typeof decoded === 'string' || typeof decoded.userId !== 'string' || !decoded.userId) throw new Error('Invalid session')
    return decoded.userId
  } catch {
    res.status(401).json({ error: 'Invalid token' })
    return null
  }
}

export function apiFailure(res: NextApiResponse, operation: string) {
  // Do not log request data, authorization codes, tokens, or database parameter values.
  console.error(JSON.stringify({ event: 'api_failure', operation }))
  return res.status(500).json({ error: 'Internal server error' })
}
