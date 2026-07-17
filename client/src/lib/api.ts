import type { ApiType } from '@taproot/server';
import type { Op, Page } from '@taproot/shared';
import { hc } from 'hono/client';
import { nanoid } from 'nanoid';
import { cachePut, cacheGet } from '@/lib/offline/db';
import { OfflineError, RejectedError } from '@/lib/offline/queue';
import { cachedFetch } from '@/lib/offline/readCache';
import { ensurePageOffline } from '@/lib/offline/sync';

/**
 * Identifies this browser tab so it can ignore its own ops echoed over the
 * websocket. Persisted per tab (sessionStorage) so the id survives reloads —
 * ops queued offline replay under the same id; localStorage would make
 * sibling tabs suppress each other's echoes.
 */
export const clientId = getClientId();

function getClientId(): string {
  const key = 'taproot:clientId';
  try {
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const fresh = nanoid();
    sessionStorage.setItem(key, fresh);
    return fresh;
  } catch {
    return nanoid();
  }
}

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

/**
 * POST one op batch; the offline queue in lib/offline is the only caller.
 * Throws OfflineError (server unreachable — the queue retries forever) or
 * RejectedError (non-2xx — the queue isolates the poison record).
 */
export async function postOps(ops: Op[]): Promise<void> {
  let res: Awaited<ReturnType<typeof client.ops.$post>>;
  try {
    res = await client.ops.$post({ json: { clientId, ops } });
  } catch (err) {
    throw new OfflineError(err);
  }
  if (!res.ok) throw new RejectedError(res.status);
}

/** always hits the network — page-id reconciliation must not see cached data */
export function listPagesUncached(): Promise<Page[]> {
  return unwrap(client.pages.$get());
}

export const api = {
  listPages: () => cachedFetch('pages', listPagesUncached),
  /**
   * The server auto-creates the page (ensurePage); offline, fall back to the
   * cached page and then to creating it locally via the op queue.
   */
  pageByTitle: async (title: string): Promise<Page> => {
    try {
      const page = await unwrap(
        client.pages['by-title'][':title'].$get({
          // hc substitutes params without escaping them; titles can contain anything
          param: { title: encodeURIComponent(title) },
        }),
      );
      void cachePut(`title:${title}`, page);
      return page;
    } catch {
      const hit = await cacheGet<Page>(`title:${title}`);
      if (hit !== undefined) return hit;
      return ensurePageOffline(title);
    }
  },
  getPage: (id: string) =>
    cachedFetch(`page:${id}`, () =>
      unwrap(
        client.pages[':id'].$get({ param: { id: encodeURIComponent(id) } }),
      ),
    ),
  getBlock: (id: string) =>
    cachedFetch(`block:${id}`, () =>
      unwrap(
        client.blocks[':id'].$get({ param: { id: encodeURIComponent(id) } }),
      ),
    ),
  getTasks: () => cachedFetch('tasks', () => unwrap(client.tasks.$get())),
  getJournal: (opts: { before?: string; limit?: number } = {}) => {
    const fetcher = () =>
      unwrap(
        client.journal.$get({
          query: {
            before: opts.before,
            limit: opts.limit === undefined ? undefined : String(opts.limit),
          },
        }),
      );
    // only the latest window is cached; offline shows the last-loaded days
    return opts.before === undefined
      ? cachedFetch('journal', fetcher)
      : fetcher();
  },
};
