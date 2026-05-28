const {
  getAllNodes,
  markNodeOffline,
  touchNode,
} = require("../lib/db");

function createHeartbeatService(config, callbacks) {
  let timer = null;
  const DEAD_MS = 15000;

  function check() {
    const now = Date.now();
    const nodes = getAllNodes();

    for (const node of nodes) {
      if (node.id === config.NODE_ID) continue;

      const lastSeen = Number(node.last_seen) || 0;
      const isOnline = Number(node.is_online) === 1;

      if (now - lastSeen > DEAD_MS) {
        if (isOnline) {
          markNodeOffline(node.id);
          if (callbacks.onOffline) callbacks.onOffline(node.id);
        }
      } else if (!isOnline) {
        touchNode(node.id);
        if (callbacks.onOnline) callbacks.onOnline(node.id);
      }
    }
  }

  function notePeerSeen(nodeId) {
    touchNode(nodeId);
  }

  function start() {
    timer = setInterval(check, 5000);
    console.log("[heartbeat] started (15s dead threshold)");
  }

  function stop() {
    if (timer) clearInterval(timer);
  }

  return { start, stop, notePeerSeen, check };
}

module.exports = { createHeartbeatService };
