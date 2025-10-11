import { NextApiRequest, NextApiResponse } from 'next'
import jwt from 'jsonwebtoken'
import { createClient } from '@supabase/supabase-js'
import https from 'https'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * Fetch program data from HackerOne's GraphQL API
 */
function fetchHackerOneProgram(programHandle: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const query = JSON.stringify({
      operationName: 'TeamProfile',
      variables: { handle: programHandle },
      query: `
        query TeamProfile($handle: String!) {
          team(handle: $handle) {
            handle
            name
            url
            currency
            state
            offers_bounties
            submission_state
            about
            policy
            in_scope_assets: structured_scopes(
              first: 100,
              archived: false,
              eligible_for_submission: true
            ) {
              edges {
                node {
                  asset_identifier
                  asset_type
                  eligible_for_bounty
                  instruction
                  max_severity
                }
              }
            }
          }
        }
      `
    })

    const options = {
      hostname: 'hackerone.com',
      path: '/graphql',
      method: 'POST',
      headers: {
        'User-Agent': 'Bastet-Console/1.0',
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Content-Length': query.length
      }
    }

    const req = https.request(options, (res) => {
      let data = ''

      res.on('data', (chunk) => {
        data += chunk
      })

      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            resolve(JSON.parse(data))
          } catch (e) {
            reject(new Error('Invalid JSON response from HackerOne'))
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`))
        }
      })
    })

    req.on('error', (error) => {
      reject(error)
    })

    req.write(query)
    req.end()
  })
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' })
  }

  try {
    // Verify JWT token
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'No token provided' })
    }

    const token = authHeader.split(' ')[1]
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any

    if (!decoded.userId) {
      return res.status(401).json({ success: false, error: 'Invalid token' })
    }

    const { campaignId } = req.body

    if (!campaignId) {
      return res.status(400).json({ 
        success: false, 
        error: 'Campaign ID is required' 
      })
    }

    // Fetch campaign from database
    const { data: campaign, error: campaignError } = await supabase
      .from('campaigns')
      .select('*, campaign_members(*)')
      .eq('id', campaignId)
      .single()

    if (campaignError || !campaign) {
      return res.status(404).json({
        success: false,
        error: 'Campaign not found'
      })
    }

    // Check if user has permission to sync (owner or manager)
    const userMember = campaign.campaign_members.find((m: any) => m.user_id === decoded.userId)
    const isOwner = campaign.owner_id === decoded.userId
    const isManager = userMember && (userMember.role === 'manager' || userMember.role === 'owner')

    if (!isOwner && !isManager) {
      return res.status(403).json({
        success: false,
        error: 'Only campaign owners and managers can sync campaigns'
      })
    }

    // Check if campaign has HackerOne handle
    if (!campaign.hackerone_handle) {
      return res.status(400).json({
        success: false,
        error: 'This campaign is not linked to a HackerOne program'
      })
    }

    // Fetch updated data from HackerOne
    const data = await fetchHackerOneProgram(campaign.hackerone_handle)

    if (data.errors) {
      return res.status(400).json({
        success: false,
        error: 'Failed to fetch program from HackerOne',
        details: data.errors
      })
    }

    if (!data.data || !data.data.team) {
      return res.status(404).json({
        success: false,
        error: 'Program not found on HackerOne'
      })
    }

    const team = data.data.team

    // Extract scope from in-scope assets
    const scope = team.in_scope_assets?.edges
      ? team.in_scope_assets.edges
          .map((edge: any) => {
            const node = edge.node
            let scopeLine = `${node.asset_identifier} (${node.asset_type})`
            if (node.instruction) {
              scopeLine += `\n  ${node.instruction.substring(0, 100)}...`
            }
            return scopeLine
          })
          .join('\n\n')
      : 'No scope information available'

    // Update campaign with new data
    const { data: updatedCampaign, error: updateError } = await supabase
      .from('campaigns')
      .update({
        name: team.name || campaign.name, // Keep existing name if HackerOne doesn't provide one
        description: team.about || campaign.description,
        scope: scope,
        hackerone_last_synced: new Date().toISOString(),
        hackerone_metadata: {
          source: 'hackerone',
          programHandle: team.handle,
          programUrl: team.url,
          state: team.state,
          offers_bounties: team.offers_bounties,
          submission_state: team.submission_state,
          synced_at: new Date().toISOString(),
          asset_count: team.in_scope_assets?.edges?.length || 0
        }
      })
      .eq('id', campaignId)
      .select()
      .single()

    if (updateError) {
      console.error('Campaign update error:', updateError)
      return res.status(500).json({
        success: false,
        error: 'Failed to update campaign'
      })
    }

    res.status(200).json({
      success: true,
      campaign: updatedCampaign,
      message: 'Campaign synced successfully with HackerOne'
    })

  } catch (error) {
    console.error('Campaign sync error:', error)
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to sync campaign'
    })
  }
}

