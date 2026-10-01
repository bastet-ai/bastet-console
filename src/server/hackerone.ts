interface ScopeAsset {
  asset_identifier: string
  asset_type: string
  instruction?: string | null
}

interface Team {
  handle: string
  name?: string
  url?: string
  state?: string
  offers_bounties?: boolean
  submission_state?: string
  about?: string
  policy?: string
  in_scope_assets?: { edges: { node: ScopeAsset }[] }
}

export async function fetchHackerOneProgram(handle: string): Promise<Team | null> {
  const response = await fetch('https://hackerone.com/graphql', {
    method: 'POST',
    headers: { 'User-Agent': 'Bastet-Console/1.0', Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      operationName: 'TeamProfile',
      variables: { handle },
      query: `query TeamProfile($handle: String!) {
        team(handle: $handle) {
          handle name url state offers_bounties submission_state about policy
          in_scope_assets: structured_scopes(first: 100, archived: false, eligible_for_submission: true) {
            edges { node { asset_identifier asset_type instruction } }
          }
        }
      }`
    }),
    signal: AbortSignal.timeout(15000)
  })
  if (!response.ok) throw new Error('HackerOne request failed')
  const body = await response.json() as { data?: { team?: Team }; errors?: unknown[] }
  if (body.errors?.length) throw new Error('HackerOne query failed')
  return body.data?.team ?? null
}

export function hackerOneScope(team: Team) {
  return team.in_scope_assets?.edges.map(({ node }) => {
    const instruction = node.instruction ? `\n  ${node.instruction.substring(0, 100)}...` : ''
    return `${node.asset_identifier} (${node.asset_type})${instruction}`
  }).join('\n\n') || 'No scope information available'
}

export function hackerOneMetadata(team: Team) {
  return {
    source: 'hackerone',
    programHandle: team.handle,
    programUrl: team.url,
    state: team.state,
    offers_bounties: team.offers_bounties,
    submission_state: team.submission_state,
    asset_count: team.in_scope_assets?.edges.length ?? 0
  }
}
