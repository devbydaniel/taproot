import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createNodeWebSocket } from '@hono/node-ws';
import {
  isDailyTitle,
  type OpsBroadcast,
  type OpsRequest,
} from '@taproot/shared';
import { Hono } from 'hono';
import type { WSContext } from 'hono/ws';
import { existsSync } from 'node:fs';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from './db.js';
import { applyOps, ensurePage, reindexTasks } from './ops.js';
import {
  getJournal,
  getPagePayload,
  getTaskGroups,
  getZoomPayload,
  listPages,
} from './queries.js';
import { seedIfEmpty } from './seed.js';

const dbPath =
  process.env.TAPROOT_DB ??
  fileURLToPath(new URL('../../data/taproot.db', import.meta.url));
const store = createStore(dbPath);
seedIfEmpty(store);
reindexTasks(store); // heal databases created before the task index existed

const app = new Hono();
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

const sockets = new Set<WSContext>();
function broadcast(message: OpsBroadcast) {
  const payload = JSON.stringify(message);
  for (const socket of sockets) socket.send(payload);
}

app.get(
  '/ws',
  upgradeWebSocket(() => ({
    onOpen(_event, ws) {
      sockets.add(ws);
    },
    onClose(_event, ws) {
      sockets.delete(ws);
    },
  })),
);

const api = new Hono();

api.get('/pages', (c) => c.json(listPages(store)));

api.get('/tasks', (c) => c.json({ groups: getTaskGroups(store) }));

api.get('/journal', (c) => {
  const before = c.req.query('before');
  if (before !== undefined && !isDailyTitle(before)) {
    return c.json({ error: 'before must be an ISO date title' }, 400);
  }
  const limitRaw = c.req.query('limit');
  const limit = limitRaw === undefined ? undefined : Number(limitRaw);
  return c.json(getJournal(store, { before, limit }));
});

api.get('/pages/by-title/:title', (c) => {
  const title = c.req.param('title').trim();
  if (!title) return c.json({ error: 'empty title' }, 400);
  return c.json(ensurePage(store, title));
});

api.get('/pages/:id', (c) => {
  const payload = getPagePayload(store, c.req.param('id'));
  return payload ? c.json(payload) : c.json({ error: 'not found' }, 404);
});

api.get('/blocks/:id', (c) => {
  const payload = getZoomPayload(store, c.req.param('id'));
  return payload ? c.json(payload) : c.json({ error: 'not found' }, 404);
});

api.post('/ops', async (c) => {
  const body = (await c.req.json()) as OpsRequest;
  if (!Array.isArray(body.ops) || body.ops.length === 0) {
    return c.json({ error: 'no ops' }, 400);
  }
  applyOps(store, body.ops);
  broadcast({ type: 'ops', clientId: body.clientId, ops: body.ops });
  return c.json({ ok: true });
});

app.route('/api', api);

// serve the built client when present (production / docker)
const clientDist = fileURLToPath(new URL('../../client/dist', import.meta.url));
if (existsSync(clientDist)) {
  const root = relative(process.cwd(), clientDist);
  app.use('*', serveStatic({ root }));
  app.get('*', serveStatic({ root, path: 'index.html' }));
}

const port = Number(process.env.PORT ?? 3000);
const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(
    `taproot server listening on http://localhost:${info.port} (db: ${dbPath})`,
  );
});
injectWebSocket(server);
