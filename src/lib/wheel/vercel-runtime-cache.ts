import { getCache } from "@vercel/functions";
import { emitCacheTelemetry } from "@/lib/observability/cache";

const namespace = "alpha-dog-wheel";

function runtimeCacheDisabled() {
  return process.env.NODE_ENV === "test" || Boolean(process.env.VITEST);
}

function cacheOperation(key: string) {
  return key.split(":")[0] || "runtime_cache";
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
    emitCacheTelemetry(cacheOperation(key), "bypass");
    return;
  }

  try {
    await getCache({ namespace }).set(key, value, {
      name: options.name,
      tags: options.tags,
      ttl: options.ttlSeconds,
    });
    emitCacheTelemetry(options.name, "write_success");
  } catch (error) {
    emitCacheTelemetry(options.name, "write_failure", { error });
    // Runtime Cache is an optimization; memory cache and live fetch remain the fallback.
  }
}
