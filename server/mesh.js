const crypto = require("crypto");
const dgram = require("dgram");
const net = require("net");
const os = require("os");
const { PrismaClient } = require("@prisma/client");

const db = new PrismaClient();
const BEACON_PORT = Number(process.env.MESH_BEACON_PORT || 5005);
const CONTROL_PORT = Number(process.env.MESH_CONTROL_PORT || 5006);
const SECRET = process.env.MESH_SECRET || "GHOSTWIRE_ALPHA_7";
const MAX_CLOCK_SKEW_MS = 60 * 1000;
const MAX_PACKET_BYTES = 64 * 1024;

function getMac() {
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
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const iface of interfaces || []) {
      if (!iface.internal && iface.family === "IPv4") return iface.address;
    }
  }
  return "127.0.0.1";
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
  if (!Number.isFinite(data.timestamp) || Math.abs(Date.now() - data.timestamp) > MAX_CLOCK_SKEW_MS) return null;
  return data;
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

async function receiveConnectionRequest(data, peerIp) {
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
        hostname: data.fromHostname || `Node-${data.fromNodeId.slice(0, 6)}`,
        publicName: data.fromPublicName || data.fromHostname,
        ipAddress: peerIp,
        status: "PENDING_INCOMING",
        lastHandshake: new Date(),
      },
      update: {
        hostname: data.fromHostname || undefined,
        publicName: data.fromPublicName || undefined,
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

  const operations = [
    db.connectionRequest.update({
      where: { requestId: data.requestId },
      data: { status: data.status, respondedAt: new Date() },
    }),
    db.meshPeer.update({
      where: { macAddress: data.fromNodeId },
      data: { status: peerStatus, ipAddress: peerIp, lastHandshake: new Date() },
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
      db.peerSession.create({
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
  const addresses = new Set(["255.255.255.255"]);
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

  udp.on("message", async (message, rinfo) => {
    try {
      const data = verify(JSON.parse(message.toString("utf8")));
      if (!data || data.type !== "HELLO" || typeof data.nodeId !== "string" || data.nodeId === myMac) return;

      await db.meshPeer.upsert({
        where: { macAddress: data.nodeId },
        create: {
          macAddress: data.nodeId,
          hostname: data.hostname || `Node-${data.nodeId.slice(0, 6)}`,
          publicName: data.publicName || data.hostname,
          ipAddress: rinfo.address,
          status: "UNKNOWN",
        },
        update: {
          hostname: data.hostname || undefined,
          publicName: data.publicName || undefined,
          ipAddress: rinfo.address,
          lastSeen: new Date(),
        },
      });
    } catch {}
  });

  udp.bind(BEACON_PORT, () => {
    udp.setBroadcast(true);
    console.log(`> [NodeMesh] Signed UDP discovery listening on port ${BEACON_PORT}`);
  });

  setInterval(() => {
    const packet = Buffer.from(JSON.stringify(sign({
      type: "HELLO",
      nodeId: myMac,
      hostname: os.hostname(),
      publicName: os.hostname(),
      ip: getIp(),
    })));
    for (const address of broadcastAddresses()) udp.send(packet, BEACON_PORT, address);
  }, 5000);

  startControlServer();
}

module.exports = { startMeshDiscovery, getMac };
