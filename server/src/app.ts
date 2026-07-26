import { zValidator } from '@hono/zod-validator';
import { opsRequestSchema, type OpsBroadcast } from '@taproot/shared';
import { Hono } from 'hono';
import { createAgentApi } from './agentApi.js';
import type { Store } from './db.js';
import { applyOps, ensurePage } from './ops.js';
import {
  getPagePayload,
  getTaskList,
  getZoomPayload,
  listPages,
} from './queries.js';

// routes must stay chained on one expression: hc<ApiType> infers the client
// from the accumulated type, and separate `api.get(...)` statements lose it
export function createApi(
  store: Store,
  broadcast: (message: OpsBroadcast) => void,
) {
  return new Hono()
    .get('/pages', (c) => c.json(listPages(store), 200))
    .get('/tasks', (c) => c.json(getTaskList(store), 200))
    .get('/pages/by-title/:title', (c) => {
      const title = c.req.param('title').trim();
      if (!title) return c.json({ error: 'empty title' }, 400);
      return c.json(ensurePage(store, title), 200);
    })
    .get('/pages/:id', (c) => {
      const payload = getPagePayload(store, c.req.param('id'));
      return payload
        ? c.json(payload, 200)
        : c.json({ error: 'not found' }, 404);
    })
    .get('/blocks/:id', (c) => {
      const payload = getZoomPayload(store, c.req.param('id'));
      return payload
        ? c.json(payload, 200)
        : c.json({ error: 'not found' }, 404);
    })
    .post(
      '/ops',
      zValidator('json', opsRequestSchema, (result, c) => {
        if (!result.success) {
          return c.json({ error: 'invalid ops request' }, 400);
        }
      }),
      (c) => {
        const { clientId, ops } = c.req.valid('json');
        applyOps(store, ops);
        broadcast({ type: 'ops', clientId, ops });
        return c.json({ ok: true }, 200);
      },
    )
    .route('/agent', createAgentApi(store, broadcast));
}

export type ApiType = ReturnType<typeof createApi>;
