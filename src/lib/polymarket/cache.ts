interface CacheEntry<T> {
  expiresAt: number;
  value: T;
}

const cache = new Map<string, CacheEntry<unknown>>();

export function getMemoryCache<T>(key: string) {
  const entry = cache.get(key);

  if (!entry) {
    return null;
  }

  if (Date.now() >= entry.expiresAt) {
    cache.delete(key);

    return null;
  }

  return {
    cachedUntil: new Date(entry.expiresAt).toISOString(),
    value: entry.value as T,
  };
}

export function setMemoryCache<T>(key: string, value: T, ttlMs: number) {
  cache.set(key, {
    expiresAt: Date.now() + ttlMs,
    value,
  });
}

export function clearPolymarketCache() {
  for (const key of cache.keys()) {
    if (key.startsWith("polymarket:")) {
      cache.delete(key);
    }
  }
}
