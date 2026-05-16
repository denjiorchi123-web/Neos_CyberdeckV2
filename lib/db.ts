import { PrismaClient } from "@prisma/client";

declare global {
  var prisma: PrismaClient | undefined;
  var _walEnabled: boolean | undefined;
}

export const db = globalThis.prisma || new PrismaClient();

if (process.env.NODE_ENV !== "production") globalThis.prisma = db;

// Enable SQLite WAL mode once per process — dramatically improves concurrent read
// throughput and prevents "database is locked" under many simultaneous HTTP requests.
// These PRAGMAs are connection-level so they must run on every new PrismaClient,
// but we guard with a flag to avoid re-running on hot-reload in dev.
if (!globalThis._walEnabled) {
  globalThis._walEnabled = true;
  (async () => {
    try {
      await db.$executeRawUnsafe("PRAGMA journal_mode=WAL");
      await db.$executeRawUnsafe("PRAGMA synchronous=NORMAL");    // safe with WAL
      await db.$executeRawUnsafe("PRAGMA busy_timeout=30000");    // wait 30s instead of failing instantly
      await db.$executeRawUnsafe("PRAGMA cache_size=-65536");     // 64 MB page cache
      await db.$executeRawUnsafe("PRAGMA temp_store=MEMORY");     // temp tables stay in RAM
      await db.$executeRawUnsafe("PRAGMA mmap_size=268435456");   // 256 MB memory-mapped I/O
      await db.$executeRawUnsafe("PRAGMA foreign_keys=ON");       // enforce relational integrity
      console.log("[DB] SQLite WAL mode enabled");
    } catch (e) {
      console.error("[DB] WAL setup failed:", e);
    }
  })();
}

// Manual Enums for SQLite Compatibility
export const MemberRole = {
  ADMIN: "ADMIN",
  MODERATOR: "MODERATOR",
  GUEST: "GUEST",
} as const;

export const ChannelType = {
  TEXT: "TEXT",
  AUDIO: "AUDIO",
  VIDEO: "VIDEO",
} as const;

export type MemberRole = (typeof MemberRole)[keyof typeof MemberRole];
export type ChannelType = (typeof ChannelType)[keyof typeof ChannelType];
