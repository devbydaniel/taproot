import { zValidator } from '@hono/zod-validator';
import { opsRequestSchema, type OpsBroadcast } from '@taproot/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { createAgentApi } from './agentApi.js';
import type { Store } from './db.js';
import { applyOps, ensurePage, saveDocMarkdown } from './ops.js';
import {
  getCalendarEvents,
  getDocMarkdown,
  getDoneTasks,
  getPagePayload,
  getTaskList,
  getZoomPayload,
  listPages,
  listPinFolders,
} from './queries.js';

// matches the update_data op's z.string().max(2_000_000) bound
const MAX_DOC_BYTES = 2_000_000;

// daily titles (Berlin dates for Google events), end exclusive; a year
// bounds the response size
const dateRangeSchema = z
  .object({ start: z.iso.date(), end: z.iso.date() })
  .refine(({ start, end }) => {
    const days = (Date.parse(end) - Date.parse(start)) / 86_400_000;
    return days > 0 && days <= 366;
  });

const dateRangeQuery = zValidator('query', dateRangeSchema, (result, c) => {
  if (!result.success) {
    return c.json({ error: 'expected ?start=YYYY-MM-DD&end=YYYY-MM-DD' }, 400);
  }
});

// routes must stay chained on one expression: hc<ApiType> infers the client
// from the accumulated type, and separate `api.get(...)` statements lose it.
// calendarId: the synced Google calendar; null = sync not configured
export function createApi(
  store: Store,
  broadcast: (message: OpsBroadcast) => void,
  calendarId: string | null = null,
) {
  return new Hono()
    .get('/pages', (c) => c.json(listPages(store), 200))
    .get('/calendar/events', dateRangeQuery, (c) =>
      c.json(getCalendarEvents(store, calendarId, c.req.valid('query')), 200),
    )
    .get('/pin-folders', (c) => c.json(listPinFolders(store), 200))
    .get('/tasks', (c) => c.json(getTaskList(store), 200))
    .get('/tasks/done', dateRangeQuery, (c) =>
      c.json(getDoneTasks(store, c.req.valid('query')), 200),
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
    .get('/docs/:blockId', (c) => {
      const markdown = getDocMarkdown(store, c.req.param('blockId'));
      return markdown === null
        ? c.json({ error: 'not found' }, 404)
        : c.body(markdown, 200, {
            'Content-Type': 'text/markdown; charset=utf-8',
          });
    })
    .put('/docs/:blockId', async (c) => {
      const markdown = await c.req.text();
      if (markdown.length > MAX_DOC_BYTES) {
        return c.json({ error: 'too large' }, 413);
      }
      const ops = saveDocMarkdown(store, c.req.param('blockId'), markdown);
      if (!ops) return c.json({ error: 'not found' }, 404);
      // fixed sentinel id: no browser tab PUTs docs, so every tab applies it
      broadcast({ type: 'ops', clientId: 'api', ops });
      return c.json({ ok: true }, 200);
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
