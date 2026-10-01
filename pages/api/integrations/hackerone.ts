import type { NextApiRequest, NextApiResponse } from 'next'
import { apiFailure } from '../../../src/server/auth'
import { fetchHackerOneProgram, hackerOneScope, hackerOneMetadata } from '../../../src/server/hackerone'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { programHandle } = req.body ?? {}
  if (typeof programHandle !== 'string' || !/^[a-zA-Z0-9_-]{1,255}$/.test(programHandle)) return res.status(400).json({ error: 'Invalid program handle' })
  try {
    const team = await fetchHackerOneProgram(programHandle)
    if (!team) return res.status(404).json({ error: 'Program not found on HackerOne' })
    return res.json({
      success: true,
      campaign: {
        name: team.name || programHandle,
        description: team.about || `Security assessment program for ${team.name || programHandle}`,
        scope: hackerOneScope(team),
        rulesOfEngagement: team.policy || 'See program policy on HackerOne',
        hackerone_handle: team.handle,
        hackerone_metadata: { ...hackerOneMetadata(team), imported_at: new Date().toISOString() }
      }
    })
  } catch {
    return apiFailure(res, 'hackerone_import')
  }
}
