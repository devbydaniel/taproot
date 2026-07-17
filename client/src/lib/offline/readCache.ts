import { cacheGet, cachePut } from './db';

/**
 * Network-first read-through cache: successful responses are written through
 * to IndexedDB, and a failed fetch falls back to the last cached payload so
 * previously visited content renders offline. Rethrows when both miss.
 */
export async function cachedFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
): Promise<T> {
  try {
    const fresh = await fetcher();
    void cachePut(key, fresh);
    return fresh;
  } catch (err) {
    const hit = await cacheGet<T>(key);
    if (hit !== undefined) return hit;
    throw err;
  }
}
