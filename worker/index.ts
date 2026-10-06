import { env } from 'cloudflare:workers'
import handler from 'vinext/server/fetch-handler'
import { proxyApi } from '../src/server/proxy'
import { ConsoleDatabase } from '../src/server/database'
import { requestContext } from '../src/server/runtime'

export default {
  async fetch(request: Request) {
    const config = env as typeof env & { CONSOLE_STORAGE?: string; CONSOLE_API_ORIGIN?: string; CONSOLE_SERVICE_KEY?: string; MIGRATION_READ_ONLY?: string }
    const path = new URL(request.url).pathname
    if (path.startsWith('/api/')) {
      if (path === '/api/auth/debug') return Response.json({ error: 'Not found' }, { status: 404 })
      if (config.MIGRATION_READ_ONLY === '1' && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
        return Response.json({ error: 'Console migration in progress. Please retry shortly.' }, { status: 503, headers: { 'retry-after': '120', 'cache-control': 'no-store' } })
      }
      if (config.CONSOLE_API_ORIGIN) {
        if (!config.CONSOLE_SERVICE_KEY) return Response.json({ error: 'Backend configuration unavailable' }, { status: 503 })
        return proxyApi(request, config.CONSOLE_API_ORIGIN, config.CONSOLE_SERVICE_KEY)
      }
      if (config.CONSOLE_STORAGE !== 'd1') return Response.json({ error: 'Backend configuration unavailable' }, { status: 503 })
    }
    // Explicit pre-cutover/rollback mode only, never fallback after a Majin error.
    return requestContext.run({ database: new ConsoleDatabase(env.DB) }, () => handler.fetch(request))
  },
}
