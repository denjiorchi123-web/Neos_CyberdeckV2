const {
  getAllOutbox,
  deleteOutbox,
  incrementOutboxAttempt,
  getAllNodes,
} = require("../lib/db");

function createOutboxService(meshSendFn, isConnectedFn) {
  let flushTimer = null;

  function flush() {
    if (!isConnectedFn || !isConnectedFn()) return;

    const items = getAllOutbox();
    for (const item of items) {
      try {
        const envelope = JSON.parse(item.payload);
        const sent = meshSendFn(envelope);
        if (sent) {
          deleteOutbox(item.id);
        } else {
          incrementOutboxAttempt(item.id);
        }
      } catch (err) {
        console.error("[outbox] flush error:", err.message);
        incrementOutboxAttempt(item.id);
      }
    }
  }

  function start() {
    flushTimer = setInterval(flush, 3000);
    console.log("[outbox] worker started");
  }

  function stop() {
    if (flushTimer) clearInterval(flushTimer);
  }

  function flushNow() {
    flush();
  }

  function getPendingCount() {
    return getAllOutbox().length;
  }

  return { start, stop, flushNow, getPendingCount };
}

module.exports = { createOutboxService };
