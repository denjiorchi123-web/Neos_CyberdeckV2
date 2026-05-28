const { v4: uuidv4 } = require("uuid");
const {
  getAllNodes,
  getRouteTo,
  saveRoutingTable,
  addOutbox,
  getUserById,
  saveMessage,
  markMessageDelivered,
  syncRemoteUser,
  getChatMembers,
} = require("../lib/db");
const { buildRoutingTable } = require("../lib/dijkstra");
const { encryptMessage, decryptMessage } = require("../lib/crypto");

function createRouterService(config, keys, meshSendFn, browserEmitFn, getPeerNodeIdFn) {
  function rebuildRoutingTable() {
    const nodes = getAllNodes();
    const routes = buildRoutingTable(nodes, config.NODE_ID);
    saveRoutingTable(routes);
    return routes;
  }

  function resolvePeerNodeId() {
    if (typeof getPeerNodeIdFn === "function") {
      const id = getPeerNodeIdFn();
      if (id) return id;
    }
    const nodes = getAllNodes();
    const peer = nodes.find((n) => n.id !== config.NODE_ID);
    return peer ? peer.id : null;
  }

  function isPeerOnline() {
    const nodes = getAllNodes();
    const peer = nodes.find((n) => n.id !== config.NODE_ID);
    return peer && Number(peer.is_online) === 1;
  }

  function getPeerNodeId() {
    return resolvePeerNodeId();
  }

  function wrapEnvelope(toNodeId, payload) {
    return {
      from: config.NODE_ID,
      to: toNodeId,
      via: config.NODE_ID,
      hops: 0,
      maxHops: 16,
      msgId: payload.msgId || uuidv4(),
      payload,
    };
  }

  function sendMesh(envelope) {
    if (typeof meshSendFn === "function") {
      return meshSendFn(envelope);
    }
    return false;
  }

  function deliverLocally(messagePayload) {
    const saved = saveMessage({
      id: messagePayload.id,
      chatId: messagePayload.chatId,
      senderId: messagePayload.senderId,
      content: messagePayload.content,
      type: messagePayload.type || "text",
      sentAt: messagePayload.sentAt,
      delivered: 1,
      readStatus: 0,
    });

    if (browserEmitFn) {
      browserEmitFn("message:received", {
        id: saved.id,
        chatId: saved.chat_id,
        senderId: saved.sender_id,
        content: saved.content,
        sentAt: saved.sent_at,
        senderName: messagePayload.senderName,
      });
    }

    return saved;
  }

  function handleIncomingEnvelope(envelope) {
    if (!envelope || !envelope.to) return;

    if (envelope.hops >= envelope.maxHops) {
      console.warn("[router] max hops exceeded for", envelope.msgId);
      return;
    }

    const payload = envelope.payload;

    if (envelope.to === config.NODE_ID) {
      if (payload.type === "message") {
        let content = payload.content;

        if (payload.encrypted && payload.cipher && payload.nonce && payload.senderPublicKey) {
          const decrypted = decryptMessage(
            payload.cipher,
            payload.nonce,
            payload.senderPublicKey,
            keys.secretKeyBytes
          );
          if (decrypted === null) {
            console.error("[router] decrypt failed for", payload.id);
            return;
          }
          content = decrypted;
        }

        deliverLocally({
          id: payload.id,
          chatId: payload.chatId,
          senderId: payload.senderId,
          content,
          type: payload.typeName || "text",
          sentAt: payload.sentAt,
          senderName: payload.senderName,
        });

        if (payload.originNode !== config.NODE_ID) {
          sendMesh({
            from: config.NODE_ID,
            to: envelope.from,
            via: config.NODE_ID,
            hops: 0,
            maxHops: 16,
            msgId: uuidv4(),
            payload: {
              type: "delivery_receipt",
              messageId: payload.id,
            },
          });
        }
      } else if (payload.type === "user_sync") {
        const user = syncRemoteUser(payload.user);
        if (browserEmitFn) {
          browserEmitFn("user:appeared", serializeUser(user));
        }
      } else if (payload.type === "delivery_receipt") {
        markMessageDelivered(payload.messageId);
      }

      return;
    }

    const route = getRouteTo(envelope.to);
    if (!route) {
      console.warn("[router] no route to", envelope.to);
      return;
    }

    const forward = {
      ...envelope,
      via: route.via_node,
      hops: envelope.hops + 1,
    };

    sendMesh(forward);
  }

  function serializeUser(row) {
    if (!row) return null;
    return {
      id: row.id,
      nodeId: row.node_id,
      username: row.username,
      displayName: row.display_name,
      publicKey: row.public_key,
      isLocal: !!row.is_local,
      status: row.status,
      createdAt: row.created_at,
    };
  }

  function routeOutgoingMessage({ chatId, senderId, content, toNodeId, senderName }) {
    const messageId = uuidv4();
    const sentAt = Date.now();

    const localSaved = saveMessage({
      id: messageId,
      chatId,
      senderId,
      content,
      type: "text",
      sentAt,
      delivered: 0,
      readStatus: 0,
    });

    if (browserEmitFn) {
      browserEmitFn("message:received", {
        id: localSaved.id,
        chatId: localSaved.chat_id,
        senderId: localSaved.sender_id,
        content: localSaved.content,
        sentAt: localSaved.sent_at,
        senderName,
      });
    }

    const members = getChatMembers(chatId);
    const recipients = members.filter((m) => m.id !== senderId);

    for (const recipient of recipients) {
      if (recipient.node_id === config.NODE_ID) {
        continue;
      }

      const targetNodeId = recipient.node_id;
      let payload = {
        type: "message",
        id: messageId,
        chatId,
        senderId,
        content,
        typeName: "text",
        sentAt,
        senderName,
        originNode: config.NODE_ID,
        recipientUserId: recipient.id,
      };

      const nodes = getAllNodes();
      const recipientNode = nodes.find((n) => n.id === targetNodeId);
      if (recipientNode && recipientNode.public_key) {
        const encrypted = encryptMessage(
          content,
          recipientNode.public_key,
          keys.secretKeyBytes
        );
        payload = {
          ...payload,
          encrypted: true,
          cipher: encrypted.cipher,
          nonce: encrypted.nonce,
          senderPublicKey: keys.publicKey,
          content: "[encrypted]",
        };
      }

      const envelope = wrapEnvelope(targetNodeId, payload);

      if (!sendMesh(envelope)) {
        addOutbox(targetNodeId, envelope);
      }
    }

    return localSaved;
  }

  function syncUserToPeer(user) {
    const target = resolvePeerNodeId();
    if (!target) return;

    const envelope = wrapEnvelope(target, {
      type: "user_sync",
      user: {
        id: user.id,
        node_id: user.node_id,
        username: user.username,
        display_name: user.display_name,
        public_key: user.public_key,
        status: user.status,
        created_at: user.created_at,
      },
    });

    if (!sendMesh(envelope)) {
      addOutbox(target, envelope);
    }
  }

  return {
    rebuildRoutingTable,
    handleIncomingEnvelope,
    routeOutgoingMessage,
    syncUserToPeer,
    isPeerOnline,
    getPeerNodeId,
    deliverLocally,
    serializeUser,
  };
}

module.exports = { createRouterService };
