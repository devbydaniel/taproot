import { zValidator } from '@hono/zod-validator';
import {
  isDailyTitle,
  opsRequestSchema,
  type OpsBroadcast,
} from '@taproot/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Store } from './db.js';
import { applyOps, ensurePage } from './ops.js';
import {
  getJournal,
  getPagePayload,
  getTaskGroups,
  getZoomPayload,
  listPages,
} from './queries.js';

const journalQuerySchema = z.object({
  before: z.string().refine(isDailyTitle).optional(),
  limit: z.string().regex(/^\d+$/).optional(),
});

// routes must stay chained on one expression: hc<ApiType> infers the client
// from the accumulated type, and separate `api.get(...)` statements lose it
export function createApi(
  store: Store,
  broadcast: (message: OpsBroadcast) => void,
) {
  return new Hono()
    .get('/pages', (c) => c.json(listPages(store), 200))
    .get('/tasks', (c) => c.json({ groups: getTaskGroups(store) }, 200))
    .get(
      '/journal',
      zValidator('query', journalQuerySchema, (result, c) => {
        if (!result.success) {
          return c.json({ error: 'invalid journal query' }, 400);
        }
      }),
      (c) => {
        const { before, limit } = c.req.valid('query');
        return c.json(
          getJournal(store, {
            before,
            limit: limit === undefined ? undefined : Number(limit),
          }),
          200,
        );
      },
    )
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
    );
}

export type ApiType = ReturnType<typeof createApi>;
