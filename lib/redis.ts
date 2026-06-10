import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";

// Don't connect during next build / static export
const IS_BUILD = process.env.NEXT_PHASE === "phase-production-build" ||
  process.env.NEXT_PHASE === "phase-export";

const createRedisClient = (role?: string) => {
  if (IS_BUILD) {
    // Return a stub that silently no-ops — routes using redis won't be
    // statically exported anyway (they're all dynamic API routes)
    return new Proxy({} as Redis, { get: () => () => Promise.resolve(null) });
  }

  const client = new Redis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: false,
    enableOfflineQueue: false,
    retryStrategy(times) {
      const delay = Math.min(times * 200, 5000);
      console.log(`[Redis:${role ?? "cmd"}] reconnecting in ${delay}ms…`);
      return delay;
    },
  });

  client.on("connect", () =>
    console.log(`[Redis:${role ?? "cmd"}] connected to ${REDIS_URL}`)
  );
  client.on("error", (err) =>
    console.error(`[Redis:${role ?? "cmd"}] error:`, err.message)
  );

  return client;
};

declare global {
  var __redis: Redis | undefined;
  var __redisPub: Redis | undefined;
  var __redisSub: Redis | undefined;
}

export const redis    = globalThis.__redis    ?? createRedisClient("cmd");
export const redisPub = globalThis.__redisPub ?? createRedisClient("pub");
export const redisSub = globalThis.__redisSub ?? createRedisClient("sub");

if (process.env.NODE_ENV !== "production") {
  globalThis.__redis    = redis;
  globalThis.__redisPub = redisPub;
  globalThis.__redisSub = redisSub;
}
