// Browser authentication talks only to the console API. Database bindings and
// provider secrets are confined to server modules.
declare global {
  interface Window {
    google: {
      accounts: {
        oauth2: {
          initCodeClient: (config: {
            client_id: string
            scope: string
            ux_mode: string
            callback: (response: { code?: string; error?: string }) => void
            error_callback?: (error: { type: string }) => void
          }) => { requestCode: () => void }
        }
      }
    }
  }
}

export interface User {
  id: string
  email: string
  name: string
  google_id: string
  avatar_url?: string | null
  created_at: string
  updated_at: string
}

export async function isLocalDebug(): Promise<boolean> {
  if (typeof window === 'undefined' || !['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)) return false
  try { return ((await (await fetch('/api/auth/debug')).json()) as { enabled?: boolean }).enabled === true } catch { return false }
}

export async function signInWithGoogle(): Promise<{ user?: User; error?: string }> {
  if (await isLocalDebug()) {
    try {
      const response = await fetch('/api/auth/debug', { method: 'POST', headers: { 'X-Console-Local-Login': '1' } })
      const data = await response.json() as { success?: boolean; token?: string; user?: User; error?: string }
      if (!response.ok || !data.success || !data.token || !data.user) return { error: data.error || 'Local sign-in failed' }
      localStorage.setItem('auth_token', data.token)
      return { user: data.user }
    } catch { return { error: 'Local sign-in failed' } }
  }
  if (typeof window === 'undefined' || !window.google) return { error: 'Google Identity Services not loaded' }
  if (!process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID) return { error: 'Google sign-in is not configured' }
  return new Promise(resolve => {
    const client = window.google.accounts.oauth2.initCodeClient({
      client_id: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID!,
      scope: 'openid email profile',
      ux_mode: 'popup',
      error_callback: () => resolve({ error: 'Google sign-in was cancelled or could not open' }),
      callback: async response => {
        if (!response.code) return resolve({ error: 'Google did not return an authorization code' })
        try {
          const result = await fetch('/api/auth/google', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: response.code })
          })
          const data = await result.json() as { success?: boolean; error?: string; token?: string; user?: User }
          if (!result.ok || !data.success || !data.token || !data.user) return resolve({ error: data.error || 'Sign-in failed' })
          localStorage.setItem('auth_token', data.token)
          resolve({ user: data.user })
        } catch {
          resolve({ error: 'Token exchange failed' })
        }
      }
    })
    client.requestCode()
  })
}

export async function signOut(): Promise<{ error?: string }> {
  const token = localStorage.getItem('auth_token')
  localStorage.removeItem('auth_token')
  try {
    await fetch('/api/auth/logout', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {} })
    return {}
  } catch {
    return { error: 'Could not contact the server; local session cleared' }
  }
}

export async function verifySession(): Promise<{ user?: User; error?: string }> {
  const token = localStorage.getItem('auth_token')
  if (!token) return { error: 'No session found' }
  try {
    const response = await fetch('/api/auth/verify', { headers: { Authorization: `Bearer ${token}` } })
    const data = await response.json() as { valid?: boolean; user?: User; error?: string }
    if (response.ok && data.valid) return { user: data.user }
    if (response.status === 401) localStorage.removeItem('auth_token')
    return { error: data.error || 'Failed to verify session' }
  } catch {
    return { error: 'Failed to verify session' }
  }
}
