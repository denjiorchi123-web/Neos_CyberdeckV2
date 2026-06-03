import { PrismaClient } from "@prisma/client";
import { ensureTrustedPeerTables } from "@/lib/trusted-peers";

declare global {
  var prisma: PrismaClient | undefined;
  var _walEnabled: boolean | undefined;
}

import crypto from "crypto";
import os from "os";

function getMacAddress() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]!) {
      if (!net.internal && net.mac !== "00:00:00:00:00:00") {
        return net.mac.replace(/:/g, "");
      }
    }
  }
  return "unknown_mac";
}

const myMac = getMacAddress();
let localClockCache: Record<string, number> | null = null;

const withJournalExtension = (prisma: PrismaClient) => {
  return prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (model === "Journal" || model === "VectorClockState") {
            return query(args);
          }

          if (["create", "update", "delete", "upsert"].includes(operation)) {
            const result = await query(args);
            if (!result) return result;

            try {
              if (!localClockCache) {
                // Use a separate raw query to avoid recursion if we ever add Prisma logging
                const state = await prisma.vectorClockState.findUnique({ where: { id: "local" } });
                localClockCache = state ? JSON.parse(state.clock) : { [myMac]: 0 };
              }

              const currentCache = localClockCache!;
              if (!currentCache[myMac]) currentCache[myMac] = 0;
              currentCache[myMac]++;

              const clockStr = JSON.stringify(currentCache);

              await prisma.vectorClockState.upsert({
                where: { id: "local" },
                update: { clock: clockStr },
                create: { id: "local", clock: clockStr }
              });

              const payload = JSON.stringify(result);
              const hash = crypto.createHash("sha256").update(payload).digest("hex");

              await prisma.journal.create({
                data: {
                  rowTable: model,
                  rowId: (result as any).id || "unknown",
                  operation: operation.toUpperCase(),
                  payload: payload,
                  vectorClock: clockStr,
                  originMac: myMac,
                  contentHash: hash,
                }
              });
            } catch (err) {
              console.error("[JOURNAL ERROR]", err);
            }

            return result;
          }

          return query(args);
        }
      }
    }
  });
};

function createPrismaClient() {
  const baseClient = new PrismaClient();
  return withJournalExtension(baseClient) as unknown as PrismaClient;
}

function isStalePrismaClient(client: any): boolean {
  return !("archivedChat" in client) || !("pinnedChat" in client);
}

const cached = globalThis.prisma;
export const db =
  cached && !isStalePrismaClient(cached) ? cached : createPrismaClient();

if (process.env.NODE_ENV !== "production") globalThis.prisma = db as any;

// Enable SQLite WAL mode once per process — dramatically improves concurrent read
// throughput and prevents "database is locked" under many simultaneous HTTP requests.
// These PRAGMAs are connection-level so they must run on every new PrismaClient,
// but we guard with a flag to avoid re-running on hot-reload in dev.
if (!globalThis._walEnabled) {
  globalThis._walEnabled = true;
  (async () => {
    try {
      await db.$queryRawUnsafe("PRAGMA journal_mode=WAL");
      await db.$queryRawUnsafe("PRAGMA synchronous=NORMAL");    // safe with WAL
      await db.$queryRawUnsafe("PRAGMA busy_timeout=30000");    // wait 30s instead of failing instantly
      await db.$queryRawUnsafe("PRAGMA cache_size=-65536");     // 64 MB page cache
      await db.$queryRawUnsafe("PRAGMA temp_store=MEMORY");     // temp tables stay in RAM
      await db.$queryRawUnsafe("PRAGMA mmap_size=268435456");   // 256 MB memory-mapped I/O
      await db.$queryRawUnsafe("PRAGMA foreign_keys=ON");       // enforce relational integrity
      await ensureTrustedPeerTables(db as any);
      console.log("[DB] SQLite WAL mode enabled");
    } catch (e) {
      console.error("[DB] WAL setup failed:", e);
    }
  })();
}

export * from "./db-enums";
