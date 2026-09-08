import { redis } from './redis';

export async function checkRateLimit(
  merchantId: string,
  limitPerMinute = 30
): Promise<{ allowed: boolean; remaining: number }> {
  const currentMinute = Math.floor(Date.now() / 60000);
  const key = `ratelimit:${merchantId}:${currentMinute}`;

  const currentCount = await redis.incr(key);
  if (currentCount === 1) {
    await redis.expire(key, 65); // Expire after 65 seconds
  }

  const allowed = currentCount <= limitPerMinute;
  const remaining = Math.max(0, limitPerMinute - currentCount);

  return { allowed, remaining };
}
