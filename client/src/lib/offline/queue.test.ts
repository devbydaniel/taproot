import type { Op, Page } from '@taproot/shared';
import { describe, expect, it } from 'vitest';
import {
  createOpQueue,
  OfflineError,
  RejectedError,
  type QueueRecord,
  type QueueStorage,
  type RejectedRecord,
} from './queue';

function memoryStorage() {
  let nextSeq = 1;
  const records = new Map<number, QueueRecord>();
  const rejected: RejectedRecord[] = [];
  let unverified: { id: string; title: string }[] = [];
  const storage: QueueStorage = {
    loadUnverifiedPages: () => Promise.resolve(unverified),
    saveUnverifiedPages: (pages) => {
      unverified = pages;
      return Promise.resolve();
    },
    loadAll: () => Promise.resolve([...records.values()]),
    add: (rec) => {
      const seq = nextSeq++;
      records.set(seq, { ...rec, seq });
      return Promise.resolve(seq);
    },
    put: (rec) => {
      records.set(rec.seq, rec);
      return Promise.resolve();
    },
    delete: (seqs) => {
      for (const seq of seqs) records.delete(seq);
      return Promise.resolve();
    },
    addRejected: (rec) => {
      rejected.push(rec);
      return Promise.resolve();
    },
  };
  return { storage, records, rejected };
}

/** a post stub that fails per a script of errors, then succeeds forever */
function scriptedPost(script: (Error | null)[] = []) {
  const calls: Op[][] = [];
  const post = (ops: Op[]) => {
    calls.push(ops);
    const err = script.shift();
    return err ? Promise.reject(err) : Promise.resolve();
  };
  return { post, calls };
}

const text = (id: string, t: string): Op => ({
  type: 'update_text',
  id,
  text: t,
});
const createBlock = (id: string, pageId: string): Op => ({
  type: 'create_block',
  id,
  pageId,
  parentId: null,
  orderKey: 'a0',
  text: '',
});
const createPage = (id: string, title: string): Op => ({
  type: 'create_page',
  id,
  title,
});
const page = (id: string, title: string): Page => ({
  id,
  title,
  createdAt: 0,
  pinnedOrderKey: null,
});

function makeQueue(deps: {
  storage: QueueStorage;
  post: (ops: Op[]) => Promise<void>;
  serverPages?: Page[];
  onRemap?: (mapping: Map<string, string>) => void;
}) {
  return createOpQueue({
    storage: deps.storage,
    post: deps.post,
    listServerPages: () => Promise.resolve(deps.serverPages ?? []),
    onRemap: deps.onRemap,
  });
}

describe('op queue', () => {
  it('drains queued records FIFO in one POST and empties the queue', async () => {
    const { storage } = memoryStorage();
    const { post, calls } = scriptedPost();
    const queue = makeQueue({ storage, post });
    await queue.init();
    await queue.enqueue([createBlock('b1', 'p1')]);
    await queue.enqueue([text('b1', 'hello')]);
    expect(queue.pendingCount()).toBe(2);

    expect(await queue.drain()).toBe('drained');
    expect(calls).toEqual([[createBlock('b1', 'p1'), text('b1', 'hello')]]);
    expect(queue.pendingCount()).toBe(0);
    expect(await storage.loadAll()).toEqual([]);
  });

  it('hydrates persisted records on init and preserves seq order', async () => {
    const { storage } = memoryStorage();
    await storage.add({ ops: [text('b1', 'one')], createdAt: 1, tries: 0 });
    await storage.add({ ops: [text('b2', 'two')], createdAt: 2, tries: 0 });
    const queue = makeQueue({ storage, post: scriptedPost().post });
    await queue.init();
    expect(queue.pendingOps()).toEqual([text('b1', 'one'), text('b2', 'two')]);
  });

  it('coalesces consecutive pure-text batches per block id', async () => {
    const { storage } = memoryStorage();
    const queue = makeQueue({ storage, post: scriptedPost().post });
    await queue.init();
    await queue.enqueue([text('b1', 'h')]);
    await queue.enqueue([text('b1', 'he'), text('b2', 'x')]);
    await queue.enqueue([text('b1', 'hel')]);
    expect(queue.pendingCount()).toBe(1);
    expect(queue.pendingOps()).toEqual([text('b1', 'hel'), text('b2', 'x')]);
    expect(await storage.loadAll()).toHaveLength(1);
  });

  it('does not coalesce across a structural record', async () => {
    const { storage } = memoryStorage();
    const queue = makeQueue({ storage, post: scriptedPost().post });
    await queue.init();
    await queue.enqueue([text('b1', 'a')]);
    await queue.enqueue([createBlock('b2', 'p1')]);
    await queue.enqueue([text('b1', 'ab')]);
    expect(queue.pendingCount()).toBe(3);
    expect(queue.pendingOps()).toEqual([
      text('b1', 'a'),
      createBlock('b2', 'p1'),
      text('b1', 'ab'),
    ]);
  });

  it('keeps everything on network failure and drains on retry', async () => {
    const { storage } = memoryStorage();
    const { post, calls } = scriptedPost([new OfflineError()]);
    const queue = makeQueue({ storage, post });
    await queue.init();
    await queue.enqueue([text('b1', 'kept')]);

    expect(await queue.drain()).toBe('offline');
    expect(queue.pendingCount()).toBe(1);
    expect(await storage.loadAll()).toHaveLength(1);

    expect(await queue.drain()).toBe('drained');
    expect(calls).toHaveLength(2);
    expect(queue.pendingCount()).toBe(0);
  });

  it('bisects a rejected batch, drains healthy records past the poison one', async () => {
    const { storage, rejected } = memoryStorage();
    // batch POST rejected, then per-record: first ok, second (poison) rejected
    const { post, calls } = scriptedPost([
      new RejectedError(500),
      null,
      new RejectedError(500),
    ]);
    const queue = makeQueue({ storage, post });
    await queue.init();
    await queue.enqueue([text('b1', 'fine')]);
    await queue.enqueue([createBlock('b2', 'gone-page')]);

    expect(await queue.drain()).toBe('offline');
    expect(calls).toHaveLength(3);
    // healthy record posted and removed; poison record kept with a strike
    expect(queue.pendingOps()).toEqual([createBlock('b2', 'gone-page')]);
    const [remaining] = await storage.loadAll();
    expect(remaining?.tries).toBe(1);
    expect(rejected).toHaveLength(0);
  });

  it('dead-letters a record after repeated rejections and keeps draining', async () => {
    const { storage, rejected } = memoryStorage();
    // every POST for the poison record is rejected: 5 batch attempts each
    // followed by a bisect attempt, then the trailing record drains
    const script = Array.from({ length: 10 }, () => new RejectedError(500));
    const { post } = scriptedPost(script);
    const queue = makeQueue({ storage, post });
    await queue.init();
    await queue.enqueue([createBlock('b1', 'gone-page')]);

    for (let i = 0; i < 4; i++) expect(await queue.drain()).toBe('offline');
    await queue.enqueue([text('b2', 'later')]);
    expect(await queue.drain()).toBe('drained');

    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.ops).toEqual([createBlock('b1', 'gone-page')]);
    expect(rejected[0]?.tries).toBe(5);
    expect(queue.pendingCount()).toBe(0);
  });

  it('heals blocks whose create_page was silently dropped by a title collision', async () => {
    // the race: the same title is created server-side between the drain's
    // page-list fetch and its POST — create_page is a silent no-op (UNIQUE
    // title + onConflictDoNothing) and dependent blocks FK-fail
    const { storage, rejected } = memoryStorage();
    let serverPages: Page[] = [];
    const posted: Op[][] = [];
    const post = (ops: Op[]) => {
      posted.push(ops);
      if (ops.some((o) => o.type === 'create_page')) {
        serverPages = [page('srv1', 'Raced')];
      }
      if (ops.some((o) => o.type === 'create_block' && o.pageId === 'loc1')) {
        return Promise.reject(new RejectedError(500));
      }
      return Promise.resolve();
    };
    const remaps: Map<string, string>[] = [];
    const queue = createOpQueue({
      storage,
      post,
      listServerPages: () => Promise.resolve(serverPages),
      onRemap: (m) => remaps.push(m),
    });
    await queue.init();
    await queue.enqueue([createPage('loc1', 'Raced')]);
    await queue.enqueue([createBlock('b1', 'loc1')]);

    // first drain bisects: create_page "succeeds" (no-op), create_block strikes
    expect(await queue.drain()).toBe('offline');
    // second drain verifies the posted create_page against the server list,
    // remaps the stranded block, and drains it — no data lost
    expect(await queue.drain()).toBe('drained');
    expect(posted[posted.length - 1]).toEqual([createBlock('b1', 'srv1')]);
    expect(remaps).toEqual([new Map([['loc1', 'srv1']])]);
    expect(rejected).toHaveLength(0);
    expect(queue.pendingCount()).toBe(0);
  });

  it('survives a reload between posting a raced create_page and verifying it', async () => {
    const { storage, rejected } = memoryStorage();
    const serverPages = [page('srv1', 'Raced')];
    // simulate the pre-reload session: create_page already posted (silently
    // dropped server-side), verification still pending, block still queued
    await storage.saveUnverifiedPages([{ id: 'loc1', title: 'Raced' }]);
    await storage.add({
      ops: [createBlock('b1', 'loc1')],
      createdAt: 1,
      tries: 1,
    });
    const { post, calls } = scriptedPost();
    const queue = makeQueue({ storage, post, serverPages });
    await queue.init();

    expect(await queue.drain()).toBe('drained');
    expect(calls).toEqual([[createBlock('b1', 'srv1')]]);
    expect(rejected).toHaveLength(0);
  });

  it('remaps queued ops onto a page auto-created server-side meanwhile', async () => {
    const { storage } = memoryStorage();
    const { post, calls } = scriptedPost();
    const remaps: Map<string, string>[] = [];
    const queue = makeQueue({
      storage,
      post,
      serverPages: [page('srv1', '2026-07-17')],
      onRemap: (m) => remaps.push(m),
    });
    await queue.init();
    await queue.enqueue([createPage('loc1', '2026-07-17')]);
    await queue.enqueue([createBlock('b1', 'loc1')]);

    expect(await queue.drain()).toBe('drained');
    // create_page dropped (its record emptied), block re-pointed at srv1
    expect(calls).toEqual([[createBlock('b1', 'srv1')]]);
    expect(remaps).toEqual([new Map([['loc1', 'srv1']])]);
    expect(queue.pendingCount()).toBe(0);
  });

  it('leaves create_page for genuinely new titles untouched', async () => {
    const { storage } = memoryStorage();
    const { post, calls } = scriptedPost();
    const queue = makeQueue({
      storage,
      post,
      serverPages: [page('x', 'Other')],
    });
    await queue.init();
    await queue.enqueue([
      createPage('loc1', 'Brand new'),
      createBlock('b1', 'loc1'),
    ]);

    expect(await queue.drain()).toBe('drained');
    expect(calls).toEqual([
      [createPage('loc1', 'Brand new'), createBlock('b1', 'loc1')],
    ]);
  });

  it('treats a failing page-list fetch during reconciliation as offline', async () => {
    const { storage } = memoryStorage();
    const { post, calls } = scriptedPost();
    const queue = createOpQueue({
      storage,
      post,
      listServerPages: () => Promise.reject(new TypeError('fetch failed')),
    });
    await queue.init();
    await queue.enqueue([createPage('loc1', 'New')]);

    expect(await queue.drain()).toBe('offline');
    expect(calls).toHaveLength(0);
    expect(queue.pendingCount()).toBe(1);
  });

  it('re-runs a drain requested while one is in flight', async () => {
    const { storage } = memoryStorage();
    const calls: Op[][] = [];
    let sneaked = false;
    // post runs only during drain, after `queue` below is initialized
    const post = async (ops: Op[]) => {
      calls.push(ops);
      if (!sneaked) {
        sneaked = true;
        // an enqueue + drain-kick lands while the POST is in flight
        await queue.enqueue([text('b2', 'late')]);
        void queue.drain();
      }
    };
    const queue = createOpQueue({
      storage,
      post,
      listServerPages: () => Promise.resolve([]),
    });
    await queue.init();
    await queue.enqueue([text('b1', 'early')]);

    expect(await queue.drain()).toBe('drained');
    expect(calls).toEqual([[text('b1', 'early')], [text('b2', 'late')]]);
    expect(queue.pendingCount()).toBe(0);
  });
});
