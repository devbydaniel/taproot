import type {
  JournalPayload,
  LinkedRefGroup,
  Op,
  Page,
  PagePayload,
  ZoomPayload,
} from '@taproot/shared';
import { nanoid } from 'nanoid';

/** identifies this browser tab so it can ignore its own ops echoed over the websocket */
export const clientId = nanoid();

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return (await res.json()) as T;
}

export const api = {
  listPages: () => getJson<Page[]>('/api/pages'),
  pageByTitle: (title: string) =>
    getJson<Page>(`/api/pages/by-title/${encodeURIComponent(title)}`),
  getPage: (id: string) =>
    getJson<PagePayload>(`/api/pages/${encodeURIComponent(id)}`),
  getBlock: (id: string) =>
    getJson<ZoomPayload>(`/api/blocks/${encodeURIComponent(id)}`),
  getTasks: () => getJson<{ groups: LinkedRefGroup[] }>('/api/tasks'),
  getJournal: (opts: { before?: string; limit?: number } = {}) => {
    const params = new URLSearchParams();
    if (opts.before) params.set('before', opts.before);
    if (opts.limit) params.set('limit', String(opts.limit));
    const query = params.toString();
    return getJson<JournalPayload>(`/api/journal${query ? `?${query}` : ''}`);
  },
  postOps: (ops: Op[]) =>
    fetch('/api/ops', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, ops }),
    }).catch((err: unknown) => console.error('failed to send ops', err)),
};
