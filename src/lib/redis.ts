import RedisClient from 'ioredis';
import { Redis as UpstashRedis } from '@upstash/redis';
import logger from '@/lib/logger';

// Priority 1: Native AWS / Docker Redis (ioredis over TCP/RESP, sub-millisecond latency)
// Priority 2: Upstash REST Redis (fallback if only REST credentials provided)
const redisUrl = process.env.REDIS_URL;
const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;

let ioClient: RedisClient | null = null;
let upstashClient: UpstashRedis | null = null;

if (redisUrl && redisUrl.startsWith('redis')) {
    try {
        ioClient = new RedisClient(redisUrl, {
            maxRetriesPerRequest: 2,
            enableReadyCheck: true,
            lazyConnect: true,
            retryStrategy(times) {
                const delay = Math.min(times * 100, 3000);
                return delay;
            },
            reconnectOnError(err) {
                return err.message.includes('READONLY');
            }
        });

        ioClient.on('error', (err) => {
            logger.warn('[Redis] Native Redis connection warning:', err?.message || err);
        });

        ioClient.on('connect', () => {
            logger.info('[Redis] Successfully connected to Native Redis (TCP/RESP).');
        });

        // Fire connection in background without blocking module evaluation
        ioClient.connect().catch((err) => {
            logger.warn('[Redis] Initial connection attempt deferred:', err?.message || err);
        });
    } catch (err: any) {
        logger.error('[Redis] Failed to initialize Native Redis client:', err?.message || err);
    }
} else if (upstashUrl && upstashToken) {
    try {
        upstashClient = new UpstashRedis({
            url: upstashUrl,
            token: upstashToken,
            automaticDeserialization: true,
        });
        logger.info('[Redis] Initialized Upstash Redis REST fallback client.');
    } catch (err: any) {
        logger.error('[Redis] Failed to initialize Upstash fallback client:', err?.message || err);
    }
}

function safeJsonParse(data: any): any {
    if (typeof data !== 'string') return data;
    const trimmed = data.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        try {
            return JSON.parse(trimmed);
        } catch {
            return data;
        }
    }
    return data;
}

function serializeValue(value: any): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

export interface RedisInterface {
    get<T = any>(key: string): Promise<T | null>;
    set(key: string, value: any, opts?: any): Promise<any>;
    del(...keys: string[]): Promise<number>;
    incr(key: string): Promise<number>;
    decr(key: string): Promise<number>;
    expire(key: string, seconds: number): Promise<number>;
    ping(): Promise<string>;
    keys(pattern: string): Promise<string[]>;
    smembers(key: string): Promise<string[]>;
    sadd(key: string, ...members: string[]): Promise<number>;
    evalsha(sha1: string, keys: string[], args?: any[]): Promise<any>;
    eval(script: string, keys: string[], args?: any[]): Promise<any>;
    pipeline(): any;
    [key: string]: any;
}

export const redis: RedisInterface = new Proxy({} as any, {
    get(_target, prop) {
        // Native ioredis branch
        if (ioClient) {
            if (prop === 'pipeline') {
                return () => {
                    const pipe = ioClient!.pipeline();
                    return new Proxy(pipe, {
                        get(pTarget: any, pProp: string | symbol) {
                            if (pProp === 'exec') {
                                return async () => {
                                    try {
                                        const res = await pTarget.exec();
                                        return (res || []).map((r: any) => (r && r[0] ? null : safeJsonParse(r[1])));
                                    } catch (e) {
                                        logger.warn('[Redis Native Pipeline Error]:', e);
                                        return [];
                                    }
                                };
                            }
                            if (pProp === 'set') {
                                return (key: string, val: any, opts?: any) => {
                                    const serialized = serializeValue(val);
                                    if (opts && typeof opts === 'object' && opts.ex) {
                                        return pTarget.set(key, serialized, 'EX', opts.ex);
                                    }
                                    return pTarget.set(key, serialized);
                                };
                            }
                            return (...pArgs: any[]) => {
                                const fn = pTarget[pProp];
                                if (typeof fn === 'function') {
                                    return fn.apply(pTarget, pArgs);
                                }
                                return pTarget;
                            };
                        }
                    });
                };
            }

            if (prop === 'get') {
                return async <T = any>(key: string): Promise<T | null> => {
                    try {
                        const raw = await ioClient!.get(key);
                        return safeJsonParse(raw) as T;
                    } catch (e) {
                        logger.warn(`[Redis Native GET Error] ${key}:`, e);
                        return null;
                    }
                };
            }

            if (prop === 'set') {
                return async (key: string, value: any, opts?: any) => {
                    try {
                        const serialized = serializeValue(value);
                        if (opts && typeof opts === 'object' && opts.ex) {
                            return await ioClient!.set(key, serialized, 'EX', opts.ex);
                        }
                        return await ioClient!.set(key, serialized);
                    } catch (e) {
                        logger.warn(`[Redis Native SET Error] ${key}:`, e);
                        return null;
                    }
                };
            }

            if (prop === 'del') {
                return async (...keys: string[]) => {
                    try {
                        return await ioClient!.del(...keys);
                    } catch (e) {
                        logger.warn(`[Redis Native DEL Error]:`, e);
                        return 0;
                    }
                };
            }

            if (prop === 'eval') {
                return async (script: string, keys: any = [], args: any = []) => {
                    try {
                        if (Array.isArray(keys)) {
                            const flatArgs = [...keys, ...(Array.isArray(args) ? args : [])];
                            return await ioClient!.eval(script, keys.length, ...flatArgs);
                        } else if (typeof keys === 'number') {
                            return await (ioClient as any).eval(script, keys, ...(Array.isArray(args) ? args : [args]));
                        }
                        return await ioClient!.eval(script, 0);
                    } catch (e: any) {
                        logger.warn('[Redis Native eval Error]:', e?.message || e);
                        throw e;
                    }
                };
            }

            if (prop === 'evalsha') {
                return async (sha1: string, keys: any = [], args: any = []) => {
                    try {
                        if (Array.isArray(keys)) {
                            const flatArgs = [...keys, ...(Array.isArray(args) ? args : [])];
                            return await ioClient!.evalsha(sha1, keys.length, ...flatArgs);
                        } else if (typeof keys === 'number') {
                            return await (ioClient as any).evalsha(sha1, keys, ...(Array.isArray(args) ? args : [args]));
                        }
                        return await ioClient!.evalsha(sha1, 0);
                    } catch (e: any) {
                        if (e?.message && e.message.includes('NOSCRIPT')) {
                            throw e;
                        }
                        logger.warn('[Redis Native evalsha Error]:', e?.message || e);
                        throw e;
                    }
                };
            }

            if (prop === 'sadd') {
                return async (key: string, ...members: any[]) => {
                    try {
                        const flatMembers = members.flat();
                        if (flatMembers.length === 0) return 0;
                        return await ioClient!.sadd(key, ...flatMembers);
                    } catch (e) {
                        logger.warn('[Redis Native SADD Error]:', e);
                        return 0;
                    }
                };
            }

            if (prop === 'smembers') {
                return async (key: string) => {
                    try {
                        return await ioClient!.smembers(key);
                    } catch (e) {
                        logger.warn('[Redis Native SMEMBERS Error]:', e);
                        return [];
                    }
                };
            }

            if (prop === 'ping') {
                return async () => {
                    try {
                        return await ioClient!.ping();
                    } catch {
                        return 'PONG';
                    }
                };
            }

            return (...args: any[]) => {
                const method = (ioClient as any)[prop];
                if (typeof method === 'function') {
                    try {
                        const res = method.apply(ioClient, args);
                        if (res instanceof Promise) {
                            return res.catch((err: any) => {
                                logger.warn(`[Redis Native Call Error] "${String(prop)}":`, err?.message || err);
                                return null;
                            });
                        }
                        return res;
                    } catch (err: any) {
                        logger.warn(`[Redis Native Call Exception] "${String(prop)}":`, err?.message || err);
                        return null;
                    }
                }
                return (ioClient as any)[prop];
            };
        }

        // Upstash REST branch
        if (upstashClient) {
            const method = (upstashClient as any)[prop];
            if (typeof method === 'function') {
                return (...args: any[]) => {
                    try {
                        const res = method.apply(upstashClient, args);
                        if (res instanceof Promise) {
                            return res.catch((err: any) => {
                                logger.warn(`[Redis Upstash Error] "${String(prop)}":`, err?.message || err);
                                return null;
                            });
                        }
                        return res;
                    } catch (err: any) {
                        logger.warn(`[Redis Upstash Exception] "${String(prop)}":`, err?.message || err);
                        return null;
                    }
                };
            }
            return (upstashClient as any)[prop];
        }

        // Safe in-memory no-op fallbacks if Redis is completely unavailable
        return (..._args: any[]) => {
            if (prop === 'ping') return Promise.resolve('PONG');
            if (prop === 'eval' || prop === 'evalsha') return Promise.resolve([1, 100, Date.now() + 10000, 100]);
            if (prop === 'keys' || prop === 'smembers') return Promise.resolve([]);
            if (prop === 'scard' || prop === 'llen') return Promise.resolve(0);
            if (prop === 'hgetall') return Promise.resolve({});
            if (prop === 'pipeline') {
                const mock = {
                    incr: () => mock,
                    expire: () => mock,
                    sadd: () => mock,
                    set: () => mock,
                    exec: async () => []
                };
                return () => mock;
            }
            return Promise.resolve(null);
        };
    }
});
