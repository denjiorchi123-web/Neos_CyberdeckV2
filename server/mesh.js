const crypto = require("crypto");
const dgram = require("dgram");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const { PrismaClient } = require("@prisma/client");

const db = new PrismaClient();
let redisClient = null;
let ioEmitter = null;
try {
  const Redis = require("ioredis");
  const { Emitter } = require("@socket.io/redis-emitter");
  redisClient = new Redis(process.env.REDIS_URL || "redis://127.0.0.1:6379");
  ioEmitter = new Emitter(redisClient);
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
const DIRECT_CABLE_PREFIXES = (process.env.MESH_DIRECT_PREFIXES || "10.0.0.,192.168.10.")
  .split(",")
  .map((prefix) => prefix.trim())
  .filter(Boolean);
const DIRECTED_BROADCAST_ADDR = process.env.MESH_BROADCAST_ADDR || "";
const PEER_FALLBACK_IPS = (process.env.MESH_PEER_FALLBACK_IPS || "10.0.0.1,10.0.0.100,192.168.10.1,192.168.10.2")
  .split(",")
  .map((ip) => ip.trim())
  .filter(Boolean);
const MESH_SESSION_FILE = process.env.MESH_SESSION_FILE || path.join(process.cwd(), "private", "mesh-session.json");
const MAX_CLOCK_SKEW_MS = Number(process.env.MESH_MAX_CLOCK_SKEW_MS || 24 * 60 * 60 * 1000);
const MAX_PACKET_BYTES = Number(process.env.MESH_MAX_PACKET_BYTES || 1024 * 1024);
const MEDIA_CHUNK_BYTES = Number(process.env.MESH_MEDIA_CHUNK_BYTES || 96 * 1024);
const AUTH_FAIL_WINDOW_MS = 60 * 1000;
const AUTH_FAIL_LIMIT = 5;
const AUTH_RATE_LIMIT_MS = 10 * 60 * 1000;
const TRUSTED_STATUSES = new Set(["TRUSTED", "ACCEPTED"]);
const authFailures = new Map();
const VERIFIED_LAN_STATUS = "VERIFIED LAN";
const PRIVATE_ROOT = path.join(process.cwd(), "private");
const CYBERDECK_MEDIA_ROOT = path.join(PRIVATE_ROOT, "CyberDeck", "Media");
const MEDIA_DIRS = {
  uploads: path.join(PRIVATE_ROOT, "uploads"),
  photos: path.join(CYBERDECK_MEDIA_ROOT, "CyberDeck Images"),
  videos: path.join(CYBERDECK_MEDIA_ROOT, "CyberDeck Video"),
  audio: path.join(CYBERDECK_MEDIA_ROOT, "CyberDeck Audio"),
  documents: path.join(CYBERDECK_MEDIA_ROOT, "CyberDeck Documents"),
};

let sqliteRuntimeReady = null;

function normalizeSecurityStatus(value) {
  const status = typeof value === "string" ? value.trim() : "";
  return status ? status.slice(0, 64) : VERIFIED_LAN_STATUS;
}

function isDirectCableIp(ip) {
  return DIRECT_CABLE_PREFIXES.some((prefix) => ip.startsWith(prefix));
}

function ensureSqliteRuntime() {
  if (!sqliteRuntimeReady) {
    sqliteRuntimeReady = (async () => {
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
  for (const interfaces of Object.values(os.networkInterfaces())) {
    const hasCableIp = (interfaces || []).some(
      (iface) => !iface.internal && iface.family === "IPv4" && isDirectCableIp(iface.address),
    );
    if (!hasCableIp) continue;
    for (const iface of interfaces || []) {
      if (!iface.internal && iface.mac && iface.mac !== "00:00:00:00:00:00") {
        return iface.mac.replace(/:/g, "").toLowerCase();
      }
    }
  }

  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const iface of interfaces || []) {
      if (!iface.internal && iface.mac && iface.mac !== "00:00:00:00:00:00") {
        return iface.mac.replace(/:/g, "").toLowerCase();
      }
    }
  }
  return `node-${os.hostname().toLowerCase()}`;
}

function getIp() {
  const ips = getLocalIps();
  return ips.find(isDirectCableIp) || ips[0] || "127.0.0.1";
}

function getLocalIps() {
  const ips = [];
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const iface of interfaces || []) {
      if (!iface.internal && iface.family === "IPv4") ips.push(iface.address);
    }
  }
  return ips;
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

function verify(packet, sourceIp) {
  if (isAuthRateLimited(sourceIp)) return null;
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
      trackAuthFail(sourceIp, "decrypt_failed", packet, null);
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
    trackAuthFail(sourceIp, "bad_payload_json", packet, null);
    return null;
  }
  const skewMs = Number.isFinite(data.timestamp) ? Math.abs(Date.now() - data.timestamp) : Number.POSITIVE_INFINITY;
  if (!Number.isFinite(data.timestamp) || skewMs > MAX_CLOCK_SKEW_MS) {
    const skewSeconds = Number.isFinite(skewMs) ? Math.round(skewMs / 1000) : "missing";
    console.error(
      `> [NodeMesh][AUTH] Rejected signed packet: clock skew ${skewSeconds}s exceeds ${Math.round(MAX_CLOCK_SKEW_MS / 1000)}s`,
    );
    trackAuthFail(sourceIp, "clock_skew", packet, skewSeconds);
    return null;
  }
  return data;
}

function normalizeIp(ip) {
  return typeof ip === "string" && ip.startsWith("::ffff:") ? ip.slice(7) : ip;
}

async function sendControl(ip, payload) {
  const packet = JSON.stringify(sign(payload)) + "\n";

  await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: normalizeIp(ip), port: CONTROL_PORT });
    const timeout = setTimeout(() => socket.destroy(new Error("Mesh control timeout")), 5000);

    socket.once("connect", () => socket.end(packet));
    socket.once("error", reject);
    socket.once("close", (hadError) => {
      clearTimeout(timeout);
      if (!hadError) resolve();
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

function contactRequestId(userId, macAddress) {
  return `contact-${crypto.createHash("sha1").update(`${userId}:${macAddress}`).digest("hex")}`;
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

async function ensureRequestPayloadLogged({ requestId, userId, username, macAddress, deviceName, ipAddress, message, securityStatus }) {
  const existing = await db.meshEvent.findFirst({
    where: {
      entityType: "connection_request",
      entityId: requestId,
      operation: "handshake_request_received",
    },
  });
  if (existing) return;

  await recordEvent(macAddress, requestId, "handshake_request_received", {
    type: "HELLO",
    requestId,
    fromNodeId: macAddress,
    fromUserId: userId,
    fromUsername: username,
    fromDeviceName: deviceName,
    fromPublicName: username,
    ipAddress,
    message,
    securityStatus,
  }, macAddress);
}

async function ensurePendingContactRequest({ userId, username, macAddress, deviceName, ipAddress, message, securityStatus }) {
  const requestId = contactRequestId(userId, macAddress);
  const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  const existing = await db.connectionRequest.findUnique({ where: { requestId } });
  if (existing && ["ACCEPTED", "BLOCKED"].includes(existing.status)) return existing;

  if (existing) {
    const request = await db.connectionRequest.update({
      where: { requestId },
      data: {
        status: existing.status === "REJECTED" || existing.status === "DECLINED" ? existing.status : "PENDING",
        message,
        expiresAt,
      },
    });
    await ensureRequestPayloadLogged({ requestId, userId, username, macAddress, deviceName, ipAddress, message, securityStatus });
    return request;
  }

  const request = await db.connectionRequest.create({
    data: {
      requestId,
      fromNodeId: macAddress,
      toNodeId: getMac(),
      direction: "INCOMING",
      status: "PENDING",
      message: message || `${username} wants to connect`,
      expiresAt,
    },
  });
  await ensureRequestPayloadLogged({ requestId, userId, username, macAddress, deviceName, ipAddress, message, securityStatus });
  return request;
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

async function findDirectConversationByNames(firstName, secondName) {
  const server = await db.server.findFirst({ where: { inviteCode: "cyberdeck-default" } });
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
    path.join(MEDIA_DIRS.uploads, filename),
  ];
  const direct = candidates.find((candidate) => fs.existsSync(candidate));
  if (direct) return direct;

  for (const dir of [MEDIA_DIRS.photos, MEDIA_DIRS.videos, MEDIA_DIRS.audio, MEDIA_DIRS.documents]) {
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
    chunkIndex += 1;
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

async function upsertReceivedFileIndex({ storageName, fileName, mimeType, totalSize, fromUsername }) {
  const session = getMeshSession();
  let uploaderId = session?.profileId || "mesh";
  let serverId = "mesh";

  if (session && fromUsername) {
    const found = await findDirectConversationByNames(fromUsername, session.username);
    if (found) {
      uploaderId = found.firstMember.profileId;
      serverId = found.firstMember.serverId;
    }
  }

  const existing = await db.fileIndex.findFirst({ where: { path: storageName } });
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
  if (
    !trustedPeer ||
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

  if (chunkIndex === 0) {
    if (fs.existsSync(tempPath)) {
      const currentSize = (await fs.promises.stat(tempPath)).size;
      if (currentSize >= chunk.length && chunk.length > 0) {
        const existingChunk = await readFileSlice(tempPath, 0, chunk.length);
        if (sha256Buffer(existingChunk) === chunkHash) {
          // Retry from the sender started at chunk 0, but we already have it.
        } else {
          await fs.promises.writeFile(tempPath, chunk);
        }
      } else {
        await fs.promises.writeFile(tempPath, chunk);
      }
    } else {
      await fs.promises.writeFile(tempPath, chunk);
    }
  } else {
    if (!fs.existsSync(tempPath)) {
      console.error(`> [NodeMesh][MEDIA] Missing chunk 0 for ${storageName}; waiting for full retry`);
      return;
    }
    const expectedSize = chunkIndex * MEDIA_CHUNK_BYTES;
    const currentSize = (await fs.promises.stat(tempPath)).size;
    if (currentSize > expectedSize) {
      const existingChunk = await readFileSlice(tempPath, expectedSize, chunk.length);
      if (existingChunk.length === chunk.length && sha256Buffer(existingChunk) === chunkHash) {
        // Already have this chunk from an earlier interrupted transfer.
      } else {
        await fs.promises.unlink(tempPath).catch(() => {});
        console.error(`> [NodeMesh][MEDIA] Existing partial ${storageName} failed chunk hash; restarting on next retry`);
        return;
      }
    } else if (currentSize !== expectedSize) {
      console.error(
        `> [NodeMesh][MEDIA] Out-of-order chunk for ${storageName}: expected ${expectedSize} bytes, found ${currentSize}`,
      );
      return;
    } else {
      await fs.promises.appendFile(tempPath, chunk);
    }
  }

  if (chunkIndex + 1 >= totalChunks) {
    const expectedTotal = Number(data.totalSize);
    if (Number.isFinite(expectedTotal)) {
      const receivedSize = (await fs.promises.stat(tempPath)).size;
      if (receivedSize !== expectedTotal) {
        await fs.promises.unlink(tempPath).catch(() => {});
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
        console.error(`> [NodeMesh][MEDIA] Rejected corrupt ${storageName}: SHA-256 mismatch`);
        return;
      }
    }
    await fs.promises.rename(tempPath, finalPath).catch(async () => {
      await fs.promises.copyFile(tempPath, finalPath);
      await fs.promises.unlink(tempPath).catch(() => {});
    });
    await upsertReceivedFileIndex({
      storageName,
      fileName: data.fileName,
      mimeType: data.mimeType,
      totalSize: data.totalSize,
      fromUsername,
    });
    console.log(`> [NodeMesh][MEDIA] Stored ${storageName} from ${fromUsername}`);
  }
}

async function receiveDirectMessageSync(data, peerIp) {
  const session = getMeshSession();
  if (!session) {
    console.error("> [NodeMesh][AUTH] Rejected direct_message_sync: no local session");
    return;
  }

  const message = data.message || {};
  const fromNodeId = typeof data.fromNodeId === "string" ? data.fromNodeId.trim() : "";
  const fromUserId = typeof data.fromUserId === "string" ? data.fromUserId.trim() : "";
  const fromUsername = typeof data.fromUsername === "string" ? data.fromUsername.trim() : "";
  const toUsername = typeof data.toUsername === "string" ? data.toUsername.trim() : "";
  if (!fromUsername || !toUsername || toUsername !== session.username) {
    console.error("> [NodeMesh][AUTH] Rejected direct_message_sync: identity mismatch");
    return;
  }
  if (typeof message.id !== "string" || typeof message.content !== "string") return;

  const trustedPeer = fromNodeId
    ? await db.meshPeer.findUnique({ where: { macAddress: fromNodeId } })
    : null;
  if (
    !trustedPeer ||
    !TRUSTED_STATUSES.has(trustedPeer.status) ||
    trustedPeer.publicName !== fromUsername ||
    (fromUserId && trustedPeer.userId && trustedPeer.userId !== fromUserId)
  ) {
    console.error(`> [NodeMesh][SYNC] Rejected direct_message_sync from unaccepted peer ${fromUsername}`);
    return;
  }

  const found = await findDirectConversationByNames(fromUsername, toUsername);
  if (!found) {
    console.error(`> [NodeMesh][SYNC] Rejected direct_message_sync: missing local profiles for ${fromUsername}/${toUsername}`);
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
        createdAt: message.createdAt ? new Date(message.createdAt) : new Date(),
      },
      include: { member: { include: { profile: true } } },
    });
  }

  ioEmitter?.to(found.conversation.id).emit(`chat:${found.conversation.id}:messages`, stored);
  await sendControl(peerIp, {
    type: "direct_message_ack",
    messageId: message.id,
    fromNodeId: getMac(),
    fromUsername: session.username,
  }).catch(() => {});
  console.log(`> [NodeMesh][SYNC] Stored direct message ${message.id} from ${fromUsername}`);
}

async function receiveDirectMessageAck(data) {
  if (typeof data.messageId !== "string") return;
  await db.directMessage.updateMany({
    where: { id: data.messageId, status: "SENT" },
    data: { status: "DELIVERED", deliveredAt: new Date() },
  });
  const message = await db.directMessage.findUnique({
    where: { id: data.messageId },
    include: { member: { include: { profile: true } } },
  });
  if (message) {
    ioEmitter?.to(message.conversationId).emit(`chat:${message.conversationId}:messages:update`, message);
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

    await sendControl(peerIp, {
      type: "direct_message_sync",
      fromNodeId: context.fromNodeId,
      fromUserId: context.fromUserId,
      fromUsername: context.fromUsername,
      toUsername: peerUsername,
      message: directMessagePayload(message, session.username, peerUsername),
    }).catch((error) => {
      console.error(`> [NodeMesh][SYNC] Failed to send ${message.id}: ${error.message}`);
    });
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

  return candidates.find((peer) => {
    const nameOk = !peer.publicName || peer.publicName === fromUsername;
    const userOk = !fromUserId || !peer.userId || peer.userId === fromUserId;
    return nameOk && userOk;
  }) || null;
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

  ioEmitter?.to(`user:${found.secondMember.profileId}`).emit("call:start", localPayload);
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

  if (event.startsWith("webrtc:") && localPayload.targetId) {
    ioEmitter?.to(localPayload.targetId).emit(event, {
      ...localPayload,
      peerId: localPayload.peerId,
    });
    return;
  }

  if (route.localUserId) {
    ioEmitter?.to(`user:${route.localUserId}`).emit(event, localPayload);
    return;
  }

  if (localPayload.chatId) {
    ioEmitter?.to(localPayload.chatId).emit(event, localPayload);
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

  if (event === "call:start") {
    await receiveCallStartSignal(payload, fromUsername, fromUserId, peerIp, peer);
    return;
  }

  await emitRoutedCallSignal(event, payload, fromUsername, fromUserId, peerIp, peer);
}

async function receiveConnectionRequest(data, peerIp) {
  await ensureSqliteRuntime();
  peerIp = normalizeIp(peerIp);
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
  const requestPayload = { ...data, securityStatus };

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
        status: "PENDING_INCOMING",
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
  if (!request || request.direction !== "OUTGOING" || request.toNodeId !== data.fromNodeId || request.status !== "PENDING") return;

  const peerStatus =
    data.status === "ACCEPTED" ? "TRUSTED" :
    data.status === "BLOCKED" ? "BLOCKED" :
    data.status === "DECLINED" ? "DECLINED" : "UNKNOWN";
  const existingSession = data.status === "ACCEPTED"
    ? await db.peerSession.findFirst({ where: { peerNodeId: data.fromNodeId } })
    : null;
  const securityStatus = normalizeSecurityStatus(data.securityStatus);
  const responsePayload = { ...data, securityStatus };

  await db.connectionRequest.update({
    where: { requestId: data.requestId },
    data: { status: data.status, respondedAt: new Date() },
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
  const server = net.createServer((socket) => {
    let raw = "";
    socket.setTimeout(5000);
    socket.on("data", (chunk) => {
      raw += chunk.toString("utf8");
      if (raw.length > MAX_PACKET_BYTES) socket.destroy();
    });
    socket.on("end", async () => {
      try {
        const sourceIp = normalizeIp(socket.remoteAddress);
        const data = verify(JSON.parse(raw.trim()), sourceIp);
        if (!data) return;
        if (data.type === "connection_request") await receiveConnectionRequest(data, socket.remoteAddress);
        if (data.type === "connection_response") await receiveConnectionResponse(data, socket.remoteAddress);
        if (data.type === "direct_message_sync") await receiveDirectMessageSync(data, socket.remoteAddress);
        if (data.type === "direct_media_chunk") await receiveDirectMediaChunk(data, socket.remoteAddress);
        if (data.type === "direct_message_ack") await receiveDirectMessageAck(data);
        if (data.type === "call_signal") await receiveCallSignal(data, socket.remoteAddress);
      } catch (error) {
        console.error("> [NodeMesh] Rejected control packet:", error.message);
      }
    });
  });
  server.listen(CONTROL_PORT, "0.0.0.0", () => {
    console.log(`> [NodeMesh] Signed TCP control listening on port ${CONTROL_PORT}`);
  });
}

function broadcastAddresses() {
  const addresses = new Set();
  if (DIRECTED_BROADCAST_ADDR) addresses.add(DIRECTED_BROADCAST_ADDR);
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const iface of interfaces || []) {
      if (!iface.internal && iface.family === "IPv4") {
        const ip = iface.address.split(".");
        const mask = iface.netmask.split(".");
        addresses.add(ip.map((part, index) => (Number(part) | (~Number(mask[index]) & 255)).toString()).join("."));
      }
    }
  }
  return addresses;
}

function startMeshDiscovery() {
  const myMac = getMac();
  const udp = dgram.createSocket("udp4");
  let beaconTick = 0;

  udp.on("message", async (message, rinfo) => {
    const sourceIp = normalizeIp(rinfo.address);
    try {
      const data = verify(JSON.parse(message.toString("utf8")), sourceIp);
      if (!data || data.type !== "HELLO" || typeof data.nodeId !== "string" || data.nodeId === myMac) return;
      if (getLocalIps().includes(sourceIp)) return;

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

      if (status === "PENDING_INCOMING") {
        const message = sameUserNewDevice
          ? `${username}'s account is connecting from a new device`
          : `${username} wants to connect`;
        await ensurePendingContactRequest({ userId, username, macAddress, deviceName, ipAddress: sourceIp, message, securityStatus });
      }

      if (TRUSTED_STATUSES.has(peer.status)) {
        syncPendingDirectMessages(username, sourceIp).catch((error) => {
          console.error(`> [NodeMesh][SYNC] Pending sync failed for ${username}: ${error.message}`);
        });
      }
    } catch (error) {
      trackAuthFail(sourceIp, "bad_udp_packet", {}, null);
    }
  });

  udp.bind(BEACON_PORT, () => {
    udp.setBroadcast(true);
    console.log(`> [NodeMesh] Signed UDP discovery listening on port ${BEACON_PORT}`);
  });

  setInterval(() => {
    const session = getMeshSession();
    if (!session) {
      console.error("> [NodeMesh][AUTH] Mesh beacon paused: no logged-in user session");
      return;
    }

    const packet = Buffer.from(JSON.stringify(sign({
      type: "HELLO",
      nodeId: myMac,
      userId: session.profileId,
      username: session.username,
      displayName: session.displayName,
      deviceMac: myMac,
      deviceName: session.deviceName,
      hostname: session.deviceName,
      publicName: session.username,
      securityStatus: VERIFIED_LAN_STATUS,
      dbVersion: "2.0.0",
      vectorClock: { [myMac]: 0 },
      ip: getIp(),
    })));
    beaconTick += 1;
    for (const address of broadcastAddresses()) udp.send(packet, BEACON_PORT, address);
    if (beaconTick >= 3) {
      beaconTick = 0;
      const localIps = new Set(getLocalIps());
      for (const address of PEER_FALLBACK_IPS) {
        if (!localIps.has(address)) udp.send(packet, BEACON_PORT, address);
      }
    }
  }, 5000);

  startControlServer();
}

module.exports = { startMeshDiscovery, getMac };
