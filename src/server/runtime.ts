import { AsyncLocalStorage } from 'node:async_hooks'
import { ConsoleDatabase } from './database'
import type { InventoryStore } from './inventory/store'

export const requestContext = new AsyncLocalStorage<{ database: ConsoleDatabase; debugUserId?: string; inventory?: InventoryStore }>()

export function database() {
  const context = requestContext.getStore()
  if (!context) throw new Error('Missing database request context')
  return context.database
}
