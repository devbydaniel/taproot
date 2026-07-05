import type { ApiType } from '@taproot/server';
import type { Op } from '@taproot/shared';
import { hc } from 'hono/client';
import { nanoid } from 'nanoid';

/** identifies this browser tab so it can ignore its own ops echoed over the websocket */
export const clientId = nanoid();

const client = hc<ApiType>('/api');

type SuccessBody<R> = R extends { ok: true; json: () => Promise<infer T> }
  ? T
  : never;

/** throw on error responses, narrowing the result to the 2xx body type */
async function unwrap<
  R extends { ok: boolean; status: number; url: string } & {
    json: () => Promise<unknown>;
  },
>(promise: Promise<R>): Promise<SuccessBody<R>> {
  const res = await promise;
  if (!res.ok) throw new Error(`${res.status} ${res.url}`);
  return (await res.json()) as SuccessBody<R>;
}

export const api = {
  listPages: () => unwrap(client.pages.$get()),
  pageByTitle: (title: string) =>
    unwrap(
      client.pages['by-title'][':title'].$get({
        // hc substitutes params without escaping them; titles can contain anything
        param: { title: encodeURIComponent(title) },
      }),
    ),
  getPage: (id: string) =>
    unwrap(client.pages[':id'].$get({ param: { id: encodeURIComponent(id) } })),
  getBlock: (id: string) =>
    unwrap(
      client.blocks[':id'].$get({ param: { id: encodeURIComponent(id) } }),
    ),
  getTasks: () => unwrap(client.tasks.$get()),
  getJournal: (opts: { before?: string; limit?: number } = {}) =>
    unwrap(
      client.journal.$get({
        query: {
          before: opts.before,
          limit: opts.limit === undefined ? undefined : String(opts.limit),
        },
      }),
    ),
  postOps: (ops: Op[]) =>
    client.ops
      .$post({ json: { clientId, ops } })
      .catch((err: unknown) => console.error('failed to send ops', err)),
};
