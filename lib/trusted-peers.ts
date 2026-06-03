type SqliteExecutor = {
  $executeRawUnsafe: (query: string, ...values: unknown[]) => Promise<unknown>;
  $queryRawUnsafe: <T = unknown>(query: string, ...values: unknown[]) => Promise<T>;
};

export const VERIFIED_LAN_STATUS = "VERIFIED LAN";

export function normalizeSecurityStatus(value: unknown) {
  const status = typeof value === "string" ? value.trim() : "";
  return status ? status.slice(0, 64) : VERIFIED_LAN_STATUS;
}

export async function ensureTrustedPeerTables(db: SqliteExecutor) {
  await db.$queryRawUnsafe("PRAGMA journal_mode=WAL");
  await db.$queryRawUnsafe("PRAGMA busy_timeout=30000");
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS trusted_peers (
      mac_id TEXT PRIMARY KEY,
      host_address TEXT,
      security_status TEXT,
      paired_at INTEGER,
      is_active INTEGER DEFAULT 1
    )
  `);
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS rejected_peers (
      request_id TEXT PRIMARY KEY,
      mac_id TEXT,
      host_address TEXT,
      security_status TEXT,
      action TEXT,
      rejected_at INTEGER
    )
  `);
}

export async function readConnectionRequestPayload(db: SqliteExecutor, requestId: string) {
  const rows = await db.$queryRawUnsafe<Array<{ payloadJson: string }>>(
    `
      SELECT payloadJson
      FROM MeshEvent
      WHERE entityType = 'connection_request'
        AND entityId = ?
        AND operation = 'handshake_request_received'
      ORDER BY timestamp DESC
      LIMIT 1
    `,
    requestId,
  );

  if (!rows?.[0]?.payloadJson) return null;

  try {
    return JSON.parse(rows[0].payloadJson) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function writeTrustedPeer(
  db: SqliteExecutor,
  input: {
    macId: string;
    hostAddress: string | null;
    securityStatus: string;
    pairedAt?: number;
  },
) {
  const pairedAt = input.pairedAt ?? Math.floor(Date.now() / 1000);

  await db.$executeRawUnsafe(
    `
      INSERT OR REPLACE INTO trusted_peers
        (mac_id, host_address, security_status, paired_at, is_active)
      VALUES (?, ?, ?, ?, 1)
    `,
    input.macId,
    input.hostAddress,
    input.securityStatus,
    pairedAt,
  );

  const rows = await db.$queryRawUnsafe<Array<{ mac_id: string }>>(
    "SELECT mac_id FROM trusted_peers WHERE mac_id = ? AND is_active = 1 LIMIT 1",
    input.macId,
  );

  if (!rows?.length) {
    throw new Error("Failed to persist trusted peer");
  }

  return { macId: input.macId, pairedAt };
}

export async function logRejectedPeer(
  db: SqliteExecutor,
  input: {
    requestId: string;
    macId: string;
    hostAddress: string | null;
    securityStatus: string;
    action: string;
    rejectedAt?: number;
  },
) {
  await db.$executeRawUnsafe(
    `
      INSERT OR REPLACE INTO rejected_peers
        (request_id, mac_id, host_address, security_status, action, rejected_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    input.requestId,
    input.macId,
    input.hostAddress,
    input.securityStatus,
    input.action,
    input.rejectedAt ?? Math.floor(Date.now() / 1000),
  );
}
