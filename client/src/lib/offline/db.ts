import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  QueueRecord,
  QueueStorage,
  RejectedRecord,
  UnverifiedPage,
} from './queue';

/**
 * IndexedDB persistence for offline support: the durable op queue, a
 * per-endpoint response cache for offline reads, and a dead-letter store
 * for server-rejected records (inspectable via devtools; nothing is ever
 * silently discarded).
 */

interface CacheEntry {
  key: string;
  payload: unknown;
  savedAt: number;
}

interface OfflineDB extends DBSchema {
  queue: {
    key: number;
    // seq is assigned by autoIncrement on add, present on every read
    value: Omit<QueueRecord, 'seq'> & { seq?: number };
  };
  cache: { key: string; value: CacheEntry };
  rejected: { key: number; value: RejectedRecord };
}

let dbPromise: Promise<IDBPDatabase<OfflineDB>> | null = null;

function getDb() {
  dbPromise ??= openDB<OfflineDB>('taproot-offline', 1, {
    upgrade(db) {
      db.createObjectStore('queue', { keyPath: 'seq', autoIncrement: true });
      db.createObjectStore('cache', { keyPath: 'key' });
      db.createObjectStore('rejected', { keyPath: 'seq' });
    },
  });
  return dbPromise;
}

export function createIdbQueueStorage(): QueueStorage {
  return {
    async loadAll() {
      return (await (await getDb()).getAll('queue')) as QueueRecord[];
    },
    async add(rec) {
      return (await getDb()).add('queue', rec);
    },
    async put(rec) {
      await (await getDb()).put('queue', rec);
    },
    async delete(seqs) {
      const tx = (await getDb()).transaction('queue', 'readwrite');
      await Promise.all(seqs.map((seq) => tx.store.delete(seq)));
      await tx.done;
    },
    async addRejected(rec) {
      await (await getDb()).put('rejected', rec);
    },
    // lives in the cache store under a reserved key — not a response cache
    // entry, but the same key/value shape, and not worth a schema bump
    async loadUnverifiedPages() {
      return (await cacheGet<UnverifiedPage[]>(UNVERIFIED_PAGES_KEY)) ?? [];
    },
    async saveUnverifiedPages(pages) {
      await cachePut(UNVERIFIED_PAGES_KEY, pages);
    },
  };
}

const UNVERIFIED_PAGES_KEY = '__unverified-pages';

export async function cacheGet<T>(key: string): Promise<T | undefined> {
  const entry = await (await getDb()).get('cache', key);
  return entry === undefined ? undefined : (entry.payload as T);
}

export async function cachePut(key: string, payload: unknown): Promise<void> {
  await (await getDb()).put('cache', { key, payload, savedAt: Date.now() });
}

export async function cacheDelete(key: string): Promise<void> {
  await (await getDb()).delete('cache', key);
}
