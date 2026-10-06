import { startApiServer } from '../src/server/api-server'
void startApiServer().catch(() => {
  // Connection errors can contain hostnames and database details; never dump configuration.
  console.error(JSON.stringify({ event: 'console_api_startup_failed' }))
  process.exitCode = 1
})
