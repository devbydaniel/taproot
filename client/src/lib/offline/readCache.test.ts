import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cacheGet, cachePut } from './db';
import { cachedFetch } from './readCache';

vi.mock('./db', () => ({ cacheGet: vi.fn(), cachePut: vi.fn() }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  vi.stubGlobal('navigator', { onLine: true });
  vi.mocked(cachePut).mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('cachedFetch', () => {
  it('prefers fresh data online and caches it', async () => {
    const fetcher = vi.fn().mockResolvedValue({ text: 'fresh' });
    expect(await cachedFetch('page:1', fetcher)).toEqual({ text: 'fresh' });
    expect(fetcher).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(cachePut).toHaveBeenCalledWith('page:1', { text: 'fresh' });
    expect(cacheGet).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reads the cache immediately when offline without attempting the network', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    vi.mocked(cacheGet).mockResolvedValue({ text: 'cached' });
    const fetcher = vi.fn();
    expect(await cachedFetch('page:1', fetcher)).toEqual({ text: 'cached' });
    expect(cacheGet).toHaveBeenCalledWith('page:1');
    expect(fetcher).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects an offline cache miss without attempting the network', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const fetcher = vi.fn();
    await expect(cachedFetch('page:missing', fetcher)).rejects.toThrow(
      'Offline',
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('falls back immediately when the network fails', async () => {
    vi.mocked(cacheGet).mockResolvedValue([]);
    expect(
      await cachedFetch('tasks', () => Promise.reject(new Error('network'))),
    ).toEqual([]);
    expect(cachePut).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts a stalled request and loads the cache after three seconds', async () => {
    vi.mocked(cacheGet).mockResolvedValue({ id: 'today' });
    const fetcher = vi.fn(
      (_signal: AbortSignal) => new Promise<never>(() => undefined),
    );
    const result = cachedFetch('title:2026-08-01', fetcher);
    await vi.advanceTimersByTimeAsync(2_999);
    expect(cacheGet).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toEqual({ id: 'today' });
    expect(fetcher.mock.calls[0]![0].aborted).toBe(true);
    expect(cachePut).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects a stalled cache miss instead of hanging forever', async () => {
    const result = cachedFetch(
      'page:missing',
      () => new Promise(() => undefined),
    );
    const assertion = expect(result).rejects.toThrow('Read timed out');
    await vi.advanceTimersByTimeAsync(3_000);
    await assertion;
  });

  it('does not overwrite the cache if an aborted request resolves late', async () => {
    vi.mocked(cacheGet).mockResolvedValue('cached');
    let resolve!: (value: string) => void;
    const result = cachedFetch(
      'pages',
      () => new Promise<string>((done) => (resolve = done)),
    );
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await result).toBe('cached');
    resolve('late');
    await vi.advanceTimersByTimeAsync(0);
    expect(cachePut).not.toHaveBeenCalled();
  });

  it('preserves the network error on a cache miss', async () => {
    const error = new Error('network');
    await expect(
      cachedFetch('page:missing', () => Promise.reject(error)),
    ).rejects.toBe(error);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('still returns fresh data if persisting the cache fails', async () => {
    vi.mocked(cachePut).mockRejectedValue(new Error('storage unavailable'));
    expect(await cachedFetch('pages', () => Promise.resolve([]))).toEqual([]);
  });
});
