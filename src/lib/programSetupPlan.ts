/** Review-only planning. This module never fetches, installs, downloads, or executes. */
export type ProgramSetupTargetKind = 'android' | 'ios' | 'web' | 'other'

/** Optional unknown fields also accept the UI's untrusted JSON record shape. */
export interface ProgramSetupScopeAsset {
  id?: unknown
  asset_identifier?: unknown
  asset_type?: unknown
  eligible_for_submission?: unknown
  archived_at?: unknown
  instruction?: unknown
}

export interface ProgramSetupScopeSnapshot {
  sha256: string
  assets: readonly ProgramSetupScopeAsset[]
  exclusions?: readonly unknown[]
  policy?: string
}

export interface ProgramSetupAsset { id: string; identifier: string; evidence: string }
export interface ProgramSetupTool { id: string; name: string; purpose: string; docs_url: string }
export interface ProgramSetupTargetGroup {
  kind: ProgramSetupTargetKind
  assets: ProgramSetupAsset[]
  tools: ProgramSetupTool[]
  prerequisites: string[]
  review_requirements: string[]
}
export interface ProgramSetupPlan {
  schema_version: 1
  scope_sha256: string
  status: 'needs_review'
  target_groups: ProgramSetupTargetGroup[]
  prerequisites: string[]
  review_requirements: string[]
  execution_enabled: false
}

const order: ProgramSetupTargetKind[] = ['android', 'ios', 'web', 'other']
const androidTypes = new Set(['GOOGLE_PLAY_APP_ID', 'OTHER_APK'])
const iosTypes = new Set(['APPLE_STORE_APP_ID', 'TESTFLIGHT', 'OTHER_IPA'])
const webTypes = new Set(['URL', 'DOMAIN', 'WILDCARD', 'API'])
const genericTypes = new Set(['', 'OTHER'])
const domain = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/i
const androidPackage = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/i

const proxy: ProgramSetupTool = {
  id: 'burp-proxy', name: 'Burp Suite intercepting proxy',
  purpose: 'Proposed manual inspection of authorized test traffic; no crawling, scanning, or request replay is enabled.',
  docs_url: 'https://portswigger.net/burp/documentation/desktop/tools/proxy',
}

// Official documentation checked 2026-10-06. Requirements remain review gates,
// not pinned versions or claims that a given workstation/device is compatible.
const templates: Record<ProgramSetupTargetKind, Omit<ProgramSetupTargetGroup, 'kind' | 'assets'>> = {
  android: {
    tools: [
      { id: 'android-sdk-adb', name: 'Android SDK Platform-Tools / ADB', purpose: 'Proposed communication with an explicitly approved test device or emulator.', docs_url: 'https://developer.android.com/tools/adb' },
      { id: 'android-test-runtime', name: 'Owned Android device or Android Emulator', purpose: 'Proposed isolated runtime for a lawfully obtained, in-scope app.', docs_url: 'https://developer.android.com/studio/run/managing-avds' },
      { id: 'jadx', name: 'JADX', purpose: 'Proposed static inspection of permitted Android bytecode; decompiled output may be incomplete.', docs_url: 'https://github.com/skylot/jadx' },
      { id: 'apktool', name: 'Apktool', purpose: 'Proposed inspection of permitted app resources and manifests; rebuilding or modifying apps needs separate review.', docs_url: 'https://apktool.org/docs/install/' },
      { id: 'frida', name: 'Frida', purpose: 'Proposed dynamic instrumentation only if the program and device owner explicitly permit it.', docs_url: 'https://frida.re/docs/android/' },
      proxy,
    ],
    prerequisites: [
      'Use an owned or explicitly authorized device/emulator, approved test accounts, and a lawfully obtained app from its official or program-provided source. Review app, tool, and SDK license terms before acquisition or analysis.',
      'Verify app version, minimum Android API level, required services, device/emulator ABI, host architecture, and virtualization support. Do not assume an emulator can run the supplied app.',
      'Check selected tool releases and Java runtime compatibility. JADX documents a 64-bit Java 11+ runtime; Apktool documents Java 8+. Recheck requirements before installing either.',
      'Review matching Frida client/server releases, Android version, ABI, and the supported device access model. Root access is not assumed; Google Play emulator images do not provide elevated root access.',
      'Device debugging, root/device modifications, certificate installation, proxy trust, and instrumentation each need explicit approval. Stop if the app rejects interception or instrumentation; this plan provides no bypass steps.',
    ],
    review_requirements: [
      'Confirm exact package, publisher, version, and permitted acquisition route. An app listing does not authorize downloading from third-party mirrors or modifying its binary.',
      'Confirm mobile testing and reverse engineering are permitted by the full rules. An in-scope app does not make every backend, embedded SDK, or third-party service in scope.',
      'Review proxy/device compatibility using https://portswigger.net/burp/documentation/desktop/mobile/config-android-device and emulator acceleration requirements at https://developer.android.com/studio/run/emulator-acceleration.',
    ],
  },
  ios: {
    tools: [
      { id: 'xcode-test-runtime', name: 'Xcode and an owned iOS test device or compatible Simulator build', purpose: 'Proposed Apple-supported test environment when an authorized compatible build is available.', docs_url: 'https://developer.apple.com/xcode/system-requirements' },
      proxy,
    ],
    prerequisites: [
      'Use approved accounts and a lawfully obtained official or program-provided app. Confirm publisher, app version, licensing, and permission to inspect it.',
      'Review compatible macOS/Xcode/device OS versions and signing/provisioning requirements. Do not assume an App Store or TestFlight device build runs in Simulator.',
      'Device changes, certificate trust, instrumentation, and any privileged access require separate explicit approval; none is configured by this plan.',
    ],
    review_requirements: ['Confirm iOS testing permission, the exact app identity, and separately authorized backends. Request a suitable test build or device if runtime compatibility is unconfirmed.'],
  },
  web: {
    tools: [
      { id: 'browser-devtools', name: 'Browser developer tools', purpose: 'Proposed manual inspection of authorized browser requests and responses.', docs_url: 'https://developer.chrome.com/docs/devtools/network' },
      proxy,
    ],
    prerequisites: ['Use a dedicated browser profile and approved test accounts. Review proxy licensing, local trust configuration, and evidence storage before setup.'],
    review_requirements: [
      'Resolve exact permitted hosts, paths, ports, exclusions, testing windows, and rate limits before requests. Wildcards are not expanded by this planner.',
      'Confirm each redirect, third-party dependency, and API is independently authorized. No automated discovery, crawler, or scanner is enabled.',
    ],
  },
  other: {
    tools: [],
    prerequisites: ['Ask the program owner to clarify the asset type, identity, access method, and authorized environment before choosing tools.'],
    review_requirements: ['Manual classification is required. Unknown or conflicting identifiers must not be treated as web or mobile testing authorization.'],
  },
}

type Classification = { kind: ProgramSetupTargetKind; evidence: string }
const manual = (evidence: string): Classification => ({ kind: 'other', evidence })

function identifierKind(identifier: string): Classification | null {
  // Never interpret prose, commands, package-like domain names, or embedded URLs.
  if (/[\s\\\u0000-\u001f\u007f]/.test(identifier)) return null
  let url: URL
  try { url = new URL(identifier) } catch {
    if (domain.test(identifier.replace(/^\*\./, ''))) return { kind: 'web', evidence: 'Identifier is a complete DNS name or leading-wildcard DNS pattern.' }
    return null
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null
  if (['play.google.com', 'apps.apple.com', 'testflight.apple.com'].includes(url.hostname)) {
    if (url.protocol !== 'https:' || url.port) return manual('App-store identifier requires manual validation of its origin.')
    if (url.hostname === 'play.google.com' && url.pathname === '/store/apps/details' && url.searchParams.getAll('id').length === 1 && androidPackage.test(url.searchParams.get('id')!)) {
      return { kind: 'android', evidence: 'Identifier matches an HTTPS Google Play app-details URL with a package ID.' }
    }
    if (url.hostname === 'apps.apple.com' && /^\/(?:[a-z]{2}\/)?app\/(?:[^/]+\/)?id\d+\/?$/i.test(url.pathname)) {
      return { kind: 'ios', evidence: 'Identifier matches an HTTPS Apple App Store app-ID URL.' }
    }
    if (url.hostname === 'testflight.apple.com' && /^\/join\/[a-z0-9]{8}\/?$/i.test(url.pathname)) {
      return { kind: 'ios', evidence: 'Identifier matches an HTTPS TestFlight invitation URL.' }
    }
    return manual('App-store origin is recognized, but the app identifier requires manual validation.')
  }
  if (url.protocol === 'https:' && /\.(apk|ipa)$/i.test(url.pathname)) {
    return { kind: /\.apk$/i.test(url.pathname) ? 'android' : 'ios', evidence: 'Identifier is an HTTPS app-package URL; provenance and download permission remain unverified.' }
  }
  return { kind: 'web', evidence: 'Identifier is a complete HTTP(S) URL; only the exact supplied identifier is retained.' }
}

function classify(asset: ProgramSetupScopeAsset, identifier: string): Classification {
  const type = typeof asset.asset_type === 'string' ? asset.asset_type.trim().toUpperCase() : ''
  const inferred = identifierKind(identifier)
  const mobile = androidTypes.has(type) ? 'android' : iosTypes.has(type) ? 'ios' : null
  if (mobile) {
    if (inferred?.kind === 'other' || (inferred && inferred.kind !== 'web' && inferred.kind !== mobile)) return manual('Structured mobile type and identifier conflict; manual review is required.')
    return { kind: mobile, evidence: `Structured asset type is ${type}; app identity and permissions still need review.` }
  }
  if (!webTypes.has(type) && !genericTypes.has(type)) return manual('Structured asset type is not supported by this planner; manual review is required.')
  if (genericTypes.has(type) && !/^https?:\/\//i.test(identifier)) return manual('A bare identifier with a generic asset type is ambiguous; manual classification is required.')
  if (inferred) return inferred
  return manual('No supported structured mobile type or vetted web/app identifier pattern was found.')
}

/**
 * Derive proposals from a verified snapshot without treating content as commands.
 * The digest is a reference, not independently verified here. Policy, instructions,
 * and exclusions remain mandatory human review material, never tool selectors.
 */
export function buildProgramSetupPlan(snapshot: ProgramSetupScopeSnapshot): ProgramSetupPlan {
  if (!snapshot || !/^[a-f0-9]{64}$/.test(snapshot.sha256) || !Array.isArray(snapshot.assets)) throw new TypeError('A verified scope snapshot and SHA-256 reference are required.')
  const groups = new Map<ProgramSetupTargetKind, ProgramSetupAsset[]>()
  const ids = new Set<string>()
  for (const asset of snapshot.assets) {
    if (!asset || asset.eligible_for_submission !== true || (asset.archived_at !== null && asset.archived_at !== undefined && asset.archived_at !== '')) continue
    if (typeof asset.asset_identifier !== 'string' || !asset.asset_identifier.trim()) throw new TypeError('Eligible scope assets require identifiers.')
    const sourceId = typeof asset.id === 'string' && asset.id.trim() ? asset.id : null
    // Older UI snapshots may omit IDs. This is a stable display key, not a
    // fabricated provider ID, and never becomes an execution target selector.
    const id = sourceId ?? `identifier:${asset.asset_identifier}`
    if (ids.has(id)) throw new TypeError('Eligible scope assets require unique IDs and identifiers.')
    ids.add(id)
    const classification = classify(asset, asset.asset_identifier)
    const assets = groups.get(classification.kind) ?? []
    assets.push({ id, identifier: asset.asset_identifier, evidence: classification.evidence + (sourceId ? '' : ' Source asset ID is missing; this is an identifier-derived display key only.') })
    groups.set(classification.kind, assets)
  }
  const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
  return {
    schema_version: 1, scope_sha256: snapshot.sha256, status: 'needs_review', execution_enabled: false,
    target_groups: order.flatMap(kind => {
      const assets = groups.get(kind)
      if (!assets) return []
      const template = templates[kind]
      return [{ kind, assets: assets.sort((a, b) => compare(a.id, b.id) || compare(a.identifier, b.identifier)), tools: template.tools.map(tool => ({ ...tool })), prerequisites: [...template.prerequisites], review_requirements: [...template.review_requirements] }]
    }),
    prerequisites: [
      'All tools, installation, app acquisition, accounts, device changes, and testing are proposals only. None has been performed or authorized by this plan.',
      'Confirm ownership or explicit permission, lawful app/source access and licensing, approved test accounts, and a private evidence-storage location before setup.',
      'Check current official tool documentation, supported versions, runtime/ABI requirements, and any costs before separately approving installation.',
    ],
    review_requirements: [
      'Review the complete current program policy, asset instructions, exclusions, private rules, and announcements. Tool inference deliberately does not interpret or override them.',
      'Submission eligibility is not a blanket testing permission or a promise of bounty eligibility. Confirm exact targets and permitted techniques with the program.',
      'This plan references one saved scope digest. Revalidate changes, restrictions, and authorization before any setup or testing; a digest does not prove current permission.',
      'Resolve unknown assets and conflicts manually. Execution remains disabled; this plan is not an executable allowlist or a runner configuration.',
    ],
  }
}
