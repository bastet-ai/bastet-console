import { env } from 'cloudflare:workers'
import { ConsoleDatabase } from './database'

export function database() {
  return new ConsoleDatabase(env.DB)
}
