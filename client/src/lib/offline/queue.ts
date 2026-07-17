import type { Op, Page } from '@taproot/shared';
import { findPageRemaps, remapOps } from './remap';

/**
 * Durable offline op queue. Every write batch enters the queue (online or
 * not) and a drain POSTs records FIFO to the server — "online" is just "the
 * drain succeeds fast". The server op interpreter is idempotent, so a batch
 * whose response was lost can be replayed safely.
 *
 * This module is pure: storage and transport are injected, no browser APIs.
 * The IndexedDB adapter and the drain triggers live in offline/sync.ts.
 */

/** one dispatch batch; ops stay together so e.g. a split replays atomically */
export interface QueueRecord {
  seq: number;
  ops: Op[];
  createdAt: number;
  /** server-rejection attempts (network failures don't count) */
  tries: number;
}

/** dead-lettered record: rejected by the server too often, kept for inspection */
export interface RejectedRecord extends QueueRecord {
  error: string;
  rejectedAt: number;
}

/** server unreachable — retry forever, never drop */
export class OfflineError extends Error {
  constructor(cause?: unknown) {
    super('server unreachable', { cause });
    this.name = 'OfflineError';
  }
}

/** server answered non-2xx — the batch itself is the problem */
export class RejectedError extends Error {
  constructor(readonly status: number) {
    super(`ops rejected with status ${status}`);
    this.name = 'RejectedError';
  }
}

/** a create_page that was POSTed but not yet confirmed against the server list */
export interface UnverifiedPage {
  id: string;
  title: string;
}

export interface QueueStorage {
  loadAll(): Promise<QueueRecord[]>;
  /** assigns and returns the seq */
  add(rec: Omit<QueueRecord, 'seq'>): Promise<number>;
  put(rec: QueueRecord): Promise<void>;
  delete(seqs: number[]): Promise<void>;
  addRejected(rec: RejectedRecord): Promise<void>;
  loadUnverifiedPages(): Promise<UnverifiedPage[]>;
  saveUnverifiedPages(pages: UnverifiedPage[]): Promise<void>;
}

export type DrainResult = 'drained' | 'offline' | 'noop';

export interface OpQueue {
  /** hydrate the in-memory mirror from storage; call once before anything else */
  init(): Promise<void>;
  enqueue(ops: Op[]): Promise<void>;
  drain(): Promise<DrainResult>;
  /** all queued ops in seq order (sync, from the mirror) */
  pendingOps(): Op[];
  pendingCount(): number;
  onChange(cb: (pendingRecords: number) => void): void;
}

const MAX_TRIES = 5;
const MAX_RECORDS_PER_POST = 50;
const MAX_OPS_PER_POST = 500;

export function createOpQueue(deps: {
  storage: QueueStorage;
  /** POST one batch; throws OfflineError | RejectedError */
  post: (ops: Op[]) => Promise<void>;
  /** fresh server page list for create_page reconciliation — must NOT serve from cache */
  listServerPages: () => Promise<Page[]>;
  /** offline-created page ids that turned out to exist server-side under another id */
  onRemap?: (mapping: Map<string, string>) => void;
}): OpQueue {
  const { storage, post, listServerPages, onRemap } = deps;

  /** in-memory mirror of storage, seq order; source for pendingOps/overlays */
  let mirror: QueueRecord[] = [];
  /**
   * create_page ops POSTed but not yet checked against the server page list.
   * A POST that races a server-side creation of the same title is a silent
   * no-op (UNIQUE title + onConflictDoNothing), leaving queued blocks pointed
   * at a page id the server never saw — verification catches that and remaps.
   * Persisted so a reload inside the window can't strand those blocks.
   */
  let unverifiedPages: UnverifiedPage[] = [];
  /** seqs currently included in an in-flight POST; never coalesce into these */
  const inFlight = new Set<number>();
  let draining = false;
  let drainRequested = false;
  let changed: (pendingRecords: number) => void = () => {};

  const notify = () => changed(mirror.length);
  const pendingOps = () => mirror.flatMap((r) => r.ops);

  async function removeRecord(rec: QueueRecord) {
    await storage.delete([rec.seq]);
    mirror = mirror.filter((r) => r.seq !== rec.seq);
    notify();
  }

  async function enqueue(ops: Op[]) {
    if (ops.length === 0) return;
    // coalesce a pure-text batch into a pure-text tail record so long offline
    // typing sessions don't pile up hundreds of records; safe because
    // update_text is last-write-wins per block and the tail keeps its
    // position relative to all structural records
    const tail = mirror[mirror.length - 1];
    const allText = (batch: Op[]) =>
      batch.every((op) => op.type === 'update_text');
    if (tail && !inFlight.has(tail.seq) && allText(ops) && allText(tail.ops)) {
      for (const op of ops) {
        // both sides are all update_text here, so matching by id suffices
        const existing = tail.ops.findIndex((o) => o.id === op.id);
        if (existing >= 0) tail.ops[existing] = op;
        else tail.ops.push(op);
      }
      await storage.put(tail);
      notify();
      return;
    }
    const rec = { ops, createdAt: Date.now(), tries: 0 };
    const seq = await storage.add(rec);
    mirror.push({ ...rec, seq });
    notify();
  }

  /** remember successfully POSTed create_page ops until verified (5.3) */
  async function noteCreatedPages(ops: Op[]) {
    const created = ops.filter((op) => op.type === 'create_page');
    if (created.length === 0) return;
    unverifiedPages = [
      ...unverifiedPages,
      ...created.map((op) => ({ id: op.id, title: op.title })),
    ];
    await storage.saveUnverifiedPages(unverifiedPages);
  }

  /**
   * Offline-created pages carry client ids, but the same title may have been
   * auto-created server-side meanwhile (ensurePage, wikilinks — the daily
   * journal page is the common case) under a different id. pages.title is
   * UNIQUE and create_page is onConflictDoNothing, so replaying as-is would
   * silently drop the page and FK-fail every queued block on it. Remap the
   * queue to the server ids first — and verify already-POSTed creates, whose
   * silent-drop race is only visible in the server page list after the fact.
   */
  async function reconcilePages() {
    const queuedCreates = pendingOps().filter(
      (op) => op.type === 'create_page',
    );
    if (queuedCreates.length === 0 && unverifiedPages.length === 0) return;
    let serverPages: Page[];
    try {
      serverPages = await listServerPages();
    } catch (err) {
      throw new OfflineError(err);
    }
    const candidates: Op[] = [
      ...queuedCreates,
      ...unverifiedPages.map((p): Op => ({
        type: 'create_page',
        id: p.id,
        title: p.title,
      })),
    ];
    const mapping = findPageRemaps(candidates, serverPages);
    if (unverifiedPages.length > 0) {
      // one authoritative list settles every pending verification: the title
      // is either confirmed under the local id, remapped, or gone (deleted
      // server-side — dependent blocks then take the dead-letter path)
      unverifiedPages = [];
      await storage.saveUnverifiedPages(unverifiedPages);
    }
    if (mapping.size === 0) return;
    for (const rec of [...mirror]) {
      const remapped = remapOps(rec.ops, mapping);
      if (remapped.length === 0) {
        await removeRecord(rec);
      } else if (remapped !== rec.ops) {
        rec.ops = remapped;
        await storage.put(rec);
      }
    }
    notify();
    onRemap?.(mapping);
  }

  /** POST records one by one to isolate the poison record of a rejected batch */
  async function drainBisecting(
    records: QueueRecord[],
  ): Promise<DrainResult | null> {
    for (const rec of records) {
      try {
        await post(rec.ops);
        await noteCreatedPages(rec.ops);
        await removeRecord(rec);
      } catch (err) {
        if (err instanceof RejectedError) {
          rec.tries += 1;
          if (rec.tries >= MAX_TRIES) {
            // dead-letter: never block the queue forever, never silently drop
            await storage.addRejected({
              ...rec,
              error: err.message,
              rejectedAt: Date.now(),
            });
            await removeRecord(rec);
            continue;
          }
          await storage.put(rec);
          return 'offline'; // stop FIFO-intact; the next trigger retries
        }
        return 'offline';
      }
    }
    return null; // batch fully handled, outer loop continues
  }

  function selectBatch(): QueueRecord[] {
    const records: QueueRecord[] = [];
    let opCount = 0;
    for (const rec of mirror) {
      if (records.length >= MAX_RECORDS_PER_POST) break;
      if (records.length > 0 && opCount + rec.ops.length > MAX_OPS_PER_POST)
        break;
      records.push(rec);
      opCount += rec.ops.length;
    }
    return records;
  }

  /** POST one batch; null = fully handled, otherwise the drain stops here */
  async function postBatch(
    records: QueueRecord[],
  ): Promise<DrainResult | null> {
    for (const rec of records) inFlight.add(rec.seq);
    try {
      const ops = records.flatMap((r) => r.ops);
      await post(ops);
      await noteCreatedPages(ops);
      await storage.delete(records.map((r) => r.seq));
      const posted = new Set(records.map((r) => r.seq));
      mirror = mirror.filter((r) => !posted.has(r.seq));
      notify();
      return null;
    } catch (err) {
      if (err instanceof RejectedError) return await drainBisecting(records);
      return 'offline';
    } finally {
      for (const rec of records) inFlight.delete(rec.seq);
    }
  }

  async function drainOnce(): Promise<DrainResult> {
    for (;;) {
      // reconcile before selecting the batch — it may rewrite or empty records
      try {
        await reconcilePages();
      } catch (err) {
        if (err instanceof OfflineError) return 'offline';
        throw err;
      }
      const records = selectBatch();
      if (records.length === 0) return 'drained';
      const stopped = await postBatch(records);
      if (stopped !== null) return stopped;
    }
  }

  return {
    async init() {
      mirror = (await storage.loadAll()).sort((a, b) => a.seq - b.seq);
      unverifiedPages = await storage.loadUnverifiedPages();
      notify();
    },
    enqueue,
    async drain() {
      if (draining) {
        // a drain that races an enqueue could return between the empty check
        // and the flag reset; re-run once so nothing sits until the next trigger
        drainRequested = true;
        return 'noop';
      }
      draining = true;
      try {
        let result = await drainOnce();
        while (drainRequested) {
          drainRequested = false;
          result = await drainOnce();
        }
        return result;
      } finally {
        draining = false;
      }
    },
    pendingOps,
    pendingCount() {
      return mirror.length;
    },
    onChange(cb) {
      changed = cb;
    },
  };
}
