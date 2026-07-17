import type { Block, Op, Page } from '@taproot/shared';
import { nanoid } from 'nanoid';
import { useStore } from '@/store';
import { cacheDelete, cachePut, createIdbQueueStorage } from './db';
import { createOpQueue, type DrainResult, type OpQueue } from './queue';

/**
 * Composition root for offline support: owns the op queue instance, wires
 * the drain triggers, and provides the snapshot-install helpers that keep
 * server refetches from clobbering not-yet-synced local state. Transport is
 * injected from main.tsx so this module never imports api.ts (which imports
 * this module for ensurePageOffline).
 */

let queue: OpQueue | null = null;
let postFallback: ((ops: Op[]) => Promise<void>) | null = null;
/** actions.ts registers its debounced-text buffer so overlays include it */
let pendingTextProvider: () => Op[] = () => [];

export function setPendingTextProvider(provider: () => Op[]) {
  pendingTextProvider = provider;
}

export async function initOffline(deps: {
  post: (ops: Op[]) => Promise<void>;
  /** must hit the network, never the cache — used to reconcile page ids */
  listServerPages: () => Promise<Page[]>;
  /**
   * re-caches views that matter offline but may not be mounted when a sync
   * lands (the journal) — mounted views re-cache via the epoch bump
   */
  refreshCaches?: () => void;
}): Promise<void> {
  // kept even if IndexedDB init fails, so writes degrade to direct POSTs
  postFallback = deps.post;
  const candidate = createOpQueue({
    storage: createIdbQueueStorage(),
    post: deps.post,
    listServerPages: deps.listServerPages,
    onRemap: applyRemap,
  });
  candidate.onChange((n) => useStore.getState().setPendingCount(n));
  refreshCaches = deps.refreshCaches ?? null;
  await candidate.init();
  queue = candidate;
  wireTriggers();
  void kickDrain();
}

/** queue a write batch durably and try to sync; the only write transport */
export async function enqueueOps(ops: Op[]): Promise<void> {
  if (!queue) {
    // IndexedDB unavailable (init failed): behave like the pre-offline app
    void postFallback?.(ops).catch((err: unknown) => {
      console.error('failed to send ops', err);
    });
    return;
  }
  await queue.enqueue(ops);
  void kickDrain();
}

// --- drain triggers ---

const BACKOFF_MIN_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;
let backoffMs = BACKOFF_MIN_MS;
let backoffTimer: ReturnType<typeof setTimeout> | null = null;

export function kickDrain(): Promise<DrainResult | null> {
  return drainLocked().catch((err: unknown) => {
    console.error('drain failed', err);
    return null;
  });
}

/** one drain per browser (not per tab) at a time — tabs share the IDB queue */
async function drainLocked(): Promise<DrainResult | null> {
  if (!queue) return null;
  const run = async () => {
    const hadPending = queue!.pendingCount() > 0;
    const result = await queue!.drain();
    if (result === 'offline' && navigator.onLine) armBackoff();
    else if (result === 'drained') {
      resetBackoff();
      // ops just reached the server, but the read cache only refreshes when a
      // view refetches — and local edits never trigger one. Without this, an
      // offline reload would show the view as of its last fetch, missing
      // everything synced (and therefore dequeued) since. Debounced so a
      // typing session costs one refetch, not one per pause.
      if (hadPending) scheduleCacheRefresh();
    }
    return result;
  };
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- older Safari lacks navigator.locks
  if (navigator.locks) {
    return navigator.locks.request(
      'taproot:drain',
      { ifAvailable: true },
      async (lock) => (lock ? run() : null),
    );
  }
  return run();
}

function armBackoff() {
  if (backoffTimer) return;
  backoffTimer = setTimeout(() => {
    backoffTimer = null;
    backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX_MS);
    void kickDrain();
  }, backoffMs);
}

function resetBackoff() {
  if (backoffTimer) clearTimeout(backoffTimer);
  backoffTimer = null;
  backoffMs = BACKOFF_MIN_MS;
}

const CACHE_REFRESH_MS = 3_000;
let cacheRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let refreshCaches: (() => void) | null = null;

/** refetch (and thereby re-cache) mounted views shortly after a sync */
function scheduleCacheRefresh() {
  if (cacheRefreshTimer) clearTimeout(cacheRefreshTimer);
  cacheRefreshTimer = setTimeout(() => {
    cacheRefreshTimer = null;
    useStore.getState().bumpRemoteEpoch();
    refreshCaches?.();
  }, CACHE_REFRESH_MS);
}

function wireTriggers() {
  window.addEventListener('online', () => void kickDrain());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void kickDrain();
  });
}

// --- snapshot installs: server data + local not-yet-synced ops ---

/** every op the server hasn't confirmed yet, oldest first */
function overlayOps(): Op[] {
  return [...(queue?.pendingOps() ?? []), ...pendingTextProvider()];
}

/**
 * A fetched snapshot (network or cache) predates whatever is still queued
 * locally, and loadPageBlocks replaces the page wholesale — so every install
 * re-applies the pending ops on top. The client reducer tolerates replay.
 *
 * Offline, the snapshot came from the cache and may be older than what the
 * store already holds (edits synced since the cache was written) — merge
 * instead of replace, since a stale snapshot has no authority on deletions.
 */
export function installPageSnapshot(pageId: string, blocks: Block[]) {
  const store = useStore.getState();
  if (store.connectivity === 'offline') store.mergeBlocks(blocks);
  else store.loadPageBlocks(pageId, blocks);
  store.applyOps(overlayOps());
}

export function installMergedBlocks(blocks: Block[]) {
  const store = useStore.getState();
  store.mergeBlocks(blocks);
  store.applyOps(overlayOps());
}

/** page-list counterpart: keeps offline-created pages visible after refetch */
export function installPages(pages: Page[]) {
  const store = useStore.getState();
  store.setPages(pages);
  store.applyOps(overlayOps());
}

// --- offline page creation ---

/**
 * Offline fallback for GET /pages/by-title (which normally auto-creates the
 * page server-side): mint the page locally and queue its create_page. If the
 * same title gets created server-side meanwhile, the drain-time remap heals
 * the id split.
 */
export async function ensurePageOffline(title: string): Promise<Page> {
  const known = useStore.getState().pages.find((p) => p.title === title);
  if (known) return known;
  const page: Page = {
    id: nanoid(),
    title,
    createdAt: Date.now(),
    pinnedOrderKey: null,
  };
  const op: Op = { type: 'create_page', id: page.id, title };
  useStore.getState().applyOps([op]);
  await enqueueOps([op]);
  void cachePut(`title:${title}`, page);
  void cachePut(`page:${page.id}`, { page, blocks: [], linkedRefs: [] });
  return page;
}

/** an offline-created page id turned out to exist server-side under another id */
function applyRemap(mapping: Map<string, string>) {
  const store = useStore.getState();
  for (const [localId, serverId] of mapping) {
    const page = store.pages.find((p) => p.id === localId);
    store.remapPageId(localId, serverId);
    void cacheDelete(`page:${localId}`);
    if (page) void cachePut(`title:${page.title}`, { ...page, id: serverId });
    // wouter patches replaceState, so the open view re-keys to the server id
    if (location.pathname === `/p/${localId}`) {
      history.replaceState(null, '', `/p/${serverId}`);
    }
  }
}
