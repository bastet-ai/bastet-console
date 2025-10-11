import { NextApiRequest, NextApiResponse } from 'next'
import https from 'https'

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
    const { programHandle } = req.body

    if (!programHandle) {
      return res.status(400).json({ 
        success: false, 
        error: 'Program handle is required' 
      })
    }

    // Fetch program data from HackerOne
    const data = await fetchHackerOneProgram(programHandle)

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

    // Format campaign data
    const campaignData = {
      name: team.name || programHandle,
      description: team.about || `Security assessment program for ${team.name || programHandle}`,
      scope: scope,
      rulesOfEngagement: team.policy || 'See program policy on HackerOne',
      metadata: {
        source: 'hackerone',
        programHandle: team.handle,
        programUrl: team.url,
        state: team.state,
        offers_bounties: team.offers_bounties,
        submission_state: team.submission_state,
        imported_at: new Date().toISOString(),
        asset_count: team.in_scope_assets?.edges?.length || 0
      }
    }

    res.status(200).json({
      success: true,
      campaign: campaignData
    })

  } catch (error) {
    console.error('HackerOne import error:', error)
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to import program'
    })
  }
}

