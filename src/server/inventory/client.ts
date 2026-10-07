/** Workers use the public console proxy and a single campaign capability token. */
export function inventoryClient(endpoint: string, token: string, fetchImpl = fetch) {
    const url = new URL(endpoint);
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname))) || url.username || url.password || url.search || url.hash || !url.pathname.endsWith('/api/inventory'))
        throw new Error('Use an HTTPS inventory endpoint or literal loopback for development');
    if (!/^binv_[A-Za-z0-9_-]{43}$/.test(token))
        throw new Error('A scoped inventory token is required');
    return async (body: Record<string, unknown>) => {
        const response = await fetchImpl(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (!response.ok)
            throw new Error(`Inventory request failed (${response.status})`);
        const data = await response.json() as {
            success?: boolean;
            result: Record<string, any> | null;
        };
        if (!data.success)
            throw new Error('Invalid inventory response');
        return data.result;
    };
}
