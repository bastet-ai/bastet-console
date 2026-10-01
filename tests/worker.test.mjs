import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { test } from 'node:test'
import jwt from 'jsonwebtoken'

// Run after npm run build. All CLI operations explicitly target a disposable
// local database, and the Worker receives only dummy authentication secrets.
test('built Worker serves authenticated D1 routes and enforces tenant boundaries', { timeout: 90000 }, async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'bastet-console-http-'))
  const config = resolve('dist/bastet_console/wrangler.json')
  const fixtureEnv = resolve('tests/fixtures/worker.env')
  const wrangler = resolve('node_modules/wrangler/bin/wrangler.js')
  const childEnv = { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: join(scratch, 'logs') }
  delete childEnv.CLOUDFLARE_API_TOKEN
  delete childEnv.CLOUDFLARE_API_KEY
  const cli = args => new Promise((resolveCommand, reject) => {
    const child = spawn(process.execPath, [wrangler, ...args], { env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', data => { output += data })
    child.stderr.on('data', data => { output += data })
    child.on('error', reject)
    child.on('exit', code => code === 0 ? resolveCommand() : reject(new Error(output)))
  })
  let server
  let serverOutput = ''
  try {
    for (const file of ['migrations/0001_console.sql', 'tests/fixtures/users.sql']) {
      await cli(['d1', 'execute', 'DB', '--local', '--config', config, '--persist-to', scratch, '--file', resolve(file), '--env-file', fixtureEnv])
    }
    server = spawn(process.execPath, [wrangler, 'dev', '--local', '--config', config, '--persist-to', scratch,
      '--env-file', fixtureEnv, '--ip', '127.0.0.1', '--port', '8791', '--inspector-port', '0', '--show-interactive-dev-session=false'],
    { env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] })
    server.stdout.on('data', data => { serverOutput = (serverOutput + data).slice(-64000) })
    server.stderr.on('data', data => { serverOutput = (serverOutput + data).slice(-64000) })
    const origin = 'http://127.0.0.1:8791'
    let ready = false
    for (let attempt = 0; attempt < 80; attempt++) {
      if (server.exitCode != null) throw new Error(serverOutput)
      try {
        if ((await fetch(origin, { signal: AbortSignal.timeout(1000) })).status === 200) { ready = true; break }
      } catch {}
      await delay(250)
    }
    assert.equal(ready, true, serverOutput)
    const token = userId => jwt.sign({ userId }, 'local-http-test-secret-not-for-production', { expiresIn: '5m' })
    const request = async (path, user, method = 'GET', body) => {
      const response = await fetch(origin + path, {
        method,
        headers: { ...(user ? { Authorization: `Bearer ${token(user)}` } : {}), 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      })
      const data = await response.json()
      return { status: response.status, data }
    }
    assert.equal((await request('/api/auth/verify')).status, 401)
    assert.equal((await request('/api/auth/verify', 'no-such-user')).status, 401)
    const session = await request('/api/auth/verify', 'http-owner')
    assert.equal(session.status, 200)
    assert.equal(session.data.user.id, 'http-owner')
    assert.equal('access_token' in session.data.user, false)
    assert.equal((await request('/api/auth/google', null, 'POST', {})).status, 400)
    for (const endpoint of ['/api/nodes', '/api/campaigns', '/api/campaigns/activities']) {
      assert.equal((await request(endpoint)).status, 401)
    }
    const created = await request('/api/nodes', 'http-owner', 'POST', { name: 'Fixture scanner', node_type: 'scanner' })
    assert.equal(created.status, 201)
    const nodePath = '/api/nodes/' + created.data.node.id
    assert.equal(created.data.node.websocket_connection, false)
    assert.equal((await request(nodePath, 'http-other')).status, 404)
    assert.equal((await request(nodePath, 'http-other', 'PUT', { name: 'Taken' })).status, 404)
    assert.equal((await request(nodePath, 'http-other', 'DELETE')).status, 404)
    assert.equal((await request(nodePath, 'http-owner', 'PUT', { status: 'online' })).data.node.status, 'online')
    const campaign = await request('/api/campaigns', 'http-owner', 'POST', { name: 'Fixture campaign', scope: 'example.test', privacy: 'private' })
    assert.equal(campaign.status, 201)
    assert.deepEqual(campaign.data.campaign.campaign_members, [{ role: 'owner' }])
    const id = campaign.data.campaign.id
    const campaignPath = '/api/campaigns/' + id
    assert.equal((await request(campaignPath, 'http-owner')).data.campaign.userRole, 'owner')
    assert.equal((await request(campaignPath, 'http-other')).status, 403)
    assert.equal((await request('/api/campaigns/activities?campaign_id=' + id, 'http-other')).status, 403)
    assert.deepEqual((await request('/api/campaigns/activities', 'http-other')).data.activities, [])
    assert.equal((await request('/api/campaigns/activities?limit=5000', 'http-owner')).status, 400)
    assert.equal((await request(campaignPath + '/members', 'http-owner', 'POST', { user_id: 'http-watcher', role: 'watcher' })).status, 201)
    assert.equal((await request(campaignPath, 'http-watcher')).status, 200)
    assert.equal((await request(campaignPath, 'http-watcher', 'PUT', { name: 'Disallowed' })).status, 403)
    assert.equal((await request(campaignPath, 'http-watcher', 'DELETE')).status, 403)
    assert.equal((await request('/api/campaigns/activities?campaign_id=' + id, 'http-owner')).data.activities.length, 3)
    assert.equal((await request(campaignPath, 'http-owner', 'DELETE')).status, 200)
    assert.equal((await request(nodePath, 'http-owner', 'DELETE')).status, 200)
    assert.deepEqual((await request('/api/nodes', 'http-owner')).data.nodes, [])
    assert.equal((await request('/api/ws/nodes')).status, 501)
    assert.equal((await fetch(origin + '/api/debug/env')).status, 404)
    assert.equal((await fetch(origin + '/api/debug/oauth-test')).status, 404)
  } finally {
    if (server && server.exitCode == null) {
      const exited = new Promise(resolveExit => server.once('exit', resolveExit))
      server.kill('SIGTERM')
      await Promise.race([exited, delay(5000)])
      if (server.exitCode == null) server.kill('SIGKILL')
    }
    await rm(scratch, { recursive: true, force: true })
  }
})
