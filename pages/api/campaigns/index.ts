import type { NextApiRequest, NextApiResponse } from 'next'
import type { CampaignInput } from '../../../src/server/database'
import { database } from '../../../src/server/runtime'
import { authenticatedUser, apiFailure } from '../../../src/server/auth'
import { campaignInput, hackerOneSnapshotDigest } from '../../../src/server/campaign-validation'
import { assertHackerOneAccess, fetchHackerOneProgram, HackerOneError, hackerOneMetadata, hackerOneScope, normalizeHackerOneHandle } from '../../../src/server/hackerone'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!['GET', 'POST'].includes(req.method ?? '')) return res.status(405).json({ error: 'Method not allowed' })
  res.setHeader('Cache-Control', 'no-store')
  const userId = authenticatedUser(req, res)
  if (!userId) return
  try {
    const db = database()
    if (req.method === 'GET') return res.json({ success: true, campaigns: await db.campaigns(userId) })
    let input = req.body
    let importedMetadata: ReturnType<typeof hackerOneMetadata> | undefined
    if (req.body?.hackerone_handle !== undefined) {
      assertHackerOneAccess(userId)
      const handle = normalizeHackerOneHandle(req.body.hackerone_handle)
      const expectedDigest = hackerOneSnapshotDigest(req.body.hackerone_metadata)
      if (!expectedDigest) return res.status(400).json({ error: 'Preview the HackerOne program before creating this campaign' })
      const team = await fetchHackerOneProgram(handle)
      if (!team) return res.status(404).json({ error: 'Program not found or not accessible to the configured HackerOne account' })
      const metadata = hackerOneMetadata(team)
      if (metadata.scope_snapshot.sha256 !== expectedDigest) return res.status(409).json({ error: 'The HackerOne scope or policy changed. Import it again and review the latest snapshot.' })
      // Re-fetch the authoritative snapshot. Never persist client-supplied policy or verification metadata.
      importedMetadata = metadata
      input = {
        name: team.name || team.handle,
        description: team.about || `Security assessment program for ${team.name || team.handle}`,
        scope: hackerOneScope(team),
        privacy: 'private',
        status: 'paused',
        hackerone_handle: team.handle,
      }
    }
    const { value, error } = campaignInput(input)
    if (error || !value) return res.status(400).json({ error })
    if (importedMetadata) {
      value.hackerone_last_synced = importedMetadata.scope_snapshot.fetched_at
      value.hackerone_metadata = { ...importedMetadata, imported_at: new Date().toISOString() }
    }
    const campaign = await db.createCampaign(userId, value as CampaignInput)
    return res.status(201).json({ success: true, campaign: { ...campaign, campaign_members: [{ role: 'owner' }] } })
  } catch (error) {
    if (error instanceof HackerOneError) return res.status(error.status).json({ error: error.message })
    return apiFailure(res, 'campaigns')
  }
}
