import { createHash } from 'node:crypto'
import { buildProgramSetupPlan } from '../lib/programSetupPlan'

const API = 'https://api.hackerone.com'
const MAX_BYTES = 4 * 1024 * 1024
const MAX_PAGES = 100

export class HackerOneError extends Error {
  constructor(public status: number, message: string, readonly upstreamStatus?: number) { super(message); this.name = 'HackerOneError' }
}

export interface ScopeAsset {
  id: string
  asset_identifier: string
  asset_type: string
  instruction: string
  eligible_for_submission: boolean
  eligible_for_bounty: boolean
  max_severity: string | null
  created_at: string | null
  updated_at: string | null
  archived_at: string | null
}
export interface ScopeExclusion {
  id: string
  category: string
  details: string
  created_at: string | null
  updated_at: string | null
}
export interface Team {
  id: string
  handle: string
  name: string
  url: string
  state: string
  offers_bounties: boolean
  submission_state: string
  about: string
  policy: string
  assets: ScopeAsset[]
  exclusions: ScopeExclusion[]
  fetched_at: string
  sha256: string
}
export interface HackerOneProgramCandidate {
  handle: string
  name: string
  url: string
}
export type HackerOneProgramLookup = { programHandle: string; candidates?: never } | { candidates: HackerOneProgramCandidate[]; programHandle?: never }

export function normalizeHackerOneHandle(input: unknown): string {
  let handle = typeof input === 'string' ? input.trim() : ''
  if (handle.startsWith('https://')) {
    let url: URL
    try { url = new URL(handle) } catch { throw new HackerOneError(400, 'Enter a HackerOne handle or program URL.') }
    if (handle.split(/[?#]/)[0].includes('%') || handle.includes('\\') || url.origin !== 'https://hackerone.com' || url.username || url.password ||
      !/^\/[a-zA-Z0-9_-]+\/?(?:policy_scopes|invite_only|updates)?\/?$/.test(url.pathname)) {
      throw new HackerOneError(400, 'Use a program URL on https://hackerone.com.')
    }
    handle = url.pathname.split('/')[1]
  }
  if (!/^[a-zA-Z0-9_-]{1,255}$/.test(handle)) throw new HackerOneError(400, 'Enter a valid HackerOne program handle.')
  return handle.toLowerCase()
}

export function hackerOneStatus(userId: string) {
  const configured = Boolean(process.env.HACKERONE_API_USERNAME?.trim() && process.env.HACKERONE_API_TOKEN?.trim() && process.env.HACKERONE_API_OWNER_ID?.trim())
  return { configured, authorized: configured && userId === process.env.HACKERONE_API_OWNER_ID }
}

export function assertHackerOneAccess(userId: string): void {
  const { configured, authorized } = hackerOneStatus(userId)
  if (!configured) throw new HackerOneError(503, 'HackerOne is not configured. Provision the server-only API username, token and console owner ID on the local console backend.')
  if (!authorized) throw new HackerOneError(403, 'Only the configured HackerOne integration owner can import or refresh private programs.')
}

type JsonObject = Record<string, unknown>
function object(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HackerOneError(502, 'HackerOne returned an incomplete response. No scope was saved.')
  return value as JsonObject
}
function text(value: unknown, required = false): string {
  if (typeof value === 'string' && (!required || value.trim())) return value
  if (!required && (value === undefined || value === null)) return ''
  throw new HackerOneError(502, 'HackerOne returned an invalid field. No scope was saved.')
}
function nullable(value: unknown) { return value === null || value === undefined ? null : text(value) }
function flag(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new HackerOneError(502, 'HackerOne omitted scope eligibility. No scope was saved.')
  return value
}
function resource(value: unknown, type: string): { id: string; attributes: JsonObject } {
  const row = object(value)
  if (row.type !== type || !['string', 'number'].includes(typeof row.id) || String(row.id).length === 0) throw new HackerOneError(502, 'HackerOne returned an invalid resource. No scope was saved.')
  return { id: String(row.id), attributes: object(row.attributes) }
}
// The documented single-resource envelope and the live bare-resource response
// are both supported. A present but malformed `data` must never fall back.
function singleProgram(document: JsonObject): unknown {
  return Object.prototype.hasOwnProperty.call(document, 'data') ? document.data : document
}
function programCandidate(value: unknown): { id: string; candidate: HackerOneProgramCandidate } {
  const { id, attributes } = resource(value, 'program')
  const handle = text(attributes.handle, true)
  const name = text(attributes.name, true)
  if (!/^[a-zA-Z0-9_-]{1,255}$/.test(handle) || name.length > 512 || /[\p{Cc}\p{Cf}]/u.test(name)) {
    throw new HackerOneError(502, 'HackerOne returned an invalid program identity. No program was selected.')
  }
  const normalizedHandle = handle.toLowerCase()
  return { id, candidate: { handle: normalizedHandle, name, url: `https://hackerone.com/${normalizedHandle}` } }
}
function apiAuthorization(): string {
  const username = process.env.HACKERONE_API_USERNAME?.trim()
  const token = process.env.HACKERONE_API_TOKEN?.trim()
  if (!username || !token || username.includes(':')) throw new HackerOneError(503, 'HackerOne API credentials are not configured correctly on the local console backend.')
  return `Basic ${Buffer.from(`${username}:${token}`).toString('base64')}`
}

// Only documented read endpoints. Never forward credentials through redirects
// or follow URLs embedded in program policy or scope instructions.
async function apiJson(url: URL, authorization: string, signal: AbortSignal, budget: { bytes: number }) {
  let response: Response
  try {
    response = await fetch(url, { method: 'GET', headers: { Authorization: authorization, Accept: 'application/json', 'User-Agent': 'Bastet-Console/2.0' }, redirect: 'manual', cache: 'no-store', signal })
  } catch { throw new HackerOneError(502, 'HackerOne could not be reached. No scope was saved; try again later.') }
  if (!response.ok) {
    await response.body?.cancel()
    if (response.status === 401) throw new HackerOneError(502, 'HackerOne rejected the configured API credential. Ask the integration owner to verify it.')
    if (response.status === 403 || response.status === 404) throw new HackerOneError(404, 'Program or scope is unavailable to the configured HackerOne account. Confirm the private invitation is accepted.', response.status)
    if (response.status === 429) throw new HackerOneError(429, 'HackerOne rate limit reached. No scope was saved; try again later.')
    throw new HackerOneError(502, 'HackerOne returned an unexpected response. No scope was saved.')
  }
  if (!response.body) throw new HackerOneError(502, 'HackerOne returned an empty response.')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      budget.bytes += value.byteLength
      if (budget.bytes > MAX_BYTES) throw new HackerOneError(502, 'HackerOne snapshot exceeds the import size limit. No partial scope was saved.')
      chunks.push(value)
    }
    const document = object(JSON.parse(Buffer.concat(chunks).toString('utf8')))
    if (document.errors) throw new HackerOneError(502, 'HackerOne returned API errors. No partial scope was saved.')
    return document
  } catch (error) {
    await reader.cancel().catch(() => {})
    if (error instanceof HackerOneError) throw error
    throw new HackerOneError(502, 'HackerOne returned an unreadable response. No partial scope was saved.')
  } finally { reader.releaseLock() }
}

async function collection(path: string, authorization: string, signal: AbortSignal, budget: { bytes: number }) {
  let next: URL | null = new URL(`${path}?page[size]=100`, API)
  const visited = new Set<string>()
  const result: unknown[] = []
  while (next) {
    if (visited.has(next.href) || visited.size >= MAX_PAGES) throw new HackerOneError(502, 'HackerOne pagination is incomplete or exceeds the import limit. No partial scope was saved.')
    visited.add(next.href)
    const document = await apiJson(next, authorization, signal, budget)
    if (!Array.isArray(document.data)) throw new HackerOneError(502, 'HackerOne omitted its scope list. No partial scope was saved.')
    result.push(...document.data)
    const link = document.links === undefined ? undefined : object(document.links).next
    if (link === undefined || link === null) { next = null; continue }
    if (typeof link !== 'string') throw new HackerOneError(502, 'HackerOne returned invalid pagination.')
    let candidate: URL
    try { candidate = new URL(link, API) } catch { throw new HackerOneError(502, 'HackerOne returned invalid pagination.') }
    if (candidate.origin !== API || candidate.pathname !== path || candidate.username || candidate.password || candidate.hash ||
      [...candidate.searchParams.keys()].some(key => !['page[number]', 'page[size]'].includes(key))) {
      throw new HackerOneError(502, 'HackerOne returned unsafe pagination. No partial scope was saved.')
    }
    next = candidate
  }
  return result
}

// A handle-shaped query can suggest an exact handle without reading the whole
// catalog, but always requires a user's choice: display names may still collide.
// Full-name lookup matches only after the complete bounded list is fetched.
// https://api.hackerone.com/hacker-resources/#get-programs
export async function resolveHackerOneProgram(input: unknown, signal = AbortSignal.timeout(20000)): Promise<HackerOneProgramLookup> {
  if (typeof input !== 'string' || input.length > 2048 || /[\p{Cc}\p{Cf}]/u.test(input)) {
    throw new HackerOneError(400, 'Enter a program name, handle or HTTPS HackerOne program URL.')
  }
  const query = input.trim().normalize('NFC')
  if (query.startsWith('https://')) return { programHandle: normalizeHackerOneHandle(query) }
  if (!query || query.length > 255 || !/[\p{L}\p{N}]/u.test(query) ||
    /[<>\\/]/u.test(query) || /^[a-z][a-z0-9+.-]*:/i.test(query)) {
    throw new HackerOneError(400, 'Enter a program name, handle or HTTPS HackerOne program URL.')
  }
  const authorization = apiAuthorization()
  const budget = { bytes: 0 }
  if (/^[a-zA-Z0-9_-]{1,255}$/.test(query)) {
    const handle = query.toLowerCase()
    try {
      const document = await apiJson(new URL(`/v1/hackers/programs/${handle}`, API), authorization, signal, budget)
      const { candidate } = programCandidate(singleProgram(document))
      if (candidate.handle !== handle) throw new HackerOneError(502, 'HackerOne returned a different program. No program was selected.')
      return { candidates: [candidate] }
    } catch (error) {
      // Only a genuine upstream 404 permits a name search. In particular, a
      // forbidden request is not retried merely because its public status is 404.
      if (!(error instanceof HackerOneError) || error.upstreamStatus !== 404) throw error
    }
  }
  const records = await collection('/v1/hackers/programs', authorization, signal, budget)
  const ids = new Set<string>()
  const handles = new Set<string>()
  const programs = records.map(value => {
    const { id, candidate } = programCandidate(value)
    if (ids.has(id) || handles.has(candidate.handle)) {
      throw new HackerOneError(502, 'HackerOne program results changed during pagination. Retry lookup or enter the exact program URL.')
    }
    ids.add(id)
    handles.add(candidate.handle)
    return candidate
  }).sort((a, b) => a.name.localeCompare(b.name, 'en') || a.handle.localeCompare(b.handle, 'en'))
  const needle = query.toLowerCase()
  const exact = programs.filter(program => program.handle === needle || program.name.normalize('NFC').toLowerCase() === needle)
  if (exact.length === 1) return { programHandle: exact[0].handle }
  // Even a single partial match requires an explicit choice by the user.
  return { candidates: exact.length ? exact : programs.filter(program =>
    program.handle.includes(needle) || program.name.normalize('NFC').toLowerCase().includes(needle)) }
}

export async function fetchHackerOneProgram(input: string, signal = AbortSignal.timeout(20000)): Promise<Team> {
  const handle = normalizeHackerOneHandle(input)
  const authorization = apiAuthorization()
  const path = `/v1/hackers/programs/${handle}`
  const budget = { bytes: 0 }
  const program = resource(singleProgram(await apiJson(new URL(path, API), authorization, signal, budget)), 'program')
  const attributes = program.attributes
  if (text(attributes.handle, true).toLowerCase() !== handle) throw new HackerOneError(502, 'HackerOne returned a different program. No scope was saved.')
  const policy = text(attributes.policy, true)
  const assets = (await collection(`${path}/structured_scopes`, authorization, signal, budget)).map(value => {
    const { id, attributes: item } = resource(value, 'structured-scope')
    return { id, asset_identifier: text(item.asset_identifier, true), asset_type: text(item.asset_type, true), instruction: text(item.instruction),
      eligible_for_submission: flag(item.eligible_for_submission), eligible_for_bounty: flag(item.eligible_for_bounty), max_severity: nullable(item.max_severity),
      created_at: nullable(item.created_at), updated_at: nullable(item.updated_at), archived_at: nullable(item.archived_at) }
  }).sort((a, b) => a.id.localeCompare(b.id, 'en'))
  if (new Set(assets.map(asset => asset.id)).size !== assets.length) throw new HackerOneError(502, 'HackerOne scope changed during pagination. Retry the complete import.')
  const exclusions = (await collection(`${path}/scope_exclusions`, authorization, signal, budget)).map(value => {
    const { id, attributes: item } = resource(value, 'scope-exclusion')
    return { id, category: text(item.category, true), details: text(item.details), created_at: nullable(item.created_at), updated_at: nullable(item.updated_at) }
  }).sort((a, b) => a.id.localeCompare(b.id, 'en'))
  if (new Set(exclusions.map(item => item.id)).size !== exclusions.length) throw new HackerOneError(502, 'HackerOne exclusions changed during pagination. Retry the complete import.')
  const content = { id: program.id, handle, name: text(attributes.name, true), url: `https://hackerone.com/${handle}`,
    state: text(attributes.state, true), offers_bounties: flag(attributes.offers_bounties), submission_state: text(attributes.submission_state, true),
    about: text(attributes.about), policy, assets, exclusions }
  return { ...content, fetched_at: new Date().toISOString(), sha256: createHash('sha256').update(JSON.stringify(content)).digest('hex') }
}

export function hackerOneScope(team: Team): string {
  const section = (eligible: boolean) => team.assets.filter(asset => !asset.archived_at && asset.eligible_for_submission === eligible).map(asset =>
    `${asset.asset_identifier} (${asset.asset_type})\nBounty: ${asset.eligible_for_bounty ? 'eligible' : 'ineligible'}; maximum severity: ${asset.max_severity || 'unspecified'}${asset.instruction ? `\n${asset.instruction}` : ''}`
  ).join('\n\n') || 'No entries returned.'
  return `IN SCOPE (subject to the full policy and exclusions)\n${section(true)}\n\nOUT OF SCOPE\n${section(false)}`
}

export function hackerOneMetadata(team: Team) {
  return {
    source: 'hackerone', api_version: 'v1', programHandle: team.handle, programUrl: team.url, state: team.state,
    offers_bounties: team.offers_bounties, submission_state: team.submission_state,
    asset_count: team.assets.filter(asset => asset.eligible_for_submission && !asset.archived_at).length,
    excluded_asset_count: team.assets.filter(asset => !asset.eligible_for_submission && !asset.archived_at).length,
    confidentiality: 'private',
    setup_plan: buildProgramSetupPlan(team),
    scope_snapshot: {
      schema_version: 1, sha256: team.sha256, fetched_at: team.fetched_at, policy: team.policy, assets: team.assets, exclusions: team.exclusions,
      source_urls: { program: `${API}/v1/hackers/programs/${team.handle}`, scopes: `${API}/v1/hackers/programs/${team.handle}/structured_scopes`, exclusions: `${API}/v1/hackers/programs/${team.handle}/scope_exclusions` },
      review_required: true,
      review_notes: 'API snapshot only. Check private policy, program updates, linked rules and conflicting instructions manually before testing. Import does not authorize execution.'
    }
  }
}
