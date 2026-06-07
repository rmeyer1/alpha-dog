import { getCache } from "@vercel/functions";

const namespace = "alpha-dog-wheel";

function runtimeCacheDisabled() {
  return process.env.NODE_ENV === "test" || Boolean(process.env.VITEST);
}

export async function getRuntimeCacheValue<T>(key: string): Promise<T | null> {
  if (runtimeCacheDisabled()) {
    return null;
  }

  try {
    return (await getCache({ namespace }).get(key)) as T | undefined ?? null;
  } catch {
    return null;
  }
}

export async function setRuntimeCacheValue(
  key: string,
  value: unknown,
  options: {
    name: string;
    tags: string[];
    ttlSeconds: number;
  },
) {
  if (runtimeCacheDisabled()) {
    return;
  }

  try {
    await getCache({ namespace }).set(key, value, {
      name: options.name,
      tags: options.tags,
      ttl: options.ttlSeconds,
    });
  } catch {
    // Runtime Cache is an optimization; memory cache and live fetch remain the fallback.
  }
}
