import React from 'react'

export interface HackerOneScopeSnapshotData {
  sha256: string
  fetched_at: string
  policy: string
  assets: Record<string, unknown>[]
  exclusions: Record<string, unknown>[]
  source_urls?: { program: string; scopes: string; exclusions: string }
}

export interface HackerOneMetadata {
  scope_snapshot?: HackerOneScopeSnapshotData
  [key: string]: unknown
}

function isObjectRow(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function ScopeAssets({ assets }: { assets: Record<string, unknown>[] }) {
  return (
    <div className="hackerone-snapshot-assets">
      {assets.map((asset, index) => (
        <article key={index} className="hackerone-snapshot-asset">
          <h4>{String(asset.asset_identifier ?? asset.identifier ?? asset.category ?? `Entry ${index + 1}`)}</h4>
          <dl>
            {Object.entries(asset).filter(([key]) => !['asset_identifier', 'identifier'].includes(key)).map(([key, value]) => (
              <div key={key}>
                <dt>{key.replaceAll('_', ' ')}</dt>
                <dd>{value === null || value === undefined ? 'Not specified' : typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}</dd>
              </div>
            ))}
          </dl>
        </article>
      ))}
    </div>
  )
}

/** Provider content is untrusted text, never HTML, embedded images, or executable links. */
export default function HackerOneScopeSnapshot({ snapshot }: { snapshot: HackerOneScopeSnapshotData }) {
  if (!isObjectRow(snapshot) || typeof snapshot.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(snapshot.sha256)
    || typeof snapshot.fetched_at !== 'string' || typeof snapshot.policy !== 'string'
    || !Array.isArray(snapshot.assets) || !snapshot.assets.every(isObjectRow)
    || !Array.isArray(snapshot.exclusions) || !snapshot.exclusions.every(isObjectRow)) {
    return <section className="hackerone-snapshot" aria-label="HackerOne policy and scope snapshot"><h3>Scope snapshot unavailable</h3><p role="alert">The saved policy or scope data is incomplete or malformed. Refresh and review a complete HackerOne snapshot before setup or testing. Do not rely on a partial scope list.</p></section>
  }
  const inScope = snapshot.assets.filter(asset => asset.eligible_for_submission === true && !asset.archived_at)
  const outOfScope = snapshot.assets.filter(asset => asset.eligible_for_submission !== true && !asset.archived_at)
  const archived = snapshot.assets.filter(asset => Boolean(asset.archived_at))
  return (
    <section className="hackerone-snapshot" aria-label="HackerOne policy and scope snapshot">
      <div className="hackerone-snapshot-provenance">
        <p><strong>Retrieved:</strong> <time dateTime={snapshot.fetched_at}>{snapshot.fetched_at}</time></p>
        <p><strong>SHA-256:</strong> <code>{snapshot.sha256}</code></p>
      </div>
      <p className="form-help">This saved API snapshot is evidence, not permission to test or a runner-enforced allowlist. Review current program rules, asset notes, exclusions, and your own authorization before any testing. API policy may not include every separate program page or update.</p>
      <details open>
        <summary>Full program policy</summary>
        <pre className="hackerone-policy-text">{snapshot.policy || 'No policy text returned. Review the program on HackerOne before testing.'}</pre>
      </details>
      <details open>
        <summary>Submission-eligible assets and full notes ({inScope.length})</summary>
        <ScopeAssets assets={inScope} />
      </details>
      <details open>
        <summary>Out-of-scope or eligibility-unconfirmed assets ({outOfScope.length})</summary>
        {outOfScope.length ? <ScopeAssets assets={outOfScope} /> : <p>No structured out-of-scope asset entries were returned. Policy exclusions still apply.</p>}
      </details>
      {archived.length > 0 && <details open>
        <summary>Archived assets, not eligible for testing ({archived.length})</summary>
        <p>These entries are retained for historical context only. An archived entry is not eligible even if its saved eligibility flag is true.</p>
        <ScopeAssets assets={archived} />
      </details>}
      <details open>
        <summary>Program exclusions and full notes ({snapshot.exclusions.length})</summary>
        {snapshot.exclusions.length ? <ScopeAssets assets={snapshot.exclusions} /> : <p>No program exclusion entries were returned. Policy exclusions still apply.</p>}
      </details>
    </section>
  )
}
