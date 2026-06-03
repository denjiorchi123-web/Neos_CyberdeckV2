const crypto = require("crypto");
const dgram = require("dgram");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const { PrismaClient } = require("@prisma/client");

const db = new PrismaClient();
let ioEmitter = null;
try {
  const Redis = require("ioredis");
  const { Emitter } = require("@socket.io/redis-emitter");
  ioEmitter = new Emitter(new Redis(process.env.REDIS_URL || "redis://127.0.0.1:6379"));
} catch {}
const BEACON_PORT = Number(process.env.MESH_BEACON_PORT || 5005);
const CONTROL_PORT = Number(process.env.MESH_CONTROL_PORT || 5006);
const SECRET = process.env.MESH_SECRET || "GHOSTWIRE_ALPHA_7";
const DIRECTED_BROADCAST_ADDR = process.env.MESH_BROADCAST_ADDR || "192.168.10.255";
const PEER_FALLBACK_IPS = (process.env.MESH_PEER_FALLBACK_IPS || "192.168.10.1,192.168.10.2")
  .split(",")
  .map((ip) => ip.trim())
  .filter(Boolean);
const MESH_SESSION_FILE = process.env.MESH_SESSION_FILE || path.join(process.cwd(), "private", "mesh-session.json");
const MAX_CLOCK_SKEW_MS = Number(process.env.MESH_MAX_CLOCK_SKEW_MS || 24 * 60 * 60 * 1000);
const MAX_PACKET_BYTES = 64 * 1024;

function getMac() {
  for (const interfaces of Object.values(os.networkInterfaces())) {
    const hasCableIp = (interfaces || []).some(
      (iface) => !iface.internal && iface.family === "IPv4" && iface.address.startsWith("192.168.10."),
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
  return ips.find((ip) => ip.startsWith("192.168.10.")) || ips[0] || "127.0.0.1";
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
    return { profileId, userId: session.userId || profileId, username };
  } catch {
    return null;
  }
}

function sign(payload) {
  const body = JSON.stringify({ ...payload, timestamp: Date.now() });
  return { payload: body, sig: crypto.createHmac("sha256", SECRET).update(body).digest("hex") };
}

function verify(packet) {
  if (!packet || typeof packet.payload !== "string" || typeof packet.sig !== "string") return null;
  const expected = crypto.createHmac("sha256", SECRET).update(packet.payload).digest("hex");
  if (packet.sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(packet.sig), Buffer.from(expected))) return null;

  const data = JSON.parse(packet.payload);
  const skewMs = Number.isFinite(data.timestamp) ? Math.abs(Date.now() - data.timestamp) : Number.POSITIVE_INFINITY;
  if (!Number.isFinite(data.timestamp) || skewMs > MAX_CLOCK_SKEW_MS) {
    const skewSeconds = Number.isFinite(skewMs) ? Math.round(skewMs / 1000) : "missing";
    console.error(
      `> [NodeMesh][AUTH] Rejected signed packet: clock skew ${skewSeconds}s exceeds ${Math.round(MAX_CLOCK_SKEW_MS / 1000)}s`,
    );
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

async function receiveDirectMessageSync(data, peerIp) {
  const session = getMeshSession();
  if (!session) {
    console.error("> [NodeMesh][AUTH] Rejected direct_message_sync: no local session");
    return;
  }

  const message = data.message || {};
  const fromUsername = typeof data.fromUsername === "string" ? data.fromUsername.trim() : "";
  const toUsername = typeof data.toUsername === "string" ? data.toUsername.trim() : "";
  if (!fromUsername || !toUsername || toUsername !== session.username) {
    console.error("> [NodeMesh][AUTH] Rejected direct_message_sync: identity mismatch");
    return;
  }
  if (typeof message.id !== "string" || typeof message.content !== "string") return;

  const found = await findDirectConversationByNames(fromUsername, toUsername);
  if (!found) {
    console.error(`> [NodeMesh][SYNC] Rejected direct_message_sync: missing local profiles for ${fromUsername}/${toUsername}`);
    return;
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
    await sendControl(peerIp, {
      type: "direct_message_sync",
      fromNodeId: getMac(),
      fromUsername: session.username,
      toUsername: peerUsername,
      message: directMessagePayload(message, session.username, peerUsername),
    }).catch((error) => {
      console.error(`> [NodeMesh][SYNC] Failed to send ${message.id}: ${error.message}`);
    });
  }
}

async function receiveConnectionRequest(data, peerIp) {
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

  const existingPeer = await db.meshPeer.findUnique({ where: { macAddress: data.fromNodeId } });
  if (existingPeer?.status === "BLOCKED") return;

  const replay = await db.connectionRequest.findUnique({ where: { requestId: data.requestId } });
  if (replay) return;

  await db.$transaction([
    db.meshPeer.upsert({
      where: { macAddress: data.fromNodeId },
      create: {
        macAddress: data.fromNodeId,
        hostname: data.fromDeviceName || data.fromHostname || null,
        publicName: fromUsername,
        ipAddress: peerIp,
        status: "PENDING_INCOMING",
        lastHandshake: new Date(),
      },
      update: {
        hostname: data.fromDeviceName || data.fromHostname || undefined,
        publicName: fromUsername,
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
  await recordEvent(data.fromNodeId, data.requestId, "handshake_request_received", data, data.fromNodeId);
  console.log(`> [NodeMesh] Incoming connection request ${data.requestId} from ${data.fromNodeId}`);
}

async function receiveConnectionResponse(data, peerIp) {
  peerIp = normalizeIp(peerIp);
  const fromUsername = typeof data.fromUsername === "string" ? data.fromUsername.trim() : "";
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

  const operations = [
    db.connectionRequest.update({
      where: { requestId: data.requestId },
      data: { status: data.status, respondedAt: new Date() },
    }),
    db.meshPeer.update({
      where: { macAddress: data.fromNodeId },
      data: {
        status: peerStatus,
        ipAddress: peerIp,
        publicName: fromUsername,
        hostname: data.fromDeviceName || undefined,
        lastHandshake: new Date(),
      },
    }),
    db.meshEvent.create({
      data: {
        originNodeId: data.fromNodeId,
        entityType: "connection_request",
        entityId: data.requestId,
        operation: `handshake_${data.status.toLowerCase()}`,
        payloadJson: JSON.stringify(data),
        receivedFrom: data.fromNodeId,
      },
    }),
  ];

  if (data.status === "ACCEPTED") {
    operations.push(
      existingSession
        ? db.peerSession.update({
            where: { sessionId: existingSession.sessionId },
            data: {
              state: "CONNECTED",
              lastConnected: new Date(),
              transportIp: peerIp,
              transportPort: CONTROL_PORT,
            },
          })
        : db.peerSession.create({
            data: {
              peerNodeId: data.fromNodeId,
              state: "CONNECTED",
              lastConnected: new Date(),
              transportIp: peerIp,
              transportPort: CONTROL_PORT,
            },
          }),
      db.syncState.upsert({
        where: { peerNodeId: data.fromNodeId },
        update: {},
        create: { peerNodeId: data.fromNodeId },
      }),
    );
  }

  await db.$transaction(operations);
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
        const data = verify(JSON.parse(raw.trim()));
        if (!data) return;
        if (data.type === "connection_request") await receiveConnectionRequest(data, socket.remoteAddress);
        if (data.type === "connection_response") await receiveConnectionResponse(data, socket.remoteAddress);
        if (data.type === "direct_message_sync") await receiveDirectMessageSync(data, socket.remoteAddress);
        if (data.type === "direct_message_ack") await receiveDirectMessageAck(data);
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
  const addresses = new Set([DIRECTED_BROADCAST_ADDR]);
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
    try {
      const data = verify(JSON.parse(message.toString("utf8")));
      if (!data || data.type !== "HELLO" || typeof data.nodeId !== "string" || data.nodeId === myMac) return;
      if (getLocalIps().includes(rinfo.address)) return;

      const username = typeof data.username === "string" ? data.username.trim() : "";
      const userId = typeof data.userId === "string" ? data.userId.trim() : "";
      if (!username || !userId) {
        console.error(`> [NodeMesh][AUTH] Rejected HELLO from ${rinfo.address}: missing_username`);
        return;
      }

      const peer = await db.meshPeer.upsert({
        where: { macAddress: data.nodeId },
        create: {
          macAddress: data.nodeId,
          hostname: data.deviceName || data.hostname || null,
          publicName: username,
          ipAddress: rinfo.address,
          status: "UNKNOWN",
        },
        update: {
          hostname: data.deviceName || data.hostname || undefined,
          publicName: username,
          ipAddress: rinfo.address,
          lastSeen: new Date(),
        },
      });

      if (peer.status === "TRUSTED" || peer.status === "ACCEPTED") {
        syncPendingDirectMessages(username, rinfo.address).catch((error) => {
          console.error(`> [NodeMesh][SYNC] Pending sync failed for ${username}: ${error.message}`);
        });
      }
    } catch {}
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
      deviceMac: myMac,
      deviceName: os.hostname(),
      hostname: os.hostname(),
      publicName: session.username,
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
