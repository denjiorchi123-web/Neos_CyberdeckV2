import Redis from "ioredis";

/**
 * Redis client singleton for CyberDeck
 * Uses REDIS_URL from env, defaults to localhost:6379
 * Exports three instances:
 *   redis    — general commands (GET, SET, SADD, etc.)
 *   redisPub — dedicated publisher for Socket.io adapter
 *   redisSub — dedicated subscriber for Socket.io adapter
 */

const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";

const createRedisClient = (role?: string) => {
  const client = new Redis(REDIS_URL, {
    maxRetriesPerRequest: null,       // required by Socket.io adapter
    enableReadyCheck: false,
    retryStrategy(times) {
      const delay = Math.min(times * 200, 5000);
      console.log(`[Redis:${role ?? "cmd"}] reconnecting in ${delay}ms…`);
      return delay;
    },
    lazyConnect: false,
  });

  client.on("connect", () =>
    console.log(`[Redis:${role ?? "cmd"}] connected to ${REDIS_URL}`)
  );
  client.on("error", (err) =>
    console.error(`[Redis:${role ?? "cmd"}] error:`, err.message)
  );

  return client;
};

// Singleton pattern (avoid creating multiple clients in dev hot-reload)
declare global {
  var __redis: Redis | undefined;
  var __redisPub: Redis | undefined;
  var __redisSub: Redis | undefined;
}

export const redis = globalThis.__redis || createRedisClient("cmd");
export const redisPub = globalThis.__redisPub || createRedisClient("pub");
export const redisSub = globalThis.__redisSub || createRedisClient("sub");

if (process.env.NODE_ENV !== "production") {
  globalThis.__redis = redis;
  globalThis.__redisPub = redisPub;
  globalThis.__redisSub = redisSub;
}
