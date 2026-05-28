const dgram = require("dgram");
const {
  upsertRemoteNode,
  touchNode,
  getAllNodes,
} = require("../lib/db");

function createDiscoveryService(config, keys, onPeerDiscovered) {
  const socket = dgram.createSocket("udp4");
  let announceTimer = null;

  function buildAnnouncePacket() {
    return JSON.stringify({
      type: "ANNOUNCE",
      nodeId: config.NODE_ID,
      name: config.NODE_NAME,
      ip: config.MY_IP,
      publicKey: keys.publicKey,
      timestamp: Date.now(),
    });
  }

  function sendAnnounce() {
    const packet = Buffer.from(buildAnnouncePacket());
    socket.send(packet, config.DISCOVERY_PORT, config.PEER_IP, (err) => {
      if (err) {
        console.error("[discovery] announce failed:", err.message);
      }
    });
  }

  function handlePacket(msg, rinfo) {
    try {
      const data = JSON.parse(msg.toString("utf8"));
      if (data.type !== "ANNOUNCE" || !data.nodeId) return;
      if (data.nodeId === config.NODE_ID) return;

      upsertRemoteNode({
        nodeId: data.nodeId,
        name: data.name,
        ip: data.ip || rinfo.address,
        publicKey: data.publicKey,
        timestamp: data.timestamp,
      });

      if (onPeerDiscovered) {
        onPeerDiscovered({
          nodeId: data.nodeId,
          name: data.name,
          ip: data.ip || rinfo.address,
          publicKey: data.publicKey,
        });
      }
    } catch (err) {
      console.error("[discovery] bad packet:", err.message);
    }
  }

  function start() {
    return new Promise((resolve, reject) => {
      socket.on("error", (err) => {
        console.error("[discovery] socket error:", err.message);
      });

      socket.on("message", handlePacket);

      socket.bind(config.DISCOVERY_PORT, config.MY_IP, () => {
        try {
          socket.setBroadcast(true);
        } catch {
          // direct send only for 2-node setup
        }

        sendAnnounce();
        announceTimer = setInterval(sendAnnounce, 5000);
        console.log(`[discovery] listening on ${config.MY_IP}:${config.DISCOVERY_PORT}`);
        resolve();
      });

      socket.on("error", reject);
    });
  }

  function stop() {
    if (announceTimer) clearInterval(announceTimer);
    socket.close();
  }

  function getKnownNodes() {
    return getAllNodes();
  }

  return { start, stop, sendAnnounce, getKnownNodes };
}

module.exports = { createDiscoveryService };
