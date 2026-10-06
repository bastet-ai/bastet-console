import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createHash, timingSafeEqual } from 'node:crypto'
import type { NextApiRequest, NextApiResponse } from 'next'
import { ConsoleDatabase } from './database'
import { SQLiteDatabase } from './sqlite'
import { requestContext } from './runtime'
import google from '../../pages/api/auth/google'
import verify from '../../pages/api/auth/verify'
import logout from '../../pages/api/auth/logout'
import campaigns from '../../pages/api/campaigns/index'
import campaign from '../../pages/api/campaigns/[id]'
import members from '../../pages/api/campaigns/[id]/members'
import activities from '../../pages/api/campaigns/activities'
import sync from '../../pages/api/campaigns/sync'
import nodes from '../../pages/api/nodes/index'
import node from '../../pages/api/nodes/[id]'
import hackerone from '../../pages/api/integrations/hackerone'
import websocket from '../../pages/api/ws/nodes'
import { dirname, join } from 'node:path'
import { snapshotDatabase } from './backup'

type Handler = (req: NextApiRequest, res: NextApiResponse) => unknown
const routes: [RegExp, Handler][] = [
  [/^\/api\/auth\/google$/, google], [/^\/api\/auth\/verify$/, verify], [/^\/api\/auth\/logout$/, logout],
  [/^\/api\/campaigns$/, campaigns], [/^\/api\/campaigns\/activities$/, activities], [/^\/api\/campaigns\/sync$/, sync],
  [/^\/api\/campaigns\/([^/]+)\/members$/, members], [/^\/api\/campaigns\/([^/]+)$/, campaign],
  [/^\/api\/nodes$/, nodes], [/^\/api\/nodes\/([^/]+)$/, node],
  [/^\/api\/integrations\/hackerone$/, hackerone], [/^\/api\/ws\/nodes$/, websocket],
]
const matchesSecret = (actual: unknown, expected: string) => typeof actual === 'string' &&
  timingSafeEqual(createHash('sha256').update(actual).digest(), createHash('sha256').update(expected).digest())

export function createApiServer(options: { database: ConsoleDatabase; serviceKey: string; debugKey: string; debugUserId: string }) {
  if (options.serviceKey.length < 32 || options.debugKey.length < 32 || options.serviceKey === options.debugKey) throw new Error('Invalid service credentials')
  return createServer(async (incoming: IncomingMessage, outgoing: ServerResponse) => {
    const res = outgoing as NextApiResponse
    res.status = (status: number) => { res.statusCode = status; return res }
    res.json = data => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); return res }
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    if (!matchesSecret(incoming.headers['x-console-service-key'], options.serviceKey)) return void res.status(401).json({ error: 'Unauthorized' })
    const suppliedDebug = incoming.headers['x-console-debug-key']
    if (suppliedDebug !== undefined && !matchesSecret(suppliedDebug, options.debugKey)) return void res.status(401).json({ error: 'Unauthorized' })
    try {
      const url = new URL(incoming.url!, 'http://api.internal')
      if (url.pathname === '/health' && incoming.method === 'GET') {
        await options.database.userById(options.debugUserId)
        return void res.json({ ok: true, storage: 'majin-sqlite' })
      }
      const route = routes.find(([pattern]) => pattern.test(url.pathname))
      if (!route) return void res.status(404).json({ error: 'Not found' })
      const chunks: Buffer[] = []
      let size = 0
      for await (const chunk of incoming) {
        size += chunk.length
        if (size > 262144) { res.status(413).json({ error: 'Request too large' }); incoming.resume(); return }
        chunks.push(chunk)
      }
      const req = incoming as NextApiRequest
      req.query = Object.fromEntries(url.searchParams)
      const id = route[0].exec(url.pathname)?.[1]
      if (id) req.query.id = decodeURIComponent(id)
      req.body = size ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
      await requestContext.run({ database: options.database, ...(suppliedDebug ? { debugUserId: options.debugUserId } : {}) }, () => route[1](req, res))
    } catch (error) {
      if (!res.headersSent) res.status(error instanceof SyntaxError || error instanceof URIError ? 400 : 500).json({ error: 'Request failed' })
      else res.end()
      if (!(error instanceof SyntaxError || error instanceof URIError)) console.error(JSON.stringify({ event: 'api_request_failed' }))
    }
  })
}

export function startApiServer() {
  process.umask(0o077)
  for (const name of ['CONSOLE_DB_PATH', 'CONSOLE_SERVICE_KEY', 'CONSOLE_DEBUG_KEY', 'CONSOLE_DEBUG_USER_ID', 'JWT_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'NEXTAUTH_URL']) {
    if (!process.env[name]) throw new Error(`Missing ${name}`)
  }
  const storage = new SQLiteDatabase(process.env.CONSOLE_DB_PATH!)
  let backingUp = false
  const snapshot = async () => {
    if (backingUp) return
    backingUp = true
    try {
      await snapshotDatabase(storage.connection, join(dirname(process.env.CONSOLE_DB_PATH!), 'backups'))
      console.log(JSON.stringify({ event: 'sqlite_backup_verified' }))
    } catch { console.error(JSON.stringify({ event: 'sqlite_backup_failed' })) }
    finally { backingUp = false }
  }
  void snapshot()
  const backupTimer = setInterval(() => { void snapshot() }, 24 * 60 * 60 * 1000)
  backupTimer.unref()
  const database = new ConsoleDatabase(storage)
  const server = createApiServer({ database, serviceKey: process.env.CONSOLE_SERVICE_KEY!, debugKey: process.env.CONSOLE_DEBUG_KEY!, debugUserId: process.env.CONSOLE_DEBUG_USER_ID! })
  server.requestTimeout = 30000
  server.headersTimeout = 10000
  server.listen(Number(process.env.PORT || 3000), process.env.HOST || '127.0.0.1', () => console.log('Console API ready'))
  const stop = () => { clearInterval(backupTimer); server.close(() => { storage.close(); process.exit(0) }) }
  process.once('SIGTERM', stop)
  process.once('SIGINT', stop)
  return server
}
