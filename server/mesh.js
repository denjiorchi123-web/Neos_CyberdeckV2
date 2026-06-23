const crypto = require("crypto");
const dgram = require("dgram");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const { PrismaClient } = require("@prisma/client");
const {
  broadcastFor,
  getBroadcastAddresses,
  getConfiguredFallbackIps,
  getDirectProbeAddresses,
  getLanInterfaces,
  getLocalIps: getAllLocalIps,
  getPreferredLanIp,
  getPreferredLanMac,
  isIpInInterfaceSubnet,
  isLocalIp,
  normalizeIp,
} = require("../lib/mesh-network");

const db = new PrismaClient();
let redisClient = null;

// ── WebSockets via Local IPC Bridge ───────────────────────────────────────────
const https = require("https");

async function emitToLocalSocket(channel, event, data) {
  return new Promise((resolve) => {
    const postData = JSON.stringify({ channel, event, data });
    const reqOpts = {
      hostname: "127.0.0.1",
      port: 3000,
      path: "/api/socket/internal-emit",
      method: "POST",
      rejectUnauthorized: false, // Next runs on self-signed HTTPS
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(postData),
      },
    };

    const req = https.request(reqOpts, (res) => {
      let responseBody = "";
      res.on("data", (chunk) => {
        responseBody += chunk;
      });
      res.on("end", () => {
        if (res.statusCode !== 200) {
          console.warn(`> [NodeMesh][SocketIPC] Failed to emit (status ${res.statusCode}): ${responseBody}`);
        }
        resolve();
      });
    });

    req.on("error", (err) => {
      console.warn(`> [NodeMesh][SocketIPC] Network error emitting to local socket: ${err.message}`);
      resolve();
    });

    req.write(postData);
    req.end();
  });
}

try {
  const Redis = require("ioredis");
  redisClient = new Redis(process.env.REDIS_URL || "redis://127.0.0.1:6379");
} catch {}
const BEACON_PORT = Number(process.env.MESH_BEACON_PORT || 5005);
const CONTROL_PORT = Number(process.env.MESH_CONTROL_PORT || 5006);
function loadMeshSecret() {
  if (process.env.MESH_SECRET?.trim()) return process.env.MESH_SECRET.trim();
  const secretFile = process.env.MESH_SECRET_FILE || path.join(process.cwd(), "private", "mesh-secret.key");
  try {
    const secret = fs.readFileSync(secretFile, "utf8").trim();
    if (secret.length >= 32) return secret;
  } catch {}
  return "GHOSTWIRE_ALPHA_7";
}

const SECRET = loadMeshSecret();
if (SECRET === "GHOSTWIRE_ALPHA_7") {
  console.error("> [NodeMesh][AUTH] WARNING: using built-in default MESH_SECRET; set private/mesh-secret.key on both devices");
}
const CONTROL_ENCRYPTION = process.env.MESH_CONTROL_ENCRYPTION !== "0";
const MESH_MULTICAST_ADDR = process.env.MESH_MULTICAST_ADDR || "239.255.77.77";
const MESH_SESSION_FILE = process.env.MESH_SESSION_FILE || path.join(process.cwd(), "private", "mesh-session.json");
const MAX_CLOCK_SKEW_MS = Number(process.env.MESH_MAX_CLOCK_SKEW_MS || 3650 * 24 * 60 * 60 * 1000);
const MAX_HELLO_CLOCK_SKEW_MS = Number(
  process.env.MESH_HELLO_MAX_CLOCK_SKEW_MS || process.env.MESH_DISCOVERY_MAX_CLOCK_SKEW_MS || 3650 * 24 * 60 * 60 * 1000,
);
const MAX_PACKET_BYTES = Number(process.env.MESH_MAX_PACKET_BYTES || 1024 * 1024);
const MEDIA_CHUNK_BYTES = Number(process.env.MESH_MEDIA_CHUNK_BYTES || 96 * 1024);
const CONTROL_TIMEOUT_MS = Number(process.env.MESH_CONTROL_TIMEOUT_MS || 30 * 1000);
const OUTBOX_SYNC_INTERVAL_MS = Number(process.env.MESH_OUTBOX_SYNC_INTERVAL_MS || 2 * 1000);
const MEDIA_REPAIR_INTERVAL_MS = Number(process.env.MESH_MEDIA_REPAIR_INTERVAL_MS || 60 * 1000);
const AUTH_FAIL_WINDOW_MS = 60 * 1000;
const AUTH_FAIL_LIMIT = 5;
const AUTH_RATE_LIMIT_MS = 10 * 60 * 1000;
const TRUSTED_STATUSES = new Set(["TRUSTED", "ACCEPTED", "VERIFIED LAN"]);
const MANUAL_PEER_PREFIX = "manual-ip:";
const authFailures = new Map();
const learnedPeerIps = new Map();
const beaconSendSockets = new Map();
const multicastMemberships = new Set();
let outboxSyncRunning = false;
let lastOutboxSyncAt = 0;
const lastMediaRepairAtByPeer = new Map();
// In-memory buffer for out-of-order media chunks: transferKey -> { chunks: Map<index, Buffer>, totalChunks, meta }
const pendingMediaChunks = new Map();
const MEDIA_CHUNK_BUFFER_TIMEOUT_MS = 60 * 1000; // evict stale transfers after 60s
const VERIFIED_LAN_STATUS = "VERIFIED LAN";
const PRIVATE_ROOT = path.join(process.cwd(), "private");
const CYBERDECK_MEDIA_ROOT = process.env.CYBERDECK_MEDIA_ROOT || path.join(os.homedir(), "LAN_Chat_Media");
const LEGACY_CYBERDECK_MEDIA_ROOT = path.join(PRIVATE_ROOT, "CyberDeck", "Media");
const MEDIA_DIRS = {
  uploads: path.join(PRIVATE_ROOT, "uploads"),
  photos: path.join(CYBERDECK_MEDIA_ROOT, "Images"),
  videos: path.join(CYBERDECK_MEDIA_ROOT, "Videos"),
  audio: path.join(CYBERDECK_MEDIA_ROOT, "Audio"),
  documents: path.join(CYBERDECK_MEDIA_ROOT, "Documents"),
};
const LEGACY_MEDIA_DIRS = {
  photos: path.join(LEGACY_CYBERDECK_MEDIA_ROOT, "CyberDeck Images"),
  videos: path.join(LEGACY_CYBERDECK_MEDIA_ROOT, "CyberDeck Video"),
  audio: path.join(LEGACY_CYBERDECK_MEDIA_ROOT, "CyberDeck Audio"),
  documents: path.join(LEGACY_CYBERDECK_MEDIA_ROOT, "CyberDeck Documents"),
};

let sqliteRuntimeReady = null;

function normalizeSecurityStatus(value) {
  const status = typeof value === "string" ? value.trim() : "";
  return status ? status.slice(0, 64) : VERIFIED_LAN_STATUS;
}

function ensureSqliteRuntime() {
  if (!sqliteRuntimeReady) {
    sqliteRuntimeReady = (async () => {
      await db.$queryRawUnsafe("PRAGMA journal_mode=WAL");
      await db.$queryRawUnsafe("PRAGMA synchronous=FULL");
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
    })();
  }
  return sqliteRuntimeReady;
}

async function writeTrustedPeer(tx, { macId, hostAddress, securityStatus }) {
  const pairedAt = Math.floor(Date.now() / 1000);
  await tx.$executeRawUnsafe(
    `
      INSERT OR REPLACE INTO trusted_peers
        (mac_id, host_address, security_status, paired_at, is_active)
      VALUES (?, ?, ?, ?, 1)
    `,
    macId,
    hostAddress,
    securityStatus,
    pairedAt,
  );
  const rows = await tx.$queryRawUnsafe(
    "SELECT mac_id FROM trusted_peers WHERE mac_id = ? AND is_active = 1 LIMIT 1",
    macId,
  );
  if (!rows?.length) throw new Error("Failed to persist trusted peer");
}

async function logRejectedPeer(tx, { requestId, macId, hostAddress, securityStatus, action }) {
  await tx.$executeRawUnsafe(
    `
      INSERT OR REPLACE INTO rejected_peers
        (request_id, mac_id, host_address, security_status, action, rejected_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    requestId,
    macId,
    hostAddress,
    securityStatus,
    action,
    Math.floor(Date.now() / 1000),
  );
}

ensureSqliteRuntime().catch((error) => {
  console.error("> [NodeMesh][DB] SQLite WAL/trusted peer setup failed:", error.message);
});

function getMac() {
  return getPreferredLanMac() || `node-${getIp().replace(/\W/g, "").toLowerCase()}`;
}

function getIp() {
  return getPreferredLanIp();
}

function getLocalIps() {
  return getAllLocalIps();
}

function getMeshSession() {
  try {
    const session = JSON.parse(fs.readFileSync(MESH_SESSION_FILE, "utf8"));
    const username = typeof session.username === "string" ? session.username.trim() : "";
    const profileId = typeof session.profileId === "string" ? session.profileId.trim() : "";
    if (!username || !profileId) return null;
    if (/^node[-_]/i.test(username)) return null;
    return {
      profileId,
      userId: session.userId || profileId,
      username,
      displayName: session.displayName || username,
      avatarSeed: session.avatarSeed || profileId,
      deviceMac: session.deviceMac || "",
      deviceName: session.deviceName || os.hostname(),
    };
  } catch {
    return null;
  }
}

function sign(payload) {
  const body = JSON.stringify({ ...payload, timestamp: Date.now() });
  if (CONTROL_ENCRYPTION && payload?.type !== "HELLO") {
    const iv = crypto.randomBytes(12);
    const key = crypto.createHash("sha256").update(`cyberdeck-control:${SECRET}`).digest();
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(body, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    const signed = `${iv.toString("base64")}:${ciphertext.toString("base64")}:${tag.toString("base64")}`;
    return {
      enc: "aes-256-gcm",
      iv: iv.toString("base64"),
      ciphertext: ciphertext.toString("base64"),
      tag: tag.toString("base64"),
      sig: crypto.createHmac("sha256", SECRET).update(signed).digest("hex"),
    };
  }

  return { payload: body, sig: crypto.createHmac("sha256", SECRET).update(body).digest("hex") };
}

function logMeshEvent(operation, payload, receivedFrom) {
  db.meshEvent.create({
    data: {
      originNodeId: receivedFrom || "unknown",
      entityType: "mesh_auth",
      entityId: crypto.randomUUID(),
      operation,
      payloadJson: JSON.stringify(payload),
      receivedFrom,
      signature: payload?.sig ? String(payload.sig).slice(0, 128) : undefined,
    },
  }).catch(() => {});
}

function trackAuthFail(sourceIp, reason, packet, tsDelta) {
  const key = normalizeIp(sourceIp || "unknown");
  const now = Date.now();
  const current = authFailures.get(key) || { count: 0, windowStart: now, blockedUntil: 0 };
  if (current.blockedUntil > now) return true;

  const next = now - current.windowStart > AUTH_FAIL_WINDOW_MS
    ? { count: 1, windowStart: now, blockedUntil: 0 }
    : { ...current, count: current.count + 1 };

  if (next.count >= AUTH_FAIL_LIMIT) {
    next.blockedUntil = now + AUTH_RATE_LIMIT_MS;
    console.error(`> [NodeMesh][AUTH] Rate-limited ${key} for repeated auth failures`);
  }
  authFailures.set(key, next);
  logMeshEvent("AUTH_FAIL", {
    reason,
    sourceIp: key,
    badSig: packet?.sig ? String(packet.sig).slice(0, 128) : null,
    tsDelta,
  }, key);
  return next.blockedUntil > now;
}

function isAuthRateLimited(sourceIp) {
  const current = authFailures.get(normalizeIp(sourceIp || "unknown"));
  return current?.blockedUntil && current.blockedUntil > Date.now();
}

function clearAuthFail(sourceIp) {
  authFailures.delete(normalizeIp(sourceIp || "unknown"));
}

function verify(packet, sourceIp) {
  if (!packet || typeof packet.sig !== "string") {
    trackAuthFail(sourceIp, "malformed_packet", packet, null);
    return null;
  }

  let body;
  if (packet.enc === "aes-256-gcm") {
    if (typeof packet.iv !== "string" || typeof packet.ciphertext !== "string" || typeof packet.tag !== "string") {
      trackAuthFail(sourceIp, "malformed_encrypted_packet", packet, null);
      return null;
    }
    const signed = `${packet.iv}:${packet.ciphertext}:${packet.tag}`;
    const expected = crypto.createHmac("sha256", SECRET).update(signed).digest("hex");
    if (packet.sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(packet.sig), Buffer.from(expected))) {
      trackAuthFail(sourceIp, "bad_hmac", packet, null);
      return null;
    }
    try {
      const key = crypto.createHash("sha256").update(`cyberdeck-control:${SECRET}`).digest();
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(packet.iv, "base64"));
      decipher.setAuthTag(Buffer.from(packet.tag, "base64"));
      body = Buffer.concat([
        decipher.update(Buffer.from(packet.ciphertext, "base64")),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      logMeshEvent("AUTH_FAIL", { reason: "decrypt_failed", sourceIp: normalizeIp(sourceIp || "unknown") }, sourceIp);
      return null;
    }
  } else if (typeof packet.payload === "string") {
    body = packet.payload;
    const expected = crypto.createHmac("sha256", SECRET).update(body).digest("hex");
    if (packet.sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(packet.sig), Buffer.from(expected))) {
      trackAuthFail(sourceIp, "bad_hmac", packet, null);
      return null;
    }
  } else {
    trackAuthFail(sourceIp, "malformed_packet", packet, null);
    return null;
  }

  let data;
  try {
    data = JSON.parse(body);
  } catch {
    logMeshEvent("AUTH_FAIL", { reason: "bad_payload_json_authenticated", sourceIp: normalizeIp(sourceIp || "unknown") }, sourceIp);
    return null;
  }
  const skewMs = Number.isFinite(data.timestamp) ? Math.abs(Date.now() - data.timestamp) : Number.POSITIVE_INFINITY;
  const allowedSkewMs = data.type === "HELLO" ? MAX_HELLO_CLOCK_SKEW_MS : MAX_CLOCK_SKEW_MS;
  if (!Number.isFinite(data.timestamp) || skewMs > allowedSkewMs) {
    const skewSeconds = Number.isFinite(skewMs) ? Math.round(skewMs / 1000) : "missing";
    console.error(
      `> [NodeMesh][AUTH] Rejected signed ${data.type || "packet"}: clock skew ${skewSeconds}s exceeds ${Math.round(allowedSkewMs / 1000)}s`,
    );
    logMeshEvent("AUTH_CLOCK_SKEW", {
      sourceIp: normalizeIp(sourceIp || "unknown"),
      packetType: data.type || "unknown",
      skewSeconds,
      allowedSkewSeconds: Math.round(allowedSkewMs / 1000),
    }, sourceIp);
    return null;
  }
  clearAuthFail(sourceIp);
  return data;
}

async function sendControl(ip, payload) {
  const packet = JSON.stringify(sign(payload)) + "\n";

  await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: normalizeIp(ip), port: CONTROL_PORT });
    let response = "";
    let settled = false;

    const settle = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve();
    };

    const timeout = setTimeout(() => {
      const error = new Error(`Mesh control timeout to ${normalizeIp(ip)}:${CONTROL_PORT}`);
      error.code = "ETIMEDOUT";
      settle(error);
      socket.destroy();
    }, CONTROL_TIMEOUT_MS);

    socket.setNoDelay(true);
    socket.once("connect", () => socket.end(packet));
    socket.on("data", (chunk) => {
      if (response.length < 4096) response += chunk.toString("utf8");
    });
    socket.once("end", () => {
      const reply = response.trim();
      if (reply.startsWith("ERR")) {
        const error = new Error(reply.slice(3).trim() || "Mesh peer rejected the control packet");
        error.code = "EREMOTE";
        settle(error);
      } else {
        settle();
      }
    });
    socket.once("error", settle);
    socket.once("close", (hadError) => {
      if (!settled && hadError) {
        const error = new Error(`Mesh control socket to ${normalizeIp(ip)}:${CONTROL_PORT} closed with error`);
        error.code = "ECONNRESET";
        settle(error);
      } else if (!settled) {
        // Compatibility with older peers that close without an explicit reply.
        settle();
      }
    });
  });
}

async function recordEvent(originNodeId, entityId, operation, payload, receivedFrom) {
  await db.meshEvent.create({
    data: {
      originNodeId,
      entityType: "connection_request",
      entityId,
      operation,
      payloadJson: JSON.stringify(payload),
      receivedFrom,
    },
  });
}

function displayNameFor(username, deviceName, macAddress, hasCollision) {
  if (!hasCollision) return username;
  return `${username} (${deviceName || String(macAddress).slice(-6)})`;
}

async function isBlockedMac(macAddress) {
  if (!macAddress) return false;
  const blocked = await db.meshBlocklist.findUnique({ where: { macAddress } });
  return Boolean(blocked);
}

async function logBlockedPeer(macAddress, username, ipAddress) {
  logMeshEvent("BLOCKED", { macAddress, username, ipAddress }, ipAddress || macAddress);
}

async function logImpersonationAttempt({ userId, username, macAddress, ipAddress, trustedPeer }) {
  logMeshEvent("IMPERSONATION_ATTEMPT", {
    claimedUserId: userId,
    claimedUsername: username,
    claimedMac: macAddress,
    claimedIp: ipAddress,
    trustedUserId: trustedPeer?.userId,
    trustedMac: trustedPeer?.macAddress,
  }, ipAddress || macAddress);
  console.error(`> [NodeMesh][AUTH] Rejected impersonation attempt for ${username} from ${ipAddress}`);
}

async function upsertPeerIdentity({ userId, username, macAddress, deviceName, ipAddress, status, displayName }) {
  return db.meshPeer.upsert({
    where: { macAddress },
    create: {
      macAddress,
      userId,
      hostname: deviceName || null,
      publicName: username,
      displayName: displayName || username,
      ipAddress,
      status,
      lastHandshake: status === "PENDING_INCOMING" ? new Date() : undefined,
    },
    update: {
      userId,
      hostname: deviceName || undefined,
      publicName: username,
      displayName: displayName || username,
      ipAddress,
      lastSeen: new Date(),
      status,
      lastHandshake: status === "PENDING_INCOMING" ? new Date() : undefined,
    },
  });
}

function cleanContactName(username) {
  const name = typeof username === "string" ? username.trim() : "";
  if (!name) throw new Error("Cannot create a contact without a verified username");
  return name.slice(0, 80);
}

function contactUserId(userId, macAddress) {
  const trimmed = typeof userId === "string" ? userId.trim() : "";
  return trimmed || `mesh_${String(macAddress || "unknown").replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

function contactEmail(userId) {
  return `${String(userId).replace(/[^A-Za-z0-9._-]/g, "_").toLowerCase()}@mesh.local`;
}

const LEGACY_CHAT_SERVER_CODE = "cyberdeck-default";
const PERSONAL_CHAT_SERVER_PREFIX = "cyberdeck-dm-";

async function ensureProfileChatServer(localProfileId) {
  const localProfile = await db.profile.findUnique({
    where: { id: localProfileId },
    select: { id: true, userId: true, name: true },
  });
  if (!localProfile) throw new Error("Local profile does not exist");

  let server = await db.server.findFirst({
    where: {
      profileId: localProfileId,
      OR: [
        { inviteCode: LEGACY_CHAT_SERVER_CODE },
        { inviteCode: { startsWith: PERSONAL_CHAT_SERVER_PREFIX } },
      ],
    },
    orderBy: { createdAt: "asc" },
  });

  if (!server) {
    server = await db.server.create({
      data: {
        name: `${localProfile.name}'s Chats`,
        imageUrl: "",
        inviteCode: `${PERSONAL_CHAT_SERVER_PREFIX}${localProfileId}`,
        profileId: localProfileId,
        members: {
          create: { profileId: localProfileId, role: "ADMIN" },
        },
      },
    });
  } else {
    const member = await db.member.findFirst({
      where: { profileId: localProfileId, serverId: server.id },
      select: { id: true },
    });
    if (!member) {
      await db.member.create({
        data: { profileId: localProfileId, serverId: server.id, role: "ADMIN" },
      });
    }
  }

  if (server.inviteCode !== LEGACY_CHAT_SERVER_CODE) {
    const legacyServer = await db.server.findFirst({
      where: {
        inviteCode: LEGACY_CHAT_SERVER_CODE,
        profileId: { not: localProfileId },
      },
      select: { id: true },
    });
    if (legacyServer) {
      const legacyMember = await db.member.findFirst({
        where: {
          profileId: localProfileId,
          serverId: legacyServer.id,
          role: "GUEST",
        },
        select: {
          id: true,
          _count: {
            select: {
              messages: true,
              directMessages: true,
              conversationsInitiated: true,
              conversationsReceived: true,
            },
          },
        },
      });
      const count = legacyMember?._count;
      const isUnusedAutomaticMembership = count &&
        count.messages === 0 &&
        count.directMessages === 0 &&
        count.conversationsInitiated === 0 &&
        count.conversationsReceived === 0;
      const isUserCreatedProfile = /^user_[a-f0-9]{20}$/i.test(localProfile.userId);
      if (legacyMember && (isUserCreatedProfile || isUnusedAutomaticMembership)) {
        await db.member.delete({ where: { id: legacyMember.id } });
      }
    }
  }

  return server;
}

async function isPeerAcceptedForProfile(localProfileId, { userId, username, macAddress }) {
  if (!localProfileId) return false;
  const server = await ensureProfileChatServer(localProfileId);
  const resolvedUserId = contactUserId(userId, macAddress);
  const cleanUsername = typeof username === "string" ? username.trim() : "";
  const member = await db.member.findFirst({
    where: {
      serverId: server.id,
      profileId: { not: localProfileId },
      profile: {
        OR: [
          { userId: resolvedUserId },
          ...(cleanUsername ? [{ name: cleanUsername }] : []),
        ],
      },
    },
    select: { id: true },
  });
  return Boolean(member);
}

async function findReusableContactProfile(userId, username) {
  const exact = await db.profile.findUnique({ where: { userId } });
  if (exact) return exact;

  const sameName = await db.$queryRawUnsafe(
    `SELECT * FROM Profile
     WHERE lower(trim(name)) = lower(trim(?))
     ORDER BY
       CASE WHEN email LIKE '%@mesh.local' THEN 1 ELSE 0 END ASC,
       createdAt ASC`,
    username
  );
  if (!sameName.length) return null;

  return sameName.find((profile) => !String(profile.email || "").endsWith("@mesh.local")) || sameName[0];
}

async function ensureAcceptedMeshContact({ localProfileId, userId, username, macAddress, deviceName }) {
  const name = cleanContactName(username);
  const resolvedUserId = contactUserId(userId, macAddress);
  const defaultServer = await ensureProfileChatServer(localProfileId);

  let profile = await findReusableContactProfile(resolvedUserId, name);
  if (!profile) {
    profile = await db.profile.create({
      data: {
        userId: resolvedUserId,
        name,
        imageUrl: "",
        email: contactEmail(resolvedUserId),
        password: "",
        isOnline: new Date(),
      },
    });
  } else {
    profile = await db.profile.update({
      where: { id: profile.id },
      data: {
        name,
        isOnline: new Date(),
        lastSeen: new Date(),
      },
    });
  }

  let member = await db.member.findFirst({
    where: {
      profileId: profile.id,
      serverId: defaultServer.id,
    },
  });
  if (!member) {
    member = await db.member.create({
      data: {
        profileId: profile.id,
        serverId: defaultServer.id,
        role: "GUEST",
      },
    });
  }

  await db.meshPeer.update({
    where: { macAddress },
    data: {
      userId: resolvedUserId,
      publicName: name,
      displayName: name,
      hostname: deviceName || undefined,
      status: "TRUSTED",
      lastHandshake: new Date(),
    },
  }).catch(() => null);

  return { profile, member, defaultServer };
}

async function ensureDirectConversationForAcceptedPeer(localProfileId, remoteMemberId, serverId) {
  const localMember = await db.member.findFirst({
    where: { profileId: localProfileId, serverId },
  });
  if (!localMember) throw new Error("Local profile is not joined to the default chat server");

  let conversation = await db.conversation.findFirst({
    where: {
      OR: [
        { memberOneId: localMember.id, memberTwoId: remoteMemberId },
        { memberOneId: remoteMemberId, memberTwoId: localMember.id },
      ],
    },
  });
  if (!conversation) {
    conversation = await db.conversation.create({
      data: {
        memberOneId: localMember.id,
        memberTwoId: remoteMemberId,
      },
    });
  }
  return conversation;
}

async function findDirectConversationByNames(firstName, secondName) {
  const session = getMeshSession();
  if (!session?.profileId) return null;
  const server = await ensureProfileChatServer(session.profileId);
  if (!server) return null;

  const profiles = await db.profile.findMany({
    where: { name: { in: [firstName, secondName] } },
  });
  const firstProfile = profiles.find((profile) => profile.name === firstName);
  const secondProfile = profiles.find((profile) => profile.name === secondName);
  if (!firstProfile || !secondProfile) return null;

  const members = await db.member.findMany({
    where: {
      serverId: server.id,
      profileId: { in: [firstProfile.id, secondProfile.id] },
    },
    include: { profile: true },
  });
  const firstMember = members.find((member) => member.profileId === firstProfile.id);
  const secondMember = members.find((member) => member.profileId === secondProfile.id);
  if (!firstMember || !secondMember) return null;

  let conversation = await db.conversation.findFirst({
    where: {
      OR: [
        { memberOneId: firstMember.id, memberTwoId: secondMember.id },
        { memberOneId: secondMember.id, memberTwoId: firstMember.id },
      ],
    },
  });

  if (!conversation) {
    conversation = await db.conversation.create({
      data: {
        memberOneId: firstMember.id,
        memberTwoId: secondMember.id,
      },
    });
  }

  return { conversation, firstMember, secondMember };
}

function directMessagePayload(message, fromUsername, toUsername) {
  return {
    id: message.id,
    content: message.content,
    type: message.type,
    fileUrl: message.fileUrl,
    fileName: message.fileName,
    fileSize: message.fileSize,
    mimeType: message.mimeType,
    thumbnailUrl: message.thumbnailUrl,
    mediaKey: message.mediaKey,
    createdAt: message.createdAt instanceof Date ? message.createdAt.toISOString() : message.createdAt,
    fromUsername,
    toUsername,
  };
}

function uploadInfoForUrl(fileUrl) {
  if (typeof fileUrl !== "string" || !fileUrl.startsWith("/api/files/")) return null;
  const filename = path.basename(fileUrl);
  if (!filename || filename.includes("..")) return null;
  return {
    filename,
    path: resolveStoredFilePath(filename),
  };
}

async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  await new Promise((resolve, reject) => {
    fs.createReadStream(filePath)
      .on("data", (chunk) => hash.update(chunk))
      .once("error", reject)
      .once("end", resolve);
  });
  return hash.digest("hex");
}

function sha256Buffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function readFileSlice(filePath, start, length) {
  const handle = await fs.promises.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

// Retry wrapper for Windows EPERM / EBUSY file locking issues
async function writeFileWithRetry(filePath, data, flags = "w", maxRetries = 5) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await fs.promises.writeFile(filePath, data, { flag: flags });
      return;
    } catch (err) {
      if ((err.code === "EPERM" || err.code === "EBUSY" || err.code === "EACCES") && attempt < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, 100 * (attempt + 1)));
      } else {
        throw err;
      }
    }
  }
}

async function appendFileWithRetry(filePath, data, maxRetries = 5) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await fs.promises.appendFile(filePath, data);
      return;
    } catch (err) {
      if ((err.code === "EPERM" || err.code === "EBUSY" || err.code === "EACCES") && attempt < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, 100 * (attempt + 1)));
      } else {
        throw err;
      }
    }
  }
}

function categoryFromMime(mimeType = "") {
  if (mimeType.startsWith("image/")) return "photos";
  if (mimeType.startsWith("video/")) return "videos";
  if (mimeType.startsWith("audio/")) return "audio";
  return "documents";
}

function resolveStoredFilePath(filename) {
  const candidates = [
    path.join(MEDIA_DIRS.photos, filename),
    path.join(MEDIA_DIRS.videos, filename),
    path.join(MEDIA_DIRS.audio, filename),
    path.join(MEDIA_DIRS.documents, filename),
    path.join(LEGACY_MEDIA_DIRS.photos, filename),
    path.join(LEGACY_MEDIA_DIRS.videos, filename),
    path.join(LEGACY_MEDIA_DIRS.audio, filename),
    path.join(LEGACY_MEDIA_DIRS.documents, filename),
    path.join(MEDIA_DIRS.uploads, filename),
  ];
  const direct = candidates.find((candidate) => fs.existsSync(candidate));
  if (direct) return direct;

  for (const dir of [
    MEDIA_DIRS.photos,
    MEDIA_DIRS.videos,
    MEDIA_DIRS.audio,
    MEDIA_DIRS.documents,
    LEGACY_MEDIA_DIRS.photos,
    LEGACY_MEDIA_DIRS.videos,
    LEGACY_MEDIA_DIRS.audio,
    LEGACY_MEDIA_DIRS.documents,
  ]) {
    const nested = findNestedFile(dir, filename);
    if (nested) return nested;
  }

  return candidates[0];
}

function findNestedFile(dir, filename, depth = 2) {
  if (depth < 0 || !fs.existsSync(dir)) return null;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isFile() && entry.name === filename) return fullPath;
    if (entry.isDirectory()) {
      const found = findNestedFile(fullPath, filename, depth - 1);
      if (found) return found;
    }
  }
  return null;
}

function safeStorageSegment(value) {
  const segment = String(value || "")
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, " ")
    .slice(0, 64);
  return segment || "Unknown";
}

function storageDirForMime(mimeType = "", ownerName = "") {
  const base = MEDIA_DIRS[categoryFromMime(mimeType)] || MEDIA_DIRS.documents;
  return ownerName ? path.join(base, safeStorageSegment(ownerName)) : base;
}

async function sendMediaFile(ipAddress, context, fileUrl, options = {}) {
  const local = uploadInfoForUrl(fileUrl);
  if (!local || !fs.existsSync(local.path)) return;

  const info = await fs.promises.stat(local.path);
  const totalChunks = Math.max(1, Math.ceil(info.size / MEDIA_CHUNK_BYTES));
  const fileSha256 = await sha256File(local.path);
  if (info.size === 0) {
    await sendControl(ipAddress, {
      type: "direct_media_chunk",
      ...context,
      fileUrl,
      storageName: local.filename,
      fileName: options.fileName || local.filename,
      mimeType: options.mimeType || "application/octet-stream",
      isThumbnail: Boolean(options.isThumbnail),
      chunkIndex: 0,
      totalChunks,
      totalSize: 0,
      fileSha256,
      chunkSha256: sha256Buffer(Buffer.alloc(0)),
      dataBase64: "",
    });
    return;
  }

  let chunkIndex = 0;

  for await (const chunk of fs.createReadStream(local.path, { highWaterMark: MEDIA_CHUNK_BYTES })) {
    const buffer = Buffer.from(chunk);
    // Retry up to 3 times for transient connection errors
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await sendControl(ipAddress, {
          type: "direct_media_chunk",
          ...context,
          fileUrl,
          storageName: local.filename,
          fileName: options.fileName || local.filename,
          mimeType: options.mimeType || "application/octet-stream",
          isThumbnail: Boolean(options.isThumbnail),
          chunkIndex,
          totalChunks,
          totalSize: info.size,
          fileSha256,
          chunkSha256: sha256Buffer(buffer),
          dataBase64: buffer.toString("base64"),
        });
        break; // success
      } catch (err) {
        if (attempt < 2 && (err.code === "ECONNREFUSED" || err.code === "ETIMEDOUT" || err.message?.includes("timeout"))) {
          await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
        } else {
          throw err;
        }
      }
    }
    chunkIndex += 1;
    // Small inter-chunk delay to avoid overwhelming the receiver's TCP accept queue
    if (chunkIndex < totalChunks) {
      await new Promise((r) => setTimeout(r, 20));
    }
  }
}

async function sendMediaForMessage(peerIp, context, message) {
  await sendMediaFile(peerIp, context, message.fileUrl, {
    fileName: message.fileName,
    mimeType: message.mimeType,
  });
  await sendMediaFile(peerIp, context, message.thumbnailUrl, {
    fileName: message.fileName ? `Thumbnail for ${message.fileName}` : undefined,
    mimeType: "image/jpeg",
    isThumbnail: true,
  });
}

async function sendMediaOfferForMessage(peerIp, context, message) {
  const local = uploadInfoForUrl(message.fileUrl);
  if (!local || !fs.existsSync(local.path)) return;

  const info = await fs.promises.stat(local.path);
  await sendControl(peerIp, {
    type: "direct_media_offer",
    ...context,
    fileUrl: message.fileUrl,
    storageName: local.filename,
    fileName: message.fileName || local.filename,
    mimeType: message.mimeType || "application/octet-stream",
    totalSize: info.size,
    fileSha256: await sha256File(local.path),
  }).catch((error) => {
    console.error(`> [NodeMesh][MEDIA] Failed to offer media ${message.id}: ${error.message}`);
  });
}

async function upsertReceivedFileIndex({ storageName, fileName, mimeType, totalSize, fromUsername }) {
  const session = getMeshSession();
  let uploaderId = session?.profileId || "mesh";
  let serverId = "mesh";

  if (session && fromUsername) {
    const found = await findDirectConversationByNames(fromUsername, session.username);
    if (found) {
      serverId = found.firstMember.serverId;
    }
  }

  const existing = await db.fileIndex.findFirst({
    where: { path: storageName, uploaderId },
  });
  const data = {
    name: fileName || storageName,
    path: storageName,
    size: Number(totalSize) || 0,
    mimeType: mimeType || "application/octet-stream",
    uploaderId,
    serverId,
  };

  if (existing) {
    await db.fileIndex.update({ where: { id: existing.id }, data }).catch(() => {});
  } else {
    await db.fileIndex.create({ data }).catch(() => {});
  }
}

async function receiveDirectMediaChunk(data, peerIp) {
  const session = getMeshSession();
  if (!session) {
    console.error("> [NodeMesh][MEDIA] Rejected direct_media_chunk: no local session");
    return;
  }

  const fromNodeId = typeof data.fromNodeId === "string" ? data.fromNodeId.trim() : "";
  const fromUserId = typeof data.fromUserId === "string" ? data.fromUserId.trim() : "";
  const fromUsername = typeof data.fromUsername === "string" ? data.fromUsername.trim() : "";
  const toUsername = typeof data.toUsername === "string" ? data.toUsername.trim() : "";
  if (!fromUsername || toUsername !== session.username) {
    console.error("> [NodeMesh][MEDIA] Rejected direct_media_chunk: identity mismatch");
    return;
  }

  const trustedPeer = fromNodeId
    ? await db.meshPeer.findUnique({ where: { macAddress: fromNodeId } })
    : null;
  const acceptedForProfile = await isPeerAcceptedForProfile(session.profileId, {
    userId: fromUserId,
    username: fromUsername,
    macAddress: fromNodeId,
  });
  if (
    !trustedPeer ||
    !acceptedForProfile ||
    !TRUSTED_STATUSES.has(trustedPeer.status) ||
    trustedPeer.publicName !== fromUsername ||
    (fromUserId && trustedPeer.userId && trustedPeer.userId !== fromUserId)
  ) {
    console.error(`> [NodeMesh][MEDIA] Rejected direct_media_chunk from unaccepted peer ${fromUsername}`);
    return;
  }

  const storageName = path.basename(String(data.storageName || uploadInfoForUrl(data.fileUrl)?.filename || ""));
  if (!storageName || storageName.includes("..")) return;

  const chunkIndex = Number(data.chunkIndex);
  const totalChunks = Number(data.totalChunks);
  if (!Number.isInteger(chunkIndex) || !Number.isInteger(totalChunks) || chunkIndex < 0 || totalChunks <= 0) return;
  if (typeof data.dataBase64 !== "string") return;
  const advertisedChunkHash = typeof data.chunkSha256 === "string" ? data.chunkSha256 : "";
  const advertisedFileHash = typeof data.fileSha256 === "string" ? data.fileSha256 : "";

  const uploadDir = storageDirForMime(data.mimeType || "", fromUsername);
  fs.mkdirSync(uploadDir, { recursive: true });
  const finalPath = path.join(uploadDir, storageName);
  const tempPath = path.join(uploadDir, `.mesh-${data.messageId || "media"}-${storageName}.part`);
  const chunk = Buffer.from(data.dataBase64, "base64");
  const chunkHash = sha256Buffer(chunk);
  if (advertisedChunkHash && advertisedChunkHash !== chunkHash) {
    console.error(`> [NodeMesh][MEDIA] Rejected corrupt chunk ${chunkIndex} for ${storageName}`);
    return;
  }

  if (fs.existsSync(finalPath)) {
    if (advertisedFileHash) {
      const existingHash = await sha256File(finalPath).catch(() => "");
      if (existingHash !== advertisedFileHash) {
        await fs.promises.unlink(finalPath).catch(() => {});
      } else {
        return;
      }
    } else {
      return;
    }
  }

  // --- Out-of-order chunk buffering ---
  // Use a transfer key per (messageId, storageName) to buffer chunks arriving out of order.
  const transferKey = `${data.messageId || "media"}::${storageName}`;
  let transfer = pendingMediaChunks.get(transferKey);
  if (!transfer) {
    transfer = {
      chunks: new Map(),
      totalChunks,
      advertisedFileHash,
      tempPath,
      finalPath,
      uploadDir,
      storageName,
      fromUsername,
      data,
      createdAt: Date.now(),
    };
    pendingMediaChunks.set(transferKey, transfer);
  }

  // Evict stale transfers
  for (const [key, t] of pendingMediaChunks.entries()) {
    if (Date.now() - t.createdAt > MEDIA_CHUNK_BUFFER_TIMEOUT_MS) {
      pendingMediaChunks.delete(key);
      await fs.promises.unlink(t.tempPath).catch(() => {});
    }
  }

  // Store this chunk in the buffer (skip if already have it)
  if (!transfer.chunks.has(chunkIndex)) {
    transfer.chunks.set(chunkIndex, chunk);
  }

  // Flush contiguous chunks to disk starting from chunk 0
  // Determine current disk size of .part file
  let diskSize = 0;
  if (fs.existsSync(tempPath)) {
    diskSize = (await fs.promises.stat(tempPath).catch(() => ({ size: 0 }))).size;
  }
  // Find how many chunks are already written to disk
  let nextDiskChunk = diskSize > 0 ? Math.floor(diskSize / MEDIA_CHUNK_BYTES) : 0;
  // If chunk 0 missing from disk, reset
  if (diskSize === 0 && !transfer.chunks.has(0)) {
    // Can't write yet — waiting for chunk 0
    console.log(`> [NodeMesh][MEDIA] Buffered chunk ${chunkIndex}/${totalChunks - 1} for ${storageName} (waiting for chunk 0)`);
    return;
  }

  // Special case: chunk 0 reset (sender retried from beginning)
  if (chunkIndex === 0) {
    if (diskSize > 0) {
      // Check if existing chunk 0 matches
      const existingChunk0 = await readFileSlice(tempPath, 0, chunk.length).catch(() => Buffer.alloc(0));
      if (sha256Buffer(existingChunk0) !== chunkHash) {
        // Sender restarted with different data — wipe the partial file and buffered chunks
        await fs.promises.unlink(tempPath).catch(() => {});
        transfer.chunks.clear();
        transfer.chunks.set(0, chunk);
        diskSize = 0;
        nextDiskChunk = 0;
      } else {
        // chunk 0 already on disk and matches
        nextDiskChunk = Math.max(nextDiskChunk, 1);
      }
    }
  }

  // Flush buffered chunks to disk in order
  while (transfer.chunks.has(nextDiskChunk)) {
    const chunkToWrite = transfer.chunks.get(nextDiskChunk);
    transfer.chunks.delete(nextDiskChunk);
    if (nextDiskChunk === 0 && diskSize === 0) {
      await writeFileWithRetry(tempPath, chunkToWrite);
    } else if (nextDiskChunk * MEDIA_CHUNK_BYTES === diskSize || nextDiskChunk === 0) {
      await appendFileWithRetry(tempPath, chunkToWrite);
    }
    diskSize += chunkToWrite.length;
    nextDiskChunk += 1;
  }

  // Check if transfer is complete
  if (nextDiskChunk < totalChunks) {
    // Not done yet
    return;
  }

  // --- All chunks received and written --- finalize ---
  const expectedTotal = Number(data.totalSize);
  if (Number.isFinite(expectedTotal) && expectedTotal > 0) {
    const receivedSize = (await fs.promises.stat(tempPath).catch(() => ({ size: -1 }))).size;
    if (receivedSize !== expectedTotal) {
      await fs.promises.unlink(tempPath).catch(() => {});
      pendingMediaChunks.delete(transferKey);
      console.error(
        `> [NodeMesh][MEDIA] Rejected incomplete ${storageName}: expected ${expectedTotal} bytes, received ${receivedSize}`,
      );
      return;
    }
  }
  if (advertisedFileHash) {
    const actualHash = await sha256File(tempPath);
    if (actualHash !== advertisedFileHash) {
      await fs.promises.unlink(tempPath).catch(() => {});
      pendingMediaChunks.delete(transferKey);
      console.error(`> [NodeMesh][MEDIA] Rejected corrupt ${storageName}: SHA-256 mismatch`);
      return;
    }
  }
  await fs.promises.rename(tempPath, finalPath).catch(async () => {
    await fs.promises.copyFile(tempPath, finalPath);
    await fs.promises.unlink(tempPath).catch(() => {});
  });
  pendingMediaChunks.delete(transferKey);
  await upsertReceivedFileIndex({
    storageName,
    fileName: data.fileName,
    mimeType: data.mimeType,
    totalSize: data.totalSize,
    fromUsername,
  });
  if (typeof data.messageId === "string" && data.messageId) {
    const stored = await db.directMessage
      .findUnique({
        where: { id: data.messageId },
        include: { member: { include: { profile: true } } },
      })
      .catch(() => null);
    if (stored) {
      emitToLocalSocket(stored.conversationId, `chat:${stored.conversationId}:messages:update`, stored);
    }
  }
  console.log(`> [NodeMesh][MEDIA] Stored ${storageName} from ${fromUsername} at ${finalPath}`);
}

async function receiveDirectMediaOffer(data, peerIp) {
  const session = getMeshSession();
  if (!session) return;

  const fromNodeId = typeof data.fromNodeId === "string" ? data.fromNodeId.trim() : "";
  const fromUserId = typeof data.fromUserId === "string" ? data.fromUserId.trim() : "";
  const fromUsername = typeof data.fromUsername === "string" ? data.fromUsername.trim() : "";
  const toUsername = typeof data.toUsername === "string" ? data.toUsername.trim() : "";
  if (!fromUsername || toUsername !== session.username) return;

  const trustedPeer = fromNodeId
    ? await db.meshPeer.findUnique({ where: { macAddress: fromNodeId } })
    : null;
  const acceptedForProfile = await isPeerAcceptedForProfile(session.profileId, {
    userId: fromUserId,
    username: fromUsername,
    macAddress: fromNodeId,
  });
  if (
    !trustedPeer ||
    !acceptedForProfile ||
    !TRUSTED_STATUSES.has(trustedPeer.status) ||
    trustedPeer.publicName !== fromUsername ||
    (fromUserId && trustedPeer.userId && trustedPeer.userId !== fromUserId)
  ) {
    console.error(`> [NodeMesh][MEDIA] Rejected media offer from unaccepted peer ${fromUsername}`);
    return;
  }

  const storageName = path.basename(String(data.storageName || uploadInfoForUrl(data.fileUrl)?.filename || ""));
  if (!storageName || storageName.includes("..")) return;

  const finalPath = resolveStoredFilePath(storageName);
  let hasValidFile = false;
  if (fs.existsSync(finalPath)) {
    const expectedSize = Number(data.totalSize);
    const actualSize = (await fs.promises.stat(finalPath)).size;
    const sizeOk = !Number.isFinite(expectedSize) || expectedSize === actualSize;
    const expectedHash = typeof data.fileSha256 === "string" ? data.fileSha256 : "";
    const hashOk = !expectedHash || (await sha256File(finalPath).catch(() => "")) === expectedHash;
    hasValidFile = sizeOk && hashOk;
  }
  if (hasValidFile) return;

  sendControl(peerIp, {
    type: "direct_media_request",
    fromNodeId: getMac(),
    fromUserId: session.profileId,
    fromUsername: session.username,
    toUsername: fromUsername,
    messageId: data.messageId,
    fileUrl: data.fileUrl,
    storageName,
  }).catch((error) => {
    console.error(`> [NodeMesh][MEDIA] Failed to request missing media ${storageName}: ${error.message}`);
  });
}

async function receiveDirectMediaRequest(data, peerIp) {
  const session = getMeshSession();
  if (!session) return;

  const fromNodeId = typeof data.fromNodeId === "string" ? data.fromNodeId.trim() : "";
  const fromUserId = typeof data.fromUserId === "string" ? data.fromUserId.trim() : "";
  const fromUsername = typeof data.fromUsername === "string" ? data.fromUsername.trim() : "";
  const toUsername = typeof data.toUsername === "string" ? data.toUsername.trim() : "";
  if (!fromUsername || toUsername !== session.username) return;

  const trustedPeer = fromNodeId
    ? await db.meshPeer.findUnique({ where: { macAddress: fromNodeId } })
    : null;
  const acceptedForProfile = await isPeerAcceptedForProfile(session.profileId, {
    userId: fromUserId,
    username: fromUsername,
    macAddress: fromNodeId,
  });
  if (
    !trustedPeer ||
    !acceptedForProfile ||
    !TRUSTED_STATUSES.has(trustedPeer.status) ||
    trustedPeer.publicName !== fromUsername ||
    (fromUserId && trustedPeer.userId && trustedPeer.userId !== fromUserId)
  ) {
    console.error(`> [NodeMesh][MEDIA] Rejected media request from unaccepted peer ${fromUsername}`);
    return;
  }

  const found = await findDirectConversationByNames(session.username, fromUsername);
  if (!found || typeof data.messageId !== "string") return;

  const message = await db.directMessage.findFirst({
    where: {
      id: data.messageId,
      conversationId: found.conversation.id,
      memberId: found.firstMember.id,
      fileUrl: { not: null },
      deleted: false,
    },
  });
  if (!message) return;

  const context = {
    fromNodeId: getMac(),
    fromUserId: session.profileId,
    fromUsername: session.username,
    toUsername: fromUsername,
    messageId: message.id,
  };
  sendMediaForMessage(peerIp, context, message).catch((error) => {
    console.error(`> [NodeMesh][MEDIA] Failed to repair media ${message.id}: ${error.message}`);
  });
}

async function receiveDirectMessageSync(data, peerIp) {
  const session = getMeshSession();
  if (!session) {
    console.error(`> [NodeMesh][AUTH] Rejected direct_message_sync: no local session (peerIp: ${peerIp})`);
    return;
  }

  const message = data.message || {};
  const fromNodeId = typeof data.fromNodeId === "string" ? data.fromNodeId.trim() : "";
  const fromUserId = typeof data.fromUserId === "string" ? data.fromUserId.trim() : "";
  const fromUsername = typeof data.fromUsername === "string" ? data.fromUsername.trim() : "";
  const toUsername = typeof data.toUsername === "string" ? data.toUsername.trim() : "";
  if (!fromUsername || !toUsername || toUsername !== session.username) {
    console.error(`> [NodeMesh][AUTH] Rejected direct_message_sync: identity mismatch. from: ${fromUsername}, to: ${toUsername}, session: ${session.username}`);
    return;
  }
  if (typeof message.id !== "string" || typeof message.content !== "string") {
    console.error(`> [NodeMesh][SYNC] Rejected direct_message_sync: invalid message format. id: ${message.id}`);
    return;
  }

  const trustedPeer = fromNodeId
    ? await db.meshPeer.findUnique({ where: { macAddress: fromNodeId } })
    : null;
  const acceptedForProfile = await isPeerAcceptedForProfile(session.profileId, {
    userId: fromUserId,
    username: fromUsername,
    macAddress: fromNodeId,
  });
  if (
    !trustedPeer ||
    !acceptedForProfile ||
    !TRUSTED_STATUSES.has(trustedPeer.status) ||
    trustedPeer.publicName !== fromUsername ||
    (fromUserId && trustedPeer.userId && trustedPeer.userId !== fromUserId)
  ) {
    console.error(`> [NodeMesh][SYNC] Rejected direct message from peer not accepted by profile ${session.username}: ${fromUsername}`);
    return;
  }

  const found = await findDirectConversationByNames(fromUsername, toUsername);
  if (!found) {
    console.error(`> [NodeMesh][SYNC] Accepted peer has no profile-scoped conversation: ${fromUsername}`);
    return;
  }

  if (message.fileUrl) {
    const media = uploadInfoForUrl(message.fileUrl);
    if (!media || !fs.existsSync(media.path)) {
      console.error(`> [NodeMesh][SYNC] Holding ${message.id}: media file is not complete yet`);
      return;
    }
  }

  let stored = await db.directMessage.findUnique({
    where: { id: message.id },
    include: { member: { include: { profile: true } } },
  });

  if (!stored) {
    const maxSeq = await db.directMessage.aggregate({
      where: { conversationId: found.conversation.id },
      _max: { seqId: true }
    });
    const nextLocalSeq = (maxSeq._max.seqId ?? 0) + 1;

    stored = await db.directMessage.create({
      data: {
        id: message.id,
        content: message.content,
        type: message.type || "TEXT",
        fileUrl: message.fileUrl || undefined,
        fileName: message.fileName || undefined,
        fileSize: message.fileSize ? Number(message.fileSize) : undefined,
        mimeType: message.mimeType || undefined,
        thumbnailUrl: message.thumbnailUrl || undefined,
        mediaKey: message.mediaKey || undefined,
        conversationId: found.conversation.id,
        memberId: found.firstMember.id,
        status: "DELIVERED",
        createdAt: new Date(), // Always use local time to prevent airgapped clock drift from burying messages in the past
        seqId: nextLocalSeq,
        senderSeqId: typeof message.seqId === "number" ? message.seqId : null,
      },
      include: { member: { include: { profile: true } } },
    });

    // Force WAL flush to disk immediately so power pulls don't lose the message!
    await db.$executeRawUnsafe("PRAGMA wal_checkpoint(FULL);").catch(() => {});
  }

  // Notify the UI to instantly append the new message!
  emitToLocalSocket(found.conversation.id, `chat:${found.conversation.id}:messages`, stored);
  emitToLocalSocket(null, "chat:refresh-list", null);
  redisClient?.del(`cache:chat:${found.conversation.id}:messages`).catch(() => {});
  sendControl(peerIp, {
    type: "direct_message_ack",
    messageId: message.id,
    fromNodeId: getMac(),
    fromUsername: session.username,
  }).catch(() => {});
  console.log(`> [NodeMesh][SYNC] Stored direct message ${message.id} from ${fromUsername}`);
}

async function receiveDirectMessageAck(data) {
  if (typeof data.messageId !== "string") return;
  const localSession = getMeshSession();
  const localUserId = localSession?.profileId;
  await db.directMessage.updateMany({
    where: { id: data.messageId, status: "SENT" },
    data: { status: "DELIVERED", deliveredAt: new Date() },
  });
  
  await db.$executeRawUnsafe("PRAGMA wal_checkpoint(FULL);").catch(() => {});
  const message = await db.directMessage.findUnique({
    where: { id: data.messageId },
    include: { member: { include: { profile: true } } },
  });
  // If it's the sender's own receipt update, don't ping the whole room, but we do update the DB.
  if (message && message.memberId !== localUserId) {
    emitToLocalSocket(message.conversationId, `chat:${message.conversationId}:messages:update`, message);
  }
  console.log(`> [NodeMesh][SYNC] Acked direct message ${data.messageId}`);
}

async function syncPendingDirectMessages(peerUsername, peerIp) {
  const session = getMeshSession();
  if (!session || !peerUsername) return;

  const found = await findDirectConversationByNames(session.username, peerUsername);
  if (!found) return;

  const pending = await db.directMessage.findMany({
    where: {
      conversationId: found.conversation.id,
      memberId: found.firstMember.id,
      status: "SENT",
      deleted: false,
    },
    orderBy: { createdAt: "asc" },
    take: 50,
  });

  let consecutiveFailures = 0;
  for (const message of pending) {
    const context = {
      fromNodeId: getMac(),
      fromUserId: session.profileId,
      fromUsername: session.username,
      toUsername: peerUsername,
      messageId: message.id,
    };

    const mediaReady = await sendMediaForMessage(peerIp, context, message).then(
      () => true,
      (error) => {
      console.error(`> [NodeMesh][MEDIA] Failed to send media for ${message.id}: ${error.message}`);
        return false;
      },
    );
    if (!mediaReady) continue;

    let failed = false;
    await sendControl(peerIp, {
      type: "direct_message_sync",
      fromNodeId: context.fromNodeId,
      fromUserId: context.fromUserId,
      fromUsername: context.fromUsername,
      toUsername: peerUsername,
      message: directMessagePayload(message, session.username, peerUsername),
    }).catch((error) => {
      console.error(`> [NodeMesh][SYNC] Failed to send ${message.id}: ${error.message}`);
      failed = true;
    });

    if (failed) consecutiveFailures++;
    else consecutiveFailures = 0;

    if (consecutiveFailures >= 3) {
      console.log(`> [NodeMesh][SYNC] Peer ${peerIp} unreachable, aborting sync`);
      break;
    }
  }

  const repairKey = `${peerUsername}::${normalizeIp(peerIp)}`;
  const lastRepairAt = lastMediaRepairAtByPeer.get(repairKey) || 0;
  if (Date.now() - lastRepairAt < MEDIA_REPAIR_INTERVAL_MS) return;
  lastMediaRepairAtByPeer.set(repairKey, Date.now());

  const mediaMessages = await db.directMessage.findMany({
    where: {
      conversationId: found.conversation.id,
      memberId: found.firstMember.id,
      fileUrl: { not: null },
      deleted: false,
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  for (const message of mediaMessages) {
    await sendMediaOfferForMessage(peerIp, {
      fromNodeId: getMac(),
      fromUserId: session.profileId,
      fromUsername: session.username,
      toUsername: peerUsername,
      messageId: message.id,
    }, message);
  }
}

async function syncPendingDirectMessagesForOnlinePeers({ force = false } = {}) {
  const session = getMeshSession();
  if (!session) return;

  const now = Date.now();
  if (!force && now - lastOutboxSyncAt < OUTBOX_SYNC_INTERVAL_MS) return;
  if (outboxSyncRunning) return;

  outboxSyncRunning = true;
  lastOutboxSyncAt = now;
  try {
    const activeThreshold = new Date(Date.now() - 5 * 60 * 1000); // 5-minute window so rebooted peers still get their offline messages
    const peers = await db.meshPeer.findMany({
      where: {
        status: { in: Array.from(TRUSTED_STATUSES) },
        ipAddress: { not: null },
        publicName: { not: null },
        lastSeen: { gte: activeThreshold },
      },
      orderBy: { lastSeen: "desc" },
    });

    // Deduplicate by IP: only sync to the MOST RECENTLY SEEN peer per IP address.
    // This prevents sending "toUsername: Cyber Admin" to Pi-2 (which is Deck-01)
    // when multiple peer rows happen to share the same IP.
    const seenIps = new Map();
    for (const peer of peers) {
      const ip = peer.ipAddress;
      if (!ip) continue;
      if (!seenIps.has(ip)) {
        seenIps.set(ip, peer); // first entry is the most recent (ordered by lastSeen desc)
      }
    }
    const dedupedPeers = Array.from(seenIps.values());

    for (const peer of dedupedPeers) {
      const username = typeof peer.publicName === "string" ? peer.publicName.trim() : "";
      if (!username || username === session.username || !peer.ipAddress) continue;

      await syncPendingDirectMessages(peer.publicName, peer.ipAddress).catch((error) => {
        console.error(`> [NodeMesh][SYNC] Outbox retry failed for ${peer.publicName}: ${error.message}`);
      });
    }
  } finally {
    outboxSyncRunning = false;
  }
}

async function findTrustedSignalPeer(fromUsername, fromUserId, peerIp) {
  const candidates = await db.meshPeer.findMany({
    where: {
      status: { in: Array.from(TRUSTED_STATUSES) },
      OR: [
        { publicName: fromUsername },
        ...(fromUserId ? [{ userId: fromUserId }] : []),
        ...(peerIp ? [{ ipAddress: peerIp }] : []),
      ],
    },
  });

  const exact = candidates.find((peer) => {
    const nameOk = !peer.publicName || peer.publicName === fromUsername;
    const userOk = !fromUserId || !peer.userId || peer.userId === fromUserId;
    return nameOk && userOk;
  });
  if (exact) return exact;

  return peerIp
    ? candidates.find((peer) => normalizeIp(peer.ipAddress || "") === peerIp) || null
    : null;
}

async function storeMeshCallRoute(callId, fields) {
  if (!redisClient || !callId) return;
  await redisClient.hset(`mesh:call:${callId}`, fields);
  await redisClient.expire(`mesh:call:${callId}`, 60 * 60);
}

async function getMeshCallRoute(callId) {
  if (!redisClient || !callId) return {};
  return redisClient.hgetall(`mesh:call:${callId}`);
}

async function receiveCallStartSignal(payload, fromUsername, fromUserId, peerIp, peer) {
  const session = getMeshSession();
  if (!session) {
    console.error("> [NodeMesh][CALL] Rejected call:start: no local session");
    return;
  }

  const found = await findDirectConversationByNames(fromUsername, session.username);
  if (!found) {
    console.error(`> [NodeMesh][CALL] Rejected call:start: missing local conversation for ${fromUsername}/${session.username}`);
    return;
  }

  const callId = typeof payload.callId === "string" ? payload.callId : crypto.randomUUID();
  const localPayload = {
    ...payload,
    chatId: found.conversation.id,
    callId,
    callerName: fromUsername,
    callerMemberId: found.firstMember.id,
    callerUserId: found.firstMember.profileId,
    targetUserId: found.secondMember.profileId,
    serverId: found.secondMember.serverId,
  };

  await storeMeshCallRoute(callId, {
    localChatId: found.conversation.id,
    localUserId: found.secondMember.profileId,
    peerMac: peer.macAddress,
    peerIp,
    peerName: fromUsername,
    peerUserId: fromUserId || "",
  });

  // Emit to the local frontend UI so it triggers the incoming call ringing screen!
  // We emit to the user's specific room so it reaches their active tab/device
  emitToLocalSocket(`user:${found.secondMember.profileId}`, "call:start", localPayload);
  emitToLocalSocket(found.conversation.id, "call:start", localPayload);
  console.log(`> [NodeMesh][CALL] Incoming ${localPayload.type || "audio"} call from ${fromUsername}`);
}

async function emitRoutedCallSignal(event, payload, fromUsername, fromUserId, peerIp, peer) {
  const callId = typeof payload.callId === "string" ? payload.callId : "";
  const route = await getMeshCallRoute(callId);
  const localPayload = {
    ...payload,
    chatId: route.localChatId || payload.chatId,
  };

  if (callId) {
    await storeMeshCallRoute(callId, {
      localChatId: localPayload.chatId || "",
      localUserId: route.localUserId || "",
      peerMac: peer.macAddress,
      peerIp,
      peerName: fromUsername,
      peerUserId: fromUserId || "",
    });
  }

  const targetUserRoom = route.localUserId
    ? `user:${route.localUserId}`
    : (localPayload.targetUserId ? `user:${localPayload.targetUserId}` : null);

  const isCallControlEvent =
    event === "call:accept" ||
    event === "call:accepted" ||
    event === "call:decline" ||
    event === "call:declined" ||
    event === "call:end" ||
    event === "call:timeout" ||
    event === "call:busy";

  if (isCallControlEvent) {
    // Emit to the conversation room (for active call tabs)
    emitToLocalSocket(localPayload.chatId, event, localPayload);
    // Also emit to the user's specific room (for ringing/modal overlays)
    if (targetUserRoom) {
      emitToLocalSocket(targetUserRoom, event, localPayload);
    }
  } else if (event === "call:ping" || event === "call:pong") {
    // Diagnostic pings, point-to-point only
    if (targetUserRoom) {
      emitToLocalSocket(targetUserRoom, event, localPayload);
    }
  } else {
    // WebRTC connection signals (offer, answer, candidates)
    emitToLocalSocket(localPayload.chatId, event, localPayload);
  }
}

async function receiveCallSignal(data, peerIp) {
  peerIp = normalizeIp(peerIp);
  const allowedEvents = new Set([
    "call:start",
    "call:accept",
    "call:decline",
    "call:timeout",
    "call:end",
    "call:busy",
    "call:offline",
    "webrtc:peer-joined",
    "webrtc:offer",
    "webrtc:answer",
    "webrtc:ice-candidate",
    "webrtc:error",
    "webrtc:peer-left",
  ]);

  const event = typeof data.event === "string" ? data.event : "";
  const payload = data.payload && typeof data.payload === "object" ? data.payload : null;
  const fromUsername = typeof data.fromUsername === "string" ? data.fromUsername.trim() : "";
  const fromUserId = typeof data.fromUserId === "string" ? data.fromUserId.trim() : "";

  if (!allowedEvents.has(event) || !payload || !fromUsername) {
    console.error("> [NodeMesh][CALL] Rejected call_signal: invalid payload");
    return;
  }

  const peer = await findTrustedSignalPeer(fromUsername, fromUserId, peerIp);
  if (!peer) {
    console.error(`> [NodeMesh][CALL] Rejected ${event} from untrusted peer ${fromUsername}`);
    return;
  }

  const trustedUsername = peer.publicName || fromUsername;
  const trustedUserId = peer.userId || fromUserId;

  if (event === "call:start") {
    await receiveCallStartSignal(payload, trustedUsername, trustedUserId, peerIp, peer);
    return;
  }

  await emitRoutedCallSignal(event, payload, trustedUsername, trustedUserId, peerIp, peer);
}

async function receiveConnectionRequest(data, peerIp) {
  await ensureSqliteRuntime();
  peerIp = normalizeIp(peerIp);
  const localSession = getMeshSession();
  if (!localSession?.profileId) {
    console.error("> [NodeMesh][AUTH] Rejected connection_request: no active local profile");
    return;
  }
  const fromUsername = typeof data.fromUsername === "string" ? data.fromUsername.trim() : "";
  const fromUserId = typeof data.fromUserId === "string" ? data.fromUserId.trim() : "";
  if (!fromUsername || !fromUserId) {
    console.error("> [NodeMesh][AUTH] Rejected connection_request: missing_username");
    return;
  }

  if (
    typeof data.requestId !== "string" ||
    typeof data.fromNodeId !== "string" ||
    typeof data.expiresAt !== "number" ||
    data.expiresAt < Date.now()
  ) return;

  const securityStatus = normalizeSecurityStatus(data.securityStatus);
  const requestPayload = {
    ...data,
    securityStatus,
    targetProfileId: localSession.profileId,
    targetUsername: localSession.username,
  };

  if (await isBlockedMac(data.fromNodeId)) {
    await logBlockedPeer(data.fromNodeId, fromUsername, peerIp);
    return;
  }
  const existingPeer = await db.meshPeer.findUnique({ where: { macAddress: data.fromNodeId } });
  if (existingPeer?.status === "BLOCKED") return;
  const trustedNameCollision = await db.meshPeer.findFirst({
    where: {
      publicName: fromUsername,
      macAddress: { not: data.fromNodeId },
      userId: { not: fromUserId },
      status: { in: ["TRUSTED", "ACCEPTED"] },
    },
  });
  if (trustedNameCollision) {
    await logImpersonationAttempt({
      userId: fromUserId,
      username: fromUsername,
      macAddress: data.fromNodeId,
      ipAddress: peerIp,
      trustedPeer: trustedNameCollision,
    });
    return;
  }

  const replay = await db.connectionRequest.findUnique({ where: { requestId: data.requestId } });
  if (replay) return;

  await db.$transaction([
    db.meshPeer.upsert({
      where: { macAddress: data.fromNodeId },
      create: {
        macAddress: data.fromNodeId,
        userId: fromUserId,
        hostname: data.fromDeviceName || data.fromHostname || null,
        publicName: fromUsername,
        displayName: fromUsername,
        ipAddress: peerIp,
        status: "PENDING_INCOMING",
        lastHandshake: new Date(),
      },
      update: {
        userId: fromUserId,
        hostname: data.fromDeviceName || data.fromHostname || undefined,
        publicName: fromUsername,
        displayName: fromUsername,
        ipAddress: peerIp,
        status: existingPeer && TRUSTED_STATUSES.has(existingPeer.status)
          ? existingPeer.status
          : "PENDING_INCOMING",
        lastHandshake: new Date(),
      },
    }),
    db.connectionRequest.create({
      data: {
        requestId: data.requestId,
        fromNodeId: data.fromNodeId,
        toNodeId: getMac(),
        direction: "INCOMING",
        status: "PENDING",
        message: typeof data.message === "string" ? data.message.slice(0, 240) : null,
        expiresAt: new Date(data.expiresAt),
      },
    }),
  ]);
  await recordEvent(data.fromNodeId, data.requestId, "handshake_request_received", requestPayload, data.fromNodeId);
  console.log(`> [NodeMesh] Incoming connection request ${data.requestId} from ${data.fromNodeId}`);
}

async function receiveConnectionResponse(data, peerIp) {
  await ensureSqliteRuntime();
  peerIp = normalizeIp(peerIp);
  const fromUsername = typeof data.fromUsername === "string" ? data.fromUsername.trim() : "";
  const fromUserId = typeof data.fromUserId === "string" ? data.fromUserId.trim() : "";
  if (!fromUsername) {
    console.error("> [NodeMesh][AUTH] Rejected connection_response: missing_username");
    return;
  }

  if (
    typeof data.requestId !== "string" ||
    typeof data.fromNodeId !== "string" ||
    !["ACCEPTED", "DECLINED", "IGNORED", "BLOCKED"].includes(data.status)
  ) return;

  const request = await db.connectionRequest.findUnique({ where: { requestId: data.requestId } });
  const isManualIpRequest = typeof request?.toNodeId === "string" && request.toNodeId.startsWith(MANUAL_PEER_PREFIX);
  if (
    !request ||
    request.direction !== "OUTGOING" ||
    request.status !== "PENDING" ||
    (!isManualIpRequest && request.toNodeId !== data.fromNodeId)
  ) return;

  const ownerEvent = await db.meshEvent.findFirst({
    where: {
      entityType: "connection_request",
      entityId: data.requestId,
      operation: "handshake_request_sent",
    },
    orderBy: { timestamp: "desc" },
  });
  let requestProfileId = null;
  if (ownerEvent?.payloadJson) {
    try {
      const ownerPayload = JSON.parse(ownerEvent.payloadJson);
      requestProfileId = typeof ownerPayload.localProfileId === "string"
        ? ownerPayload.localProfileId
        : null;
    } catch {}
  }

  const existingTransportPeer = await db.meshPeer.findUnique({
    where: { macAddress: data.fromNodeId },
  });
  const peerStatus =
    data.status === "ACCEPTED" ? "TRUSTED" :
    data.status === "BLOCKED" ? "BLOCKED" :
    existingTransportPeer && TRUSTED_STATUSES.has(existingTransportPeer.status)
      ? existingTransportPeer.status
      : data.status === "DECLINED" ? "DECLINED" : "UNKNOWN";
  const existingSession = data.status === "ACCEPTED"
    ? await db.peerSession.findFirst({ where: { peerNodeId: data.fromNodeId } })
    : null;
  const securityStatus = normalizeSecurityStatus(data.securityStatus);
  const responsePayload = { ...data, securityStatus };

  await db.connectionRequest.update({
    where: { requestId: data.requestId },
    data: { status: data.status, respondedAt: new Date(), toNodeId: data.fromNodeId },
  });
  await db.meshPeer.upsert({
    where: { macAddress: data.fromNodeId },
    update: {
      userId: fromUserId || undefined,
      status: peerStatus,
      ipAddress: peerIp,
      publicName: fromUsername,
      displayName: fromUsername,
      hostname: data.fromDeviceName || undefined,
      lastHandshake: new Date(),
    },
    create: {
      macAddress: data.fromNodeId,
      userId: fromUserId || null,
      status: peerStatus,
      ipAddress: peerIp,
      publicName: fromUsername,
      displayName: fromUsername,
      hostname: data.fromDeviceName || null,
      lastHandshake: new Date(),
    },
  });
  await db.meshEvent.create({
    data: {
      originNodeId: data.fromNodeId,
      entityType: "connection_request",
      entityId: data.requestId,
      operation: `handshake_${data.status.toLowerCase()}`,
      payloadJson: JSON.stringify(responsePayload),
      receivedFrom: data.fromNodeId,
    },
  });

  if (data.status === "ACCEPTED") {
    const session = getMeshSession();
    const localProfileId = requestProfileId || session?.profileId;
    if (!localProfileId) {
      console.error("> [NodeMesh][AUTH] Accepted peer, but no saved local session exists; contact conversation not created");
      return;
    }
    const contact = await ensureAcceptedMeshContact({
      localProfileId,
      userId: fromUserId,
      username: fromUsername,
      macAddress: data.fromNodeId,
      deviceName: data.fromDeviceName,
    });
    const conversation = await ensureDirectConversationForAcceptedPeer(
      localProfileId,
      contact.member.id,
      contact.defaultServer.id,
    );
    await db.meshDevice.upsert({
      where: { ownerId_macAddress: { ownerId: fromUserId || data.fromNodeId, macAddress: data.fromNodeId } },
      update: {
        deviceName: data.fromDeviceName || undefined,
        approvedAt: new Date(),
        approvedBy: getMac(),
      },
      create: {
        ownerId: fromUserId || data.fromNodeId,
        macAddress: data.fromNodeId,
        deviceName: data.fromDeviceName || undefined,
        approvedAt: new Date(),
        approvedBy: getMac(),
      },
    });
    if (existingSession) {
      await db.peerSession.update({
        where: { sessionId: existingSession.sessionId },
        data: {
          state: "CONNECTED",
          lastConnected: new Date(),
          transportIp: peerIp,
          transportPort: CONTROL_PORT,
        },
      });
    } else {
      await db.peerSession.create({
        data: {
          peerNodeId: data.fromNodeId,
          state: "CONNECTED",
          lastConnected: new Date(),
          transportIp: peerIp,
          transportPort: CONTROL_PORT,
        },
      });
    }
    await db.syncState.upsert({
      where: { peerNodeId: data.fromNodeId },
      update: {},
      create: { peerNodeId: data.fromNodeId },
    });
    await writeTrustedPeer(db, {
      macId: data.fromNodeId,
      hostAddress: peerIp,
      securityStatus,
    });
    await db.meshEvent.create({
      data: {
        originNodeId: getMac(),
        entityType: "conversation",
        entityId: conversation.id,
        operation: "trusted_contact_conversation_ready",
        payloadJson: JSON.stringify({
          peerNodeId: data.fromNodeId,
          peerUserId: contact.profile.userId,
          peerUsername: contact.profile.name,
        }),
      },
    });
  } else {
    await logRejectedPeer(db, {
      requestId: data.requestId,
      macId: data.fromNodeId,
      hostAddress: peerIp,
      securityStatus,
      action: data.status,
    });
  }

  if (data.status === "BLOCKED") {
    await db.meshBlocklist.upsert({
      where: { macAddress: data.fromNodeId },
      update: { reason: "blocked_by_peer_response" },
      create: { macAddress: data.fromNodeId, reason: "blocked_by_peer_response" },
    });
  }
  console.log(`> [NodeMesh] Connection request ${data.requestId} is ${data.status}`);
}

function startControlServer() {
  // Clients half-close after sending one packet, then wait for our explicit
  // OK/ERR reply. Without allowHalfOpen Node closes the writable side before
  // the async packet handler can acknowledge it.
  const server = net.createServer({ allowHalfOpen: true }, (socket) => {
    let raw = "";
    let packetTooLarge = false;
    const peerIp = normalizeIp(socket.remoteAddress);

    socket.setTimeout(CONTROL_TIMEOUT_MS, () => {
      socket.destroy(new Error("Mesh control receive timeout"));
    });
    socket.on("error", (error) => {
      if (error.code !== "ECONNRESET") {
        console.warn(`> [NodeMesh] Control socket error from ${peerIp || "unknown"}: ${error.message}`);
      }
    });
    socket.on("data", (chunk) => {
      raw += chunk.toString("utf8");
      if (Buffer.byteLength(raw, "utf8") > MAX_PACKET_BYTES) {
        packetTooLarge = true;
        socket.destroy(new Error("Mesh control packet too large"));
      }
    });
    socket.on("end", async () => {
      let reply = "OK\n";
      try {
        if (packetTooLarge) throw new Error("Control packet exceeded the configured limit");
        const data = verify(JSON.parse(raw.trim()), peerIp);
        if (!data) throw new Error("Control packet authentication failed");

        if (data.type === "connection_request") await receiveConnectionRequest(data, peerIp);
        else if (data.type === "connection_response") await receiveConnectionResponse(data, peerIp);
        else if (data.type === "direct_message_sync") await receiveDirectMessageSync(data, peerIp);
        else if (data.type === "direct_media_chunk") await receiveDirectMediaChunk(data, peerIp);
        else if (data.type === "direct_media_offer") await receiveDirectMediaOffer(data, peerIp);
        else if (data.type === "direct_media_request") await receiveDirectMediaRequest(data, peerIp);
        if (data.type === "direct_message_ack") await receiveDirectMessageAck(data);
        else if (data.type === "call_signal") await receiveCallSignal(data, peerIp);
        else if (![
          "connection_request",
          "connection_response",
          "direct_message_sync",
          "direct_media_chunk",
          "direct_media_offer",
          "direct_media_request",
        ].includes(data.type)) {
          throw new Error(`Unsupported control packet type: ${String(data.type || "unknown")}`);
        }
      } catch (error) {
        console.error("> [NodeMesh] Rejected control packet:", error.message, "RAW_LEN:", raw.length, "RAW_START:", raw.substring(0, 100), "RAW_END:", raw.slice(-100));
        reply = `ERR ${String(error.message || "Control packet rejected").replace(/[\r\n]+/g, " ").slice(0, 240)}\n`;
      } finally {
        if (!socket.destroyed) socket.end(reply);
      }
    });
  });
  server.listen(CONTROL_PORT, "0.0.0.0", () => {
    console.log(`> [NodeMesh] Signed TCP control listening on port ${CONTROL_PORT}`);
  });
}

function rememberPeerIp(ip) {
  const normalized = normalizeIp(ip);
  if (!normalized || isLocalIp(normalized)) return;
  learnedPeerIps.set(normalized, Date.now());
}

function rememberedPeerIps() {
  const now = Date.now();
  const maxAgeMs = 24 * 60 * 60 * 1000;
  for (const [ip, lastSeen] of learnedPeerIps.entries()) {
    if (now - lastSeen > maxAgeMs) learnedPeerIps.delete(ip);
  }
  return [...learnedPeerIps.keys()];
}

async function knownPeerIps() {
  const peers = await db.meshPeer.findMany({
    where: {
      ipAddress: { not: null },
      status: { notIn: ["BLOCKED", "DECLINED"] },
    },
    select: { ipAddress: true },
  });
  return peers.map((peer) => peer.ipAddress).filter(Boolean);
}

function beaconSenderKey(iface) {
  return `${iface.name}:${iface.address}`;
}

function closeStaleBeaconSenders(activeKeys) {
  for (const [key, entry] of beaconSendSockets.entries()) {
    if (activeKeys.has(key)) continue;
    beaconSendSockets.delete(key);
    try {
      entry.socket.close();
    } catch {}
  }
}

function safeUdpSend(socket, packet, address, label = "default") {
  if (!address || isLocalIp(address)) return;
  socket.send(packet, BEACON_PORT, address, (error) => {
    if (error) {
      console.warn(`> [NodeMesh] Beacon send skipped via ${label} to ${address}: ${error.message}`);
    }
  });
}

function getBeaconSender(iface) {
  const key = beaconSenderKey(iface);
  const existing = beaconSendSockets.get(key);
  if (existing) return existing;

  const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
  const entry = { socket, ready: false, queue: [] };
  beaconSendSockets.set(key, entry);

  socket.on("error", (error) => {
    console.warn(`> [NodeMesh] Interface sender ${key} unavailable: ${error.message}`);
    beaconSendSockets.delete(key);
    try {
      socket.close();
    } catch {}
  });

  socket.bind(0, iface.address, () => {
    entry.ready = true;
    try {
      socket.setBroadcast(true);
    } catch {}
    try {
      socket.setMulticastTTL(1);
    } catch {}
    try {
      socket.setMulticastInterface(iface.address);
    } catch {}

    const queued = entry.queue.splice(0);
    for (const send of queued) send();
  });

  return entry;
}

function sendFromInterface(packet, iface, address) {
  const entry = getBeaconSender(iface);
  const send = () => safeUdpSend(entry.socket, packet, address, `${iface.name}/${iface.address}`);
  if (entry.ready) {
    send();
  } else if (entry.queue.length < 50) {
    entry.queue.push(send);
  }
}

async function discoveryTargets({ includeUnicast = false } = {}) {
  const targets = new Set([
    ...getBroadcastAddresses(),
    MESH_MULTICAST_ADDR,
  ]);
  if (includeUnicast) {
    for (const ip of [
      ...getConfiguredFallbackIps(),
      ...getDirectProbeAddresses(),
      ...rememberedPeerIps(),
      ...(await knownPeerIps()),
    ]) {
      targets.add(ip);
    }
  }
  return [...targets].filter((target) => target && !isLocalIp(target));
}

async function sendDiscoveryPacket(udp, packet, { includeUnicast = false } = {}) {
  const interfaces = getLanInterfaces();
  closeStaleBeaconSenders(new Set(interfaces.map(beaconSenderKey)));
  joinMulticastGroups(udp);

  const defaultTargets = [...new Set(await discoveryTargets({ includeUnicast }))].filter(
    (target) => target && target !== MESH_MULTICAST_ADDR && !isLocalIp(target),
  );
  for (const address of defaultTargets) safeUdpSend(udp, packet, address);

  for (const iface of interfaces) {
    const interfaceTargets = new Set([MESH_MULTICAST_ADDR]);
    const broadcast = broadcastFor(iface.address, iface.netmask);
    if (broadcast && broadcast !== iface.address) interfaceTargets.add(broadcast);
    for (const address of interfaceTargets) {
      if (address && !isLocalIp(address)) sendFromInterface(packet, iface, address);
    }
  }
}

function joinMulticastGroups(udp) {
  const interfaces = getLanInterfaces();
  for (const iface of interfaces) {
    const key = `${MESH_MULTICAST_ADDR}:${iface.address}`;
    if (multicastMemberships.has(key)) continue;
    try {
      udp.addMembership(MESH_MULTICAST_ADDR, iface.address);
      multicastMemberships.add(key);
    } catch (error) {
      console.warn(`> [NodeMesh] Multicast join skipped on ${iface.name} (${iface.address}): ${error.message}`);
    }
  }
  try {
    udp.setMulticastTTL(1);
  } catch {}
}

async function ensureDefaultServer() {
  const session = getMeshSession();
  if (session?.profileId) await ensureProfileChatServer(session.profileId);
}

function startMeshDiscovery() {
  ensureDefaultServer().catch(e => console.error("> [NodeMesh] Failed to ensure default server:", e.message));
  const udp = dgram.createSocket({ type: "udp4", reuseAddr: true });
  let beaconTick = 0;

  udp.on("message", async (msg, rinfo) => {
    const sourceIp = normalizeIp(rinfo.address);
    try {
      const str = msg.toString("utf8");
      console.log(`> [NodeMesh][UDP] Received UDP packet from ${sourceIp}, len: ${msg.length}`);

      const parsed = JSON.parse(str.trim());
      const data = verify(parsed, sourceIp);
      if (!data || data.type !== "HELLO" || typeof data.nodeId !== "string" || data.nodeId === getMac()) return;
      if (isLocalIp(sourceIp)) return;
      console.log(`> [NodeMesh][UDP] Verified HELLO from ${sourceIp} (${data.username})`);

      rememberPeerIp(sourceIp);
      if (!data.probeReply) {
        sendBeaconReply(sourceIp).catch((error) => {
          console.warn(`> [NodeMesh] Discovery reply to ${sourceIp} failed: ${error.message}`);
        });
      }

      const username = typeof data.username === "string" ? data.username.trim() : "";
      const userId = typeof data.userId === "string" ? data.userId.trim() : "";
      const macAddress = data.nodeId;
      const deviceName = data.deviceName || data.hostname || null;
      const securityStatus = normalizeSecurityStatus(data.securityStatus);
      if (!username || !userId) {
        console.error(`> [NodeMesh][AUTH] Rejected HELLO from ${sourceIp}: missing_username`);
        logMeshEvent("AUTH_FAIL", { reason: "missing_username", sourceIp }, sourceIp);
        return;
      }
      if (await isBlockedMac(macAddress)) {
        await logBlockedPeer(macAddress, username, sourceIp);
        return;
      }

      const sameUserPeer = await db.meshPeer.findFirst({ where: { userId } });
      const sameMacPeer = await db.meshPeer.findUnique({ where: { macAddress } });
      const trustedNameCollision = await db.meshPeer.findFirst({
        where: {
          publicName: username,
          macAddress: { not: macAddress },
          userId: { not: userId },
          status: { in: ["TRUSTED", "ACCEPTED"] },
        },
      });

      // Force WAL flush to disk immediately so power pulls don't lose the message!
      await db.$executeRawUnsafe("PRAGMA wal_checkpoint(FULL);").catch(() => {});

      if (!sameUserPeer && trustedNameCollision) {
        await logImpersonationAttempt({ userId, username, macAddress, ipAddress: sourceIp, trustedPeer: trustedNameCollision });
        return;
      }

      if (sameMacPeer?.status === "BLOCKED") {
        await logBlockedPeer(macAddress, username, sourceIp);
        return;
      }

      let status = sameMacPeer?.status || "UNKNOWN";
      const sameUserSameDevice = sameUserPeer?.macAddress === macAddress;
      const sameUserNewDevice = sameUserPeer && sameUserPeer.macAddress !== macAddress;
      if (sameUserNewDevice) {
        const approvedDevice = await db.meshDevice.findUnique({
          where: { ownerId_macAddress: { ownerId: userId, macAddress } },
        });
        status = approvedDevice?.approvedAt ? "TRUSTED" : "PENDING_INCOMING";
      } else if (!sameUserSameDevice && !sameMacPeer) {
        status = "PENDING_INCOMING";
      }

      const peer = await upsertPeerIdentity({
        userId,
        username,
        macAddress,
        deviceName,
        ipAddress: sourceIp,
        status,
        displayName: displayNameFor(username, deviceName, macAddress, Boolean(!sameUserPeer && sameMacPeer && sameMacPeer.userId !== userId)),
      });

      if (TRUSTED_STATUSES.has(peer.status)) {
        // One serialized outbox owns all message and attachment delivery. A
        // second transfer per HELLO used to race the API sender and corrupt the
        // receiver's partial file.
        syncPendingDirectMessagesForOnlinePeers().catch((error) => {
          console.error(`> [NodeMesh][SYNC] Outbox sweep failed: ${error.message}`);
        });
      }
    } catch (error) {
      trackAuthFail(sourceIp, "bad_udp_packet", {}, null);
      console.warn(`> [NodeMesh][UDP] Ignored malformed packet from ${sourceIp}: ${error.message}`);
    }
  });

  udp.bind(BEACON_PORT, () => {
    udp.setBroadcast(true);
    joinMulticastGroups(udp);
    console.log(`> [NodeMesh] Signed UDP discovery listening on port ${BEACON_PORT}`);
  });

  setInterval(() => {
    sendBeacon().catch((error) => {
      console.error(`> [NodeMesh] Discovery beacon failed: ${error.message}`);
    });
  }, 5000);

  setInterval(() => {
    syncPendingDirectMessagesForOnlinePeers().catch((error) => {
      console.error(`> [NodeMesh][SYNC] Outbox sweep failed: ${error.message}`);
    });
  }, OUTBOX_SYNC_INTERVAL_MS);

  // Force a full outbox sweep 15 seconds after startup so any messages
  // queued while the peer was offline get delivered as soon as it comes up.
  setTimeout(() => {
    syncPendingDirectMessagesForOnlinePeers({ force: true }).catch((error) => {
      console.error(`> [NodeMesh][SYNC] Startup outbox sweep failed: ${error.message}`);
    });
  }, 15000);

  // Periodic WAL checkpoint — ensures SQLite pages are flushed to the main DB
  // file every 30 s so a sudden power cut doesn't lose unsaved messages.
  setInterval(() => {
    db.$executeRawUnsafe("PRAGMA wal_checkpoint(FULL);").catch(() => {});
  }, 30000);

  function buildHelloPacket(extra = {}, { logMissingSession = true } = {}) {
    const session = getMeshSession();
    if (!session) {
      if (logMissingSession) console.error("> [NodeMesh][AUTH] Mesh beacon paused: no logged-in user session");
      return null;
    }

    const localNodeId = getMac();
    return Buffer.from(JSON.stringify(sign({
      type: "HELLO",
      nodeId: localNodeId,
      userId: session.profileId,
      username: session.username,
      displayName: session.displayName,
      deviceMac: localNodeId,
      deviceName: session.deviceName,
      hostname: session.deviceName,
      publicName: session.username,
      securityStatus: VERIFIED_LAN_STATUS,
      dbVersion: "2.0.0",
      vectorClock: { [localNodeId]: 0 },
      ip: getIp(),
      ...extra,
    })));
  }

  function sendUnicastDiscoveryPacket(packet, address) {
    if (!address || isLocalIp(address)) return;
    safeUdpSend(udp, packet, address, "direct-reply");
    for (const iface of getLanInterfaces()) {
      if (isIpInInterfaceSubnet(address, iface)) sendFromInterface(packet, iface, address);
    }
  }

  async function sendBeaconReply(address) {
    const packet = buildHelloPacket({ probeReply: true }, { logMissingSession: false });
    if (!packet) return;
    sendUnicastDiscoveryPacket(packet, address);
  }

  async function sendBeacon() {
    const packet = buildHelloPacket();
    if (!packet) return;

    beaconTick += 1;
    await sendDiscoveryPacket(udp, packet);
    if (beaconTick >= 3) {
      beaconTick = 0;
      await sendDiscoveryPacket(udp, packet, { includeUnicast: true });
    }
  }

  startControlServer();
}

module.exports = { startMeshDiscovery, getMac };
