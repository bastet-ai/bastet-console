import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { snapshotDatabase } from '../src/server/backup'
import { once } from 'node:events'
import { createServer, request as httpRequest } from 'node:http'
import jwt from 'jsonwebtoken'
import { SQLiteDatabase } from '../src/server/sqlite'
import { ConsoleDatabase } from '../src/server/database'
import { createApiServer } from '../src/server/api-server'
import { proxyApi } from '../src/server/proxy'
import { debugMiddleware } from '../scripts/local-debug'

const serviceKey = 'service-test-only-'.repeat(4)
const debugKey = 'debug-test-only-'.repeat(4)

test('online SQLite backup restores WAL data, passes integrity checks and is private', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'console-backup-test-'))
  const storage = new SQLiteDatabase(join(directory, 'live.sqlite'))
  try {
    storage.connection.exec(readFileSync('migrations/0001_console.sql', 'utf8'))
    storage.connection.exec(readFileSync('tests/fixtures/users.sql', 'utf8'))
    const database = new ConsoleDatabase(storage)
    const campaign = await database.createCampaign('http-owner', { name: 'Backup fixture', scope: 'example.test' })
    const path = await snapshotDatabase(storage.connection, join(directory, 'backups'))
    assert.equal(statSync(path).mode & 0o777, 0o600)
    const restored = new DatabaseSync(path, { readOnly: true })
    try {
      assert.equal(restored.prepare('PRAGMA journal_mode').get()?.journal_mode, 'delete')
      assert.equal(restored.prepare('SELECT name FROM campaigns WHERE id=?').get(campaign!.id)?.name, 'Backup fixture')
    }
    finally { restored.close() }
  } finally { storage.close(); rmSync(directory, { recursive: true, force: true }) }
})

test('Majin HTTP adapter preserves authorization and debug access requires both server secrets', async () => {
  process.env.JWT_SECRET = 'test-jwt-only'
  const storage = new SQLiteDatabase(':memory:')
  storage.connection.exec(readFileSync('migrations/0001_console.sql', 'utf8'))
  storage.connection.exec(readFileSync('tests/fixtures/users.sql', 'utf8'))
  const server = createApiServer({ database: new ConsoleDatabase(storage), serviceKey, debugKey, debugUserId: 'http-owner' })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const request = (path: string, headers = {}, method = 'GET', body?: object) => fetch(origin + path, {
    method, headers: { 'content-type': 'application/json', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}),
  })
  try {
    assert.equal((await request('/api/auth/verify')).status, 401)
    assert.equal((await request('/api/auth/verify', { 'x-console-debug-key': debugKey })).status, 401)
    assert.equal((await request('/api/auth/verify', { 'x-console-service-key': serviceKey, 'x-console-debug-key': 'wrong' })).status, 401)
    const normal = { 'x-console-service-key': serviceKey, authorization: `Bearer ${jwt.sign({ userId: 'http-owner' }, process.env.JWT_SECRET)}` }
    const debug = { 'x-console-service-key': serviceKey, 'x-console-debug-key': debugKey }
    assert.equal((await request('/api/auth/verify', { 'x-console-service-key': serviceKey })).status, 401)
    assert.equal((await request('/api/auth/verify', normal)).status, 200)
    assert.equal((await request('/api/auth/debug', debug, 'POST')).status, 404)
    const session = await (await request('/api/auth/verify', debug)).json() as any
    assert.equal(session.user.id, 'http-owner')
    assert.equal(session.user.access_token, undefined)
    // No context/identity can leak from a debug request into the next request.
    assert.equal((await request('/api/auth/verify', { 'x-console-service-key': serviceKey })).status, 401)
    const created = await (await request('/api/campaigns', debug, 'POST', { name: 'Shared test', scope: 'example.test' })).json() as any
    const id = created.campaign.id
    assert.equal((await request(`/api/campaigns/${id}`, normal)).status, 200)
    const outsider = { ...normal, authorization: `Bearer ${jwt.sign({ userId: 'http-other' }, process.env.JWT_SECRET)}` }
    assert.equal((await request(`/api/campaigns/${id}`, outsider)).status, 403)
    // The public proxy strips injected service/debug credentials.
    const publicRequest = new Request('https://console.test/api/auth/verify', { headers: { 'x-console-debug-key': debugKey, 'x-console-service-key': 'attacker' } })
    assert.equal((await proxyApi(publicRequest, origin, serviceKey)).status, 401)
    assert.equal((await proxyApi(new Request('https://console.test/api/auth/verify'), origin, serviceKey, debugKey)).status, 200)
    assert.equal((await request(`/api/campaigns/${id}`, debug, 'DELETE')).status, 200)
    assert.equal((await request('/api/campaigns', debug, 'POST', { name: 'x'.repeat(270000) })).status, 413)
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); storage.close() }
})

test('local login rejects DNS rebinding, cross-origin requests, missing CSRF header, and production tokens', async () => {
  const originalFetch = globalThis.fetch
  let debugRequests = 0
  let unavailable = false
  globalThis.fetch = (async (url: any, options: any) => {
    if (String(url).startsWith('https://backend.test/')) {
      debugRequests++
      if (unavailable) return new Response('Origin unavailable', { status: 502 })
      assert.equal(new Headers(options.headers).get('x-console-debug-key'), debugKey)
      return Response.json({ valid: true, user: { id: 'owner' } })
    }
    return originalFetch(url, options)
  }) as typeof fetch
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = (server.address() as { port: number }).port
  const middleware = debugMiddleware({ CONSOLE_API_ORIGIN: 'https://backend.test', CONSOLE_SERVICE_KEY: serviceKey, CONSOLE_DEBUG_KEY: debugKey }, port)
  server.on('request', (req, res) => { void middleware(req, res, () => res.end('page')) })
  const origin = `http://127.0.0.1:${port}`
  const login = (headers = {}) => originalFetch(origin + '/api/auth/debug', { method: 'POST', headers })
  try {
    assert.equal((await login()).status, 403)
    assert.equal((await login({ 'x-console-local-login': '1', origin: 'https://evil.test' })).status, 403)
    assert.equal((await login({ 'x-console-local-login': '1', 'sec-fetch-site': 'cross-site' })).status, 403)
    const rebindingStatus = await new Promise(resolve => {
      const request = httpRequest(origin + '/api/auth/debug', { method: 'POST', headers: { 'x-console-local-login': '1', host: 'evil.test' } }, response => { response.resume(); resolve(response.statusCode) })
      request.end()
    })
    assert.equal(rebindingStatus, 403)
    assert.equal(debugRequests, 0)
    const response = await login({ 'x-console-local-login': '1', origin })
    const data = await response.json() as any
    assert.match(data.token, /^local-debug\./)
    assert.equal(data.token.includes(serviceKey), false)
    assert.equal((await originalFetch(origin + '/api/campaigns', { headers: { authorization: 'Bearer a-production-jwt' } })).status, 401)
    assert.equal((await originalFetch(origin + '/api/auth/verify', { headers: { authorization: `Bearer ${data.token}` } })).status, 200)
    await originalFetch(origin + '/api/auth/logout', { method: 'POST', headers: { authorization: `Bearer ${data.token}` } })
    assert.equal((await originalFetch(origin + '/api/auth/verify', { headers: { authorization: `Bearer ${data.token}` } })).status, 401)
    unavailable = true
    assert.equal((await login({ 'x-console-local-login': '1', origin })).status, 502)
    unavailable = false
    assert.equal((await login({ 'x-console-local-login': '1', origin })).status, 200)
  } finally { globalThis.fetch = originalFetch; server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
})
