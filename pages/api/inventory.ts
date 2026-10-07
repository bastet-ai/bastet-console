import type { NextApiRequest, NextApiResponse } from 'next';
import { authenticatedUser, apiFailure } from '../../src/server/auth';
import { requestContext } from '../../src/server/runtime';
import { InventoryError, object, text } from '../../src/server/inventory/model';
import type { Actor } from '../../src/server/inventory/store';
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'POST'].includes(req.method ?? ''))
        return res.status(405).json({ error: 'Method not allowed' });
    // Worker tokens have a separate verifier and capabilities. They are not user
    // sessions and never reach existing campaign/auth/database endpoints.
    const header = req.headers.authorization;
    let actor: Actor;
    if (header?.startsWith('Bearer binv_'))
        actor = { token: header.slice(7) };
    else {
        const userId = authenticatedUser(req, res);
        if (!userId)
            return;
        actor = { userId };
    }
    const store = requestContext.getStore()?.inventory;
    try {
        if (!store || !await store.available())
            return req.method === 'GET'
                ? res.json({ configured: false, reason: 'The PostgreSQL inventory migration has not been applied.' })
                : res.status(503).json({ error: 'Inventory is not configured' });
        if (req.method === 'GET') {
            const view = typeof req.query.view === 'string' ? req.query.view : 'overview';
            if (view === 'overview') {
                if (!('userId' in actor))
                    throw new InventoryError(403, 'A user session is required for the portfolio view');
                return res.json(await store.overview(actor.userId, typeof req.query.campaign_id === 'string' ? req.query.campaign_id : undefined));
            }
            const campaign = text(req.query.campaign_id, 'campaign ID', 100);
            if (view === 'events')
                return res.json(await store.events(actor, campaign, typeof req.query.after === 'string' ? req.query.after : '0'));
            if (view === 'history')
                return res.json(await store.history(actor, campaign, text(req.query.deployment_id, 'deployment ID', 100), typeof req.query.kind === 'string' ? req.query.kind : undefined, typeof req.query.before === 'string' ? req.query.before : undefined));
            if (view === 'tokens')
                return res.json({ tokens: await store.tokens(actor, campaign) });
            throw new InventoryError(400, 'Unknown inventory view');
        }
        const body = object(req.body), campaign = text(body.campaign_id, 'campaign ID', 100), action = text(body.action, 'action', 50);
        let result: unknown;
        switch (action) {
            case 'deployment':
                result = await store.createDeployment(actor, campaign, body);
                break;
            case 'fingerprint':
                result = await store.fingerprint(actor, campaign, body);
                break;
            case 'research':
                result = await store.research(actor, campaign, body);
                break;
            case 'claim':
                result = await store.claim(actor, campaign);
                break;
            case 'heartbeat':
            case 'complete':
            case 'fail':
            case 'cancel':
                result = await store.researchAction(actor, campaign, body);
                break;
            case 'review':
                result = await store.review(actor, campaign, body);
                break;
            case 'issue_token':
                result = await store.issueToken(actor, campaign, body);
                break;
            case 'revoke_token':
                result = await store.revokeToken(actor, campaign, text(body.token_id, 'token ID', 100));
                break;
            case 'acknowledge':
                if (!('userId' in actor))
                    throw new InventoryError(403, 'A user session is required');
                result = await store.acknowledge(actor.userId, campaign, text(body.event_id, 'event ID', 20));
                break;
            default: throw new InventoryError(400, 'Unknown inventory action');
        }
        return res.json({ success: true, result });
    }
    catch (error) {
        if (error instanceof InventoryError)
            return res.status(error.status).json({ error: error.message });
        return apiFailure(res, 'inventory');
    }
}
