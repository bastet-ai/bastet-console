// Persistence is server-only. Every tenant query takes the authenticated user ID.
// SQL parameters hold values; dynamic column names come only from fixed lists.
export type Role = 'owner' | 'manager' | 'collaborator' | 'watcher'
import type { ProgramProgress, ProgramProgressResponse } from '../lib/programProgress'
export type SqlValue = string | number | null
export interface SqlStatement {
  bind(...values: SqlValue[]): SqlStatement
  first<T = Record<string, unknown>>(): Promise<T | null>
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>
  run(): Promise<{ meta: { changes: number } }>
}
export interface SqlDatabase {
  readonly dialect?: 'postgres'
  prepare(sql: string): SqlStatement
  batch(statements: SqlStatement[]): Promise<{ meta: { changes: number } }[]>
}
type Row = Record<string, SqlValue>

export interface PublicUser {
  id: string
  email: string
  name: string
  google_id: string
  avatar_url: string | null
  last_login: string | null
  created_at: string
  updated_at: string
}

export interface CampaignInput {
  name: string
  description?: string | null
  scope: string
  privacy?: 'private' | 'public'
  status?: string
  hackerone_handle?: string | null
  hackerone_last_synced?: string | null
  hackerone_metadata?: unknown
}

const publicUserColumns = 'id, email, name, google_id, avatar_url, last_login, created_at, updated_at'
const now = () => new Date().toISOString()
const json = (value: unknown) => value == null ? null : JSON.stringify(value)
const decodeJson = (value: SqlValue) => typeof value === 'string' ? JSON.parse(value) : null
const decodeNode = (row: Row) => ({ ...row, id: String(row.id), status: String(row.status), info: decodeJson(row.info), websocket_connection: Boolean(row.websocket_connection) })
const decodeCampaign = (row: Row) => ({
  ...row,
  id: String(row.id),
  name: String(row.name),
  description: row.description as string | null,
  hackerone_handle: row.hackerone_handle as string | null,
  hackerone_metadata: decodeJson(row.hackerone_metadata)
})
const memberUser = (row: Row) => {
  const { user_name, user_email, user_avatar, ...member } = row
  return { ...member, id: String(row.id), user_id: String(row.user_id), role: String(row.role),
    users: { id: row.user_id, name: user_name, email: user_email, avatar_url: user_avatar } }
}

export class ConsoleDatabase {
  constructor(private readonly db: SqlDatabase) {}

  private jsonObject(argumentsSql: string) {
    return `${this.db.dialect === 'postgres' ? 'jsonb_build_object' : 'json_object'}(${argumentsSql})`
  }

  async userById(userId: string): Promise<PublicUser | null> {
    return this.db.prepare(`SELECT ${publicUserColumns} FROM users WHERE id = ?`).bind(userId).first<PublicUser>()
  }

  async signInGoogle(profile: { googleId: string; email: string; name: string; avatar: string | null }) {
    const timestamp = now()
    // ON CONFLICT preserves the original UUID and any imported OAuth tokens.
    return this.db.prepare(`INSERT INTO users (id, google_id, email, name, avatar_url, last_login, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(google_id) DO UPDATE SET email = excluded.email, name = excluded.name,
        avatar_url = excluded.avatar_url, last_login = excluded.last_login, updated_at = excluded.updated_at
      RETURNING ${publicUserColumns}`)
      .bind(crypto.randomUUID(), profile.googleId, profile.email, profile.name, profile.avatar, timestamp, timestamp, timestamp)
      .first<PublicUser>()
  }

  async nodes(userId: string) {
    const result = await this.db.prepare('SELECT * FROM bastet_nodes WHERE user_id = ? ORDER BY created_at DESC').bind(userId).all<Row>()
    return result.results.map(decodeNode)
  }

  async node(userId: string, nodeId: string) {
    const row = await this.db.prepare('SELECT * FROM bastet_nodes WHERE id = ? AND user_id = ?').bind(nodeId, userId).first<Row>()
    return row ? decodeNode(row) : null
  }

  async createNode(userId: string, input: { name: string; description: string | null; node_type: string }) {
    const timestamp = now()
    const row = await this.db.prepare(`INSERT INTO bastet_nodes (id, user_id, name, description, node_type, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`)
      .bind(crypto.randomUUID(), userId, input.name, input.description, input.node_type, timestamp, timestamp).first<Row>()
    return row ? decodeNode(row) : null
  }

  async updateNode(userId: string, nodeId: string, input: { name?: string; description?: string | null; status?: string }) {
    const fields = ['name', 'description', 'status'] as const
    const changed = fields.filter(field => input[field] !== undefined)
    const row = await this.db.prepare(`UPDATE bastet_nodes SET ${changed.map(field => `${field} = ?, `).join('')}updated_at = ?
      WHERE id = ? AND user_id = ? RETURNING *`)
      .bind(...changed.map(field => input[field]!), now(), nodeId, userId).first<Row>()
    return row ? decodeNode(row) : null
  }

  async deleteNode(userId: string, nodeId: string) {
    const result = await this.db.prepare('DELETE FROM bastet_nodes WHERE id = ? AND user_id = ?').bind(nodeId, userId).run()
    return result.meta.changes > 0
  }

  async campaignRole(userId: string, campaignId: string): Promise<Role | null> {
    const row = await this.db.prepare(`SELECT CASE WHEN c.owner_id = ? THEN 'owner' ELSE m.role END AS role
      FROM campaigns c LEFT JOIN campaign_members m ON m.campaign_id = c.id AND m.user_id = ?
      WHERE c.id = ? AND (c.owner_id = ? OR m.user_id = ?)`)
      .bind(userId, userId, campaignId, userId, userId).first<{ role: Role }>()
    return row?.role ?? null
  }

  async campaigns(userId: string) {
    const rows = await this.db.prepare(`SELECT c.*, CASE WHEN c.owner_id = ? THEN 'owner' ELSE m.role END AS user_role
      FROM campaigns c LEFT JOIN campaign_members m ON m.campaign_id = c.id AND m.user_id = ?
      WHERE c.owner_id = ? OR m.user_id = ? ORDER BY c.created_at DESC`)
      .bind(userId, userId, userId, userId).all<Row>()
    return rows.results.map(({ user_role, ...campaign }) => ({ ...decodeCampaign(campaign), campaign_members: [{ role: user_role }] }))
  }

  async campaign(userId: string, campaignId: string) {
    const row = await this.db.prepare(`SELECT c.* FROM campaigns c WHERE c.id = ? AND
      (c.owner_id = ? OR EXISTS (SELECT 1 FROM campaign_members m WHERE m.campaign_id = c.id AND m.user_id = ?))`)
      .bind(campaignId, userId, userId).first<Row>()
    return row ? decodeCampaign(row) : null
  }

  async campaignProgress(userId: string, campaignId: string): Promise<ProgramProgressResponse | null> {
    // Membership is mandatory even for configured/no-run status. The definer
    // function exposes an allowlisted projection, not direct agent-table access.
    if (!await this.campaignRole(userId, campaignId)) return null
    if (this.db.dialect !== 'postgres') return { configured: false, progress: null }
    const available = await this.db.prepare(`SELECT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'bastet' AND p.proname = 'console_progress' AND p.proargtypes = '25'::oidvector
    ) AS available`).first<{ available: number }>()
    if (!available?.available) return { configured: false, progress: null }
    const row = await this.db.prepare('SELECT bastet.console_progress(?) AS progress').bind(campaignId).first<Row>()
    return { configured: true, progress: row ? decodeJson(row.progress) as ProgramProgress | null : null }
  }

  async createCampaign(userId: string, input: CampaignInput) {
    const id = crypto.randomUUID()
    const timestamp = now()
    // D1 batch is transactional: the owner membership and activity records cannot be partially created.
    await this.db.batch([
      this.db.prepare(`INSERT INTO campaigns
        (id, name, description, scope, privacy, status, owner_id, hackerone_handle, hackerone_last_synced, hackerone_metadata, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, input.name, input.description ?? null, input.scope, input.privacy ?? 'private', input.status ?? 'active', userId,
          input.hackerone_handle ?? null, input.hackerone_handle ? input.hackerone_last_synced ?? timestamp : null, json(input.hackerone_metadata), timestamp, timestamp),
      this.db.prepare('INSERT INTO campaign_members (id, campaign_id, user_id, role, joined_at) VALUES (?, ?, ?, ?, ?)')
        .bind(crypto.randomUUID(), id, userId, 'owner', timestamp),
      this.db.prepare('INSERT INTO campaign_activities (id, campaign_id, user_id, activity_type, activity_data, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(crypto.randomUUID(), id, userId, 'campaign_created', json({ campaign_name: input.name, campaign_description: input.description ?? null }), timestamp),
      this.db.prepare(`INSERT INTO campaign_activities (id, campaign_id, user_id, activity_type, activity_data, created_at)
        SELECT ?, ?, id, 'member_added', ${this.jsonObject("'member_name', name, 'member_role', 'owner'")}, ? FROM users WHERE id = ?`)
        .bind(crypto.randomUUID(), id, timestamp, userId)
    ])
    return this.campaign(userId, id)
  }

  async updateCampaign(userId: string, campaignId: string, input: Partial<CampaignInput>, expectedHackerOneDigest?: string | null) {
    const fields = ['name', 'description', 'scope', 'privacy', 'status', 'hackerone_handle', 'hackerone_last_synced', 'hackerone_metadata'] as const
    const changed = fields.filter(field => input[field] !== undefined)
    const values = changed.map(field => field === 'hackerone_metadata' ? json(input[field]) : input[field] as SqlValue)
    const digestGuard = expectedHackerOneDigest !== undefined
      ? this.db.dialect === 'postgres'
        ? " AND (hackerone_metadata #>> '{scope_snapshot,sha256}') IS NOT DISTINCT FROM ?"
        : " AND json_extract(hackerone_metadata, '$.scope_snapshot.sha256') IS ?"
      : ''
    const row = await this.db.prepare(`UPDATE campaigns SET ${changed.map(field => `${field} = ?, `).join('')}updated_at = ?
      WHERE id = ? AND (owner_id = ? OR EXISTS (SELECT 1 FROM campaign_members m
        WHERE m.campaign_id = campaigns.id AND m.user_id = ? AND m.role IN ('owner', 'manager')))${digestGuard} RETURNING *`)
      .bind(...values, now(), campaignId, userId, userId, ...(expectedHackerOneDigest !== undefined ? [expectedHackerOneDigest] : [])).first<Row>()
    return row ? decodeCampaign(row) : null
  }

  async deleteCampaign(userId: string, campaignId: string) {
    const result = await this.db.prepare(`DELETE FROM campaigns WHERE id = ? AND (owner_id = ? OR EXISTS
      (SELECT 1 FROM campaign_members m WHERE m.campaign_id = campaigns.id AND m.user_id = ? AND m.role = 'owner'))`)
      .bind(campaignId, userId, userId).run()
    return result.meta.changes > 0
  }

  async members(userId: string, campaignId: string) {
    const rows = await this.db.prepare(`SELECT m.*, u.name AS user_name, u.email AS user_email, u.avatar_url AS user_avatar
      FROM campaign_members m JOIN users u ON u.id = m.user_id JOIN campaigns c ON c.id = m.campaign_id
      WHERE c.id = ? AND (c.owner_id = ? OR EXISTS
        (SELECT 1 FROM campaign_members viewer WHERE viewer.campaign_id = c.id AND viewer.user_id = ?)) ORDER BY m.joined_at`)
      .bind(campaignId, userId, userId).all<Row>()
    return rows.results.map(memberUser)
  }

  async addMember(userId: string, campaignId: string, targetUserId: string, role: Role) {
    const id = crypto.randomUUID()
    await this.db.batch([
      this.db.prepare(`INSERT INTO campaign_members (id, campaign_id, user_id, role)
        SELECT ?, c.id, ?, ? FROM campaigns c WHERE c.id = ? AND (c.owner_id = ? OR EXISTS
          (SELECT 1 FROM campaign_members actor WHERE actor.campaign_id = c.id AND actor.user_id = ?
            AND (actor.role = 'owner' OR (actor.role = 'manager' AND ? != 'owner'))))`)
        .bind(id, targetUserId, role, campaignId, userId, userId, role),
      this.db.prepare(`INSERT INTO campaign_activities (id, campaign_id, user_id, activity_type, activity_data)
        SELECT ?, m.campaign_id, m.user_id, 'member_added', ${this.jsonObject("'member_name', u.name, 'member_role', m.role")}
        FROM campaign_members m JOIN users u ON u.id = m.user_id WHERE m.id = ?`)
        .bind(crypto.randomUUID(), id)
    ])
    return (await this.members(userId, campaignId)).find(member => member.id === id) ?? null
  }

  async updateMember(userId: string, campaignId: string, memberId: string, role: Role) {
    const result = await this.db.prepare(`UPDATE campaign_members SET role = ? WHERE id = ? AND campaign_id = ?
      AND user_id != (SELECT owner_id FROM campaigns WHERE id = ?)
      AND EXISTS (SELECT 1 FROM campaigns c WHERE c.id = campaign_members.campaign_id AND
        (c.owner_id = ? OR EXISTS (SELECT 1 FROM campaign_members actor WHERE actor.campaign_id = c.id AND actor.user_id = ?
          AND (actor.role = 'owner' OR (actor.role = 'manager' AND campaign_members.role != 'owner' AND ? != 'owner')))))`)
      .bind(role, memberId, campaignId, campaignId, userId, userId, role).run()
    if (!result.meta.changes) return null
    return (await this.members(userId, campaignId)).find(member => member.id === memberId) ?? null
  }

  async removeMember(userId: string, campaignId: string, memberId: string) {
    // The same guard is applied to the activity insert and delete inside a transaction.
    const permitted = `m.id = ? AND m.campaign_id = ? AND m.user_id != c.owner_id AND
      (c.owner_id = ? OR EXISTS (SELECT 1 FROM campaign_members actor WHERE actor.campaign_id = c.id AND actor.user_id = ?
        AND (actor.role = 'owner' OR (actor.role = 'manager' AND m.role != 'owner'))))`
    const values = [memberId, campaignId, userId, userId]
    const result = await this.db.batch([
      this.db.prepare(`INSERT INTO campaign_activities (id, campaign_id, user_id, activity_type, activity_data)
        SELECT ?, m.campaign_id, m.user_id, 'member_removed', ${this.jsonObject("'member_name', u.name, 'member_role', m.role")}
        FROM campaign_members m JOIN users u ON u.id = m.user_id JOIN campaigns c ON c.id = m.campaign_id WHERE ${permitted}`)
        .bind(crypto.randomUUID(), ...values),
      this.db.prepare(`DELETE FROM campaign_members WHERE id IN
        (SELECT m.id FROM campaign_members m JOIN campaigns c ON c.id = m.campaign_id WHERE ${permitted})`).bind(...values)
    ])
    return result[1].meta.changes > 0
  }

  async activities(userId: string, campaignId: string | null, limit: number, offset: number) {
    const result = await this.db.prepare(`SELECT a.*, c.name AS campaign_name, c.privacy AS campaign_privacy,
      u.name AS user_name, u.email AS user_email, u.avatar_url AS user_avatar
      FROM campaign_activities a JOIN campaigns c ON c.id = a.campaign_id LEFT JOIN users u ON u.id = a.user_id
      WHERE (c.owner_id = ? OR EXISTS (SELECT 1 FROM campaign_members m WHERE m.campaign_id = c.id AND m.user_id = ?))
        AND (CAST(? AS TEXT) IS NULL OR c.id = ?) ORDER BY a.created_at DESC, a.id DESC LIMIT ? OFFSET ?`)
      .bind(userId, userId, campaignId, campaignId, limit, offset).all<Row>()
    return result.results.map(row => ({ ...row, activity_data: decodeJson(row.activity_data) }))
  }
}
