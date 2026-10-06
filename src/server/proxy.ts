// Only these browser headers may cross the trusted proxy boundary.
export async function proxyApi(request: Request, origin: string, serviceKey: string, debugKey?: string) {
  const incoming = new URL(request.url)
  const target = new URL(origin)
  target.pathname = target.pathname.replace(/\/$/, '') + incoming.pathname
  target.search = incoming.search
  const headers = new Headers()
  for (const name of ['accept', 'content-type', 'authorization']) {
    const value = request.headers.get(name)
    if (value) headers.set(name, value)
  }
  headers.set('x-console-service-key', serviceKey)
  if (debugKey) {
    headers.delete('authorization')
    headers.set('x-console-debug-key', debugKey)
  }
  try {
    const response = await fetch(target, {
      method: request.method, headers, redirect: 'manual', signal: AbortSignal.timeout(30000),
      ...(['GET', 'HEAD'].includes(request.method) ? {} : { body: request.body, duplex: 'half' }),
    } as RequestInit)
    if (response.status >= 300 && response.status < 400) return Response.json({ error: 'Backend redirect rejected' }, { status: 502 })
    return new Response(response.body, { status: response.status, headers: {
      'content-type': response.headers.get('content-type') || 'application/json', 'cache-control': 'no-store',
      'x-content-type-options': 'nosniff', 'x-console-backend': 'majin',
    } })
  } catch {
    return Response.json({ error: 'Console backend unavailable' }, { status: 502, headers: { 'cache-control': 'no-store' } })
  }
}
