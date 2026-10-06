import type { NextApiRequest, NextApiResponse } from 'next'
import { authenticatedUser, apiFailure } from '../../../src/server/auth'
import { assertHackerOneAccess, fetchHackerOneProgram, HackerOneError, hackerOneScope, hackerOneMetadata, hackerOneStatus, normalizeHackerOneHandle, resolveHackerOneProgram } from '../../../src/server/hackerone'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store')
  if (!['GET', 'POST'].includes(req.method ?? '')) return res.status(405).json({ error: 'Method not allowed' })
  const userId = authenticatedUser(req, res)
  if (!userId) return
  try {
    if (req.method === 'GET') return res.json({ success: true, ...hackerOneStatus(userId) })
    // The account credential belongs to one console user, not every logged-in user.
    assertHackerOneAccess(userId)
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) ||
      Object.hasOwn(req.body, 'programHandle') === Object.hasOwn(req.body, 'programQuery')) {
      return res.status(400).json({ error: 'Provide one program query or an explicitly selected program handle.' })
    }
    // Lookup and full import share one deadline below the proxy timeout. Each
    // phase retains its own bounded response-size budget, with no shared cache.
    const signal = AbortSignal.timeout(20000)
    let programHandle: string
    if (Object.hasOwn(req.body, 'programQuery')) {
      const resolved = await resolveHackerOneProgram(req.body.programQuery, signal)
      if (resolved.candidates) return res.json({ success: true, candidates: resolved.candidates })
      programHandle = resolved.programHandle
    } else {
      programHandle = normalizeHackerOneHandle(req.body.programHandle)
    }
    const team = await fetchHackerOneProgram(programHandle, signal)
    if (!team) return res.status(404).json({ error: 'Program not found or not accessible to the configured HackerOne account' })
    return res.json({
      success: true,
      campaign: {
        name: team.name || programHandle,
        description: team.about || `Security assessment program for ${team.name || programHandle}`,
        scope: hackerOneScope(team),
        privacy: 'private',
        status: 'paused',
        rulesOfEngagement: team.policy || '',
        hackerone_handle: team.handle,
        hackerone_metadata: { ...hackerOneMetadata(team), imported_at: new Date().toISOString() }
      }
    })
  } catch (error) {
    if (error instanceof HackerOneError) return res.status(error.status).json({ error: error.message })
    return apiFailure(res, 'hackerone_import')
  }
}
