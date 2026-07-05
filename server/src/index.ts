import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createNodeWebSocket } from '@hono/node-ws';
import type { OpsBroadcast } from '@taproot/shared';
import { Hono } from 'hono';
import type { WSContext } from 'hono/ws';
import { existsSync } from 'node:fs';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApi } from './app.js';
import { createStore } from './db.js';
import { reindexTasks } from './ops.js';
import { seedIfEmpty } from './seed.js';

const dbPath =
  process.env.TAPROOT_DB ??
  fileURLToPath(new URL('../../data/taproot.db', import.meta.url));
const store = createStore(dbPath);
seedIfEmpty(store);
reindexTasks(store); // heal databases created before the task index existed

const app = new Hono();
// eslint-disable-next-line @typescript-eslint/unbound-method -- plain closures from the factory, not `this`-bound methods
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

app.route('/api', createApi(store, broadcast));

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
