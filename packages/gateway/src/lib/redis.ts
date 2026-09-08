import { Redis } from '@upstash/redis';

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;

let client: Redis | null = null;

if (url && token) {
  try {
    client = new Redis({
      url,
      token,
      automaticDeserialization: true,
    });
  } catch (err) {
    console.error('[Gateway Redis] Failed to initialize client:', err);
  }
}

// In-memory fallback if Redis is unavailable or unconfigured
const inMemoryCache = new Map<string, { value: any; expiresAt: number }>();

export const redis = {
  async get<T = any>(key: string): Promise<T | null> {
    if (client) {
      try {
        return await client.get<T>(key);
      } catch (err) {
        console.warn(`[Gateway Redis] get failed for key "${key}", falling back to memory:`, err);
      }
    }
    const item = inMemoryCache.get(key);
    if (!item) return null;
    if (Date.now() > item.expiresAt) {
      inMemoryCache.delete(key);
      return null;
    }
    return item.value as T;
  },

  async set(
    key: string,
    value: any,
    options?: { ex?: number; nx?: boolean }
  ): Promise<'OK' | null> {
    if (client) {
      try {
        const result = await client.set(key, value, options as any);
        return result as 'OK' | null;
      } catch (err) {
        console.warn(`[Gateway Redis] set failed for key "${key}", falling back to memory:`, err);
      }
    }

    // In-memory SETNX + EX handling
    const existing = inMemoryCache.get(key);
    if (options?.nx && existing && Date.now() <= existing.expiresAt) {
      return null; // Key exists, NX failed
    }

    const ttlMs = (options?.ex ?? 90) * 1000;
    inMemoryCache.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
    return 'OK';
  },

  async del(key: string): Promise<number> {
    if (client) {
      try {
        return await client.del(key);
      } catch (err) {
        console.warn(`[Gateway Redis] del failed for key "${key}":`, err);
      }
    }
    const existed = inMemoryCache.has(key);
    inMemoryCache.delete(key);
    return existed ? 1 : 0;
  },

  async incr(key: string): Promise<number> {
    if (client) {
      try {
        return await client.incr(key);
      } catch (err) {
        console.warn(`[Gateway Redis] incr failed for key "${key}":`, err);
      }
    }
    const current = inMemoryCache.get(key);
    const newVal = (Number(current?.value) || 0) + 1;
    inMemoryCache.set(key, {
      value: newVal,
      expiresAt: current?.expiresAt ?? Date.now() + 60000,
    });
    return newVal;
  },

  async expire(key: string, seconds: number): Promise<number> {
    if (client) {
      try {
        return await client.expire(key, seconds);
      } catch (err) {
        console.warn(`[Gateway Redis] expire failed for key "${key}":`, err);
      }
    }
    const current = inMemoryCache.get(key);
    if (current) {
      current.expiresAt = Date.now() + seconds * 1000;
      return 1;
    }
    return 0;
  },
};
