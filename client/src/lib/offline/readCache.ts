import { cacheGet, cachePut } from './db';

const READ_TIMEOUT_MS = 3_000;

/**
 * Network-first reads with a bounded wait. Known-offline reads go straight
 * to IndexedDB; a stalled connection falls back after three seconds. A cache
 * miss still rejects so callers can show an error or create a page locally.
 */
export async function cachedFetch<T>(
  key: string,
  fetcher: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  try {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      throw new Error('Offline');
    }
    const fresh = await fetchWithTimeout(fetcher);
    void cachePut(key, fresh).catch(() => undefined);
    return fresh;
  } catch (err) {
    const hit = await cacheGet<T>(key);
    if (hit !== undefined) return hit;
    throw err;
  }
}

async function fetchWithTimeout<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error('Read timed out'));
      controller.abort();
    }, READ_TIMEOUT_MS);
  });
  try {
    // Race as well as abort: even a transport that ignores the signal must
    // not prevent cached content from loading or overwrite it later.
    return await Promise.race([fetcher(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
