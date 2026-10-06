import type { NextApiRequest, NextApiResponse } from 'next'
import { database } from '../../../src/server/runtime'
import { authenticatedUser, apiFailure } from '../../../src/server/auth'
import { assertHackerOneAccess, fetchHackerOneProgram, HackerOneError, hackerOneScope, hackerOneMetadata } from '../../../src/server/hackerone'
import { hackerOneSnapshotDigest } from '../../../src/server/campaign-validation'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const userId = authenticatedUser(req, res)
  if (!userId) return
  const { campaignId, expectedSha256, previousSha256 } = req.body ?? {}
  if (typeof campaignId !== 'string' || !campaignId) return res.status(400).json({ error: 'Campaign ID is required' })
  const accepting = expectedSha256 !== undefined
  if (accepting && (typeof expectedSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(expectedSha256))) {
    return res.status(400).json({ error: 'A valid preview digest is required to accept a scope update' })
  }
  if (accepting && previousSha256 !== null && (typeof previousSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(previousSha256))) {
    return res.status(400).json({ error: 'The previous snapshot digest is required to accept a scope update' })
  }
  try {
    const db = database()
    const role = await db.campaignRole(userId, campaignId)
    if (!role || !['owner', 'manager'].includes(role)) return res.status(403).json({ error: 'Only campaign owners and managers can sync campaigns' })
    assertHackerOneAccess(userId)
    const campaign = await db.campaign(userId, campaignId)
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' })
    if (typeof campaign.hackerone_handle !== 'string' || !campaign.hackerone_handle) {
      return res.status(400).json({ error: 'This campaign is not linked to a HackerOne program' })
    }
    const team = await fetchHackerOneProgram(campaign.hackerone_handle)
    if (!team) return res.status(404).json({ error: 'Program not found or not accessible to the configured HackerOne account' })
    const metadata = hackerOneMetadata(team)
    const previousDigest = hackerOneSnapshotDigest(campaign.hackerone_metadata)
    const changed = metadata.scope_snapshot.sha256 !== previousDigest
    const scope = hackerOneScope(team)
    const preview = {
      scope,
      policy: metadata.scope_snapshot.policy,
      sha256: metadata.scope_snapshot.sha256,
      previous_sha256: previousDigest,
      changed,
      scope_snapshot: metadata.scope_snapshot,
    }
    if (!accepting) return res.json({ success: true, preview, campaign })
    if (expectedSha256 !== metadata.scope_snapshot.sha256 || previousSha256 !== previousDigest) {
      return res.status(409).json({ error: 'The HackerOne policy or saved snapshot changed. Preview and review the latest scope before accepting.' })
    }
    const timestamp = new Date().toISOString()
    const updatedCampaign = await db.updateCampaign(userId, campaignId, {
      name: team.name || String(campaign.name),
      description: team.about || (campaign.description as string | null),
      scope,
      privacy: 'private',
      ...(changed ? { status: 'paused' } : {}),
      hackerone_last_synced: metadata.scope_snapshot.fetched_at,
      hackerone_metadata: { ...metadata, previous_sha256: previousDigest, synced_at: timestamp, accepted_at: timestamp, accepted_by: userId }
    }, previousDigest)
    if (!updatedCampaign) return res.status(409).json({ error: 'The saved campaign changed or access was revoked. Preview the scope again before accepting.' })
    return res.json({ success: true, campaign: updatedCampaign, message: changed
      ? 'Updated scope saved. The campaign is paused; no testing was started or authorized.'
      : 'The unchanged scope snapshot was refreshed; no testing was started or authorized.' })
  } catch (error) {
    if (error instanceof HackerOneError) return res.status(error.status).json({ error: error.message })
    return apiFailure(res, 'campaign_sync')
  }
}
