import type { NextApiRequest, NextApiResponse } from 'next'

// This route has never implemented a WebSocket upgrade. Do not advertise a
// connection or mutate node state until a persistent transport is implemented.
export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  return res.status(501).json({ error: 'Node WebSocket transport is not available' })
}
