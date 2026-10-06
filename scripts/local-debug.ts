import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { once } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { proxyApi } from '../src/server/proxy'

export function debugMiddleware(config: Record<string, string | undefined>, port: number) {
  const { CONSOLE_API_ORIGIN: origin, CONSOLE_SERVICE_KEY: serviceKey, CONSOLE_DEBUG_KEY: debugKey } = config
  if (!origin?.startsWith('https://') || !serviceKey || !debugKey) throw new Error('Local debug backend credentials are missing')
  const sessions = new Map<string, number>()
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`])
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const reply = (status: number, data: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      res.end(JSON.stringify(data))
    }
    const host = req.headers.host || ''
    const localOrigin = `http://${host}`
    const peer = req.socket.remoteAddress
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer || '') || !hosts.has(host) ||
      (req.headers.origin && req.headers.origin !== localOrigin) || req.headers['sec-fetch-site'] === 'cross-site') {
      return reply(403, { error: 'Local debug is restricted to this computer and same-origin requests' })
    }
    const url = new URL(req.url!, localOrigin)
    if (!url.pathname.startsWith('/api/')) return next()
    for (const [token, expires] of sessions) if (expires <= Date.now()) sessions.delete(token)
    if (url.pathname === '/api/auth/debug') {
      if (req.method === 'GET') return reply(200, { enabled: true })
      if (req.method !== 'POST') return reply(405, { error: 'Method not allowed' })
      if (req.headers['x-console-local-login'] !== '1') return reply(403, { error: 'Local login header required' })
      const response = await proxyApi(new Request(`${localOrigin}/api/auth/verify`), origin, serviceKey, debugKey)
      const data = await response.json() as { valid?: boolean; user?: unknown }
      if (!response.ok || !data.valid) return reply(502, { error: 'Debug account is unavailable' })
      if (sessions.size >= 1000) return reply(429, { error: 'Too many local sessions; restart the debug server' })
      const token = `local-debug.${randomBytes(32).toString('base64url')}`
      sessions.set(token, Date.now() + 8 * 60 * 60 * 1000)
      return reply(200, { success: true, user: data.user, token })
    }
    const token = req.headers.authorization?.replace(/^Bearer /, '') || ''
    if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
      sessions.delete(token)
      return reply(200, { success: true })
    }
    if (!sessions.has(token)) return reply(401, { error: 'Sign in with the local debug account' })
    if (url.pathname === '/api/auth/google') return reply(404, { error: 'Use local debug sign-in' })
    try {
      const chunks: Buffer[] = []
      let size = 0
      for await (const chunk of req) {
        size += chunk.length
        if (size > 262144) { req.resume(); return reply(413, { error: 'Request too large' }) }
        chunks.push(chunk)
      }
      const request = new Request(url, { method: req.method, headers: { 'content-type': 'application/json' },
        ...(['GET', 'HEAD'].includes(req.method!) ? {} : { body: Buffer.concat(chunks) }) })
      const response = await proxyApi(request, origin, serviceKey, debugKey)
      res.writeHead(response.status, Object.fromEntries(response.headers))
      const reader = response.body?.getReader()
      if (reader) {
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            if (!res.write(value)) await once(res, 'drain')
          }
        } finally { reader.releaseLock() }
      }
      res.end()
    } catch { if (!res.headersSent) reply(502, { error: 'Backend request failed' }); else res.end() }
  }
}

export function localDebug(): Plugin {
  return {
    name: 'bastet-loopback-debug', enforce: 'pre',
    config: () => ({ server: { host: '127.0.0.1', port: 5173, strictPort: true, cors: false } }),
    configureServer(server) {
      if (server.config.command !== 'serve' || server.config.mode !== 'debug' || process.env.NODE_ENV === 'production' || server.config.server.host !== '127.0.0.1') {
        throw new Error('Debug login is only supported by the loopback development server')
      }
      const config = parseEnv(readFileSync('.env.debug.local', 'utf8'))
      server.middlewares.use(debugMiddleware(config, server.config.server.port!))
    },
  }
}
