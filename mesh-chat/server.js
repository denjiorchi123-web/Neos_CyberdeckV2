require("dotenv").config();

const path = require("path");
const https = require("https");
const express = require("express");
const { Server } = require("socket.io");
const { io: ioClient } = require("socket.io-client");
const { v4: uuidv4 } = require("uuid");

const { loadOrGenerateKeys } = require("./lib/crypto");
const { loadOrGenerateSslCredentials } = require("./lib/ssl");
const {
  initDatabases,
  upsertLocalNode,
  getAllNodes,
  loginOrCreateUser,
  syncRemoteUser,
  getAllUsers,
  getUserById,
  createDmChat,
  createGroupChat,
  getChatsForUser,
  getChatMembers,
  getMessagesForChat,
} = require("./lib/db");
const { createDiscoveryService } = require("./services/discovery");
const { createHeartbeatService } = require("./services/heartbeat");
const { createRouterService } = require("./services/router");
const { createOutboxService } = require("./services/outbox");

const config = {
  NODE_ID: process.env.NODE_ID || "laptop-a",
  NODE_NAME: process.env.NODE_NAME || "Laptop-A",
  MY_IP: process.env.MY_IP || "127.0.0.1",
  PEER_IP: process.env.PEER_IP || "127.0.0.1",
  APP_PORT: Number(process.env.APP_PORT || 3000),
  SOCKET_PORT: Number(process.env.SOCKET_PORT || 3001),
  DISCOVERY_PORT: Number(process.env.DISCOVERY_PORT || 3002),
};

let keys;
let browserIo;
let meshIo;
let meshClient = null;
let meshConnected = false;
let peerNodeId = null;
let router;
let outbox;
let heartbeat;
let discovery;

const socketUsers = new Map();

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

function serializeNode(row) {
  return {
    id: row.id,
    name: row.name,
    ip: row.ip,
    publicKey: row.public_key,
    isOnline: !!row.is_online,
    lastSeen: row.last_seen,
    hopCount: row.hop_count,
  };
}

function serializeChat(row) {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    createdBy: row.created_by,
    createdAt: row.created_at,
    lastMessage: row.last_message || null,
    lastMessageAt: row.last_message_at || null,
  };
}

function serializeMessage(row) {
  return {
    id: row.id,
    chatId: row.chat_id,
    senderId: row.sender_id,
    content: row.content,
    type: row.type,
    sentAt: row.sent_at,
    delivered: !!row.delivered,
    readStatus: !!row.read_status,
    senderName: row.sender_name,
    senderNode: row.sender_node,
  };
}

function meshSend(envelope) {
  if (meshClient && meshConnected) {
    meshClient.emit("mesh:message", envelope);
    return true;
  }
  return false;
}

function browserEmit(event, data) {
  if (browserIo) browserIo.emit(event, data);
}

function onPeerDiscovered(peer) {
  peerNodeId = peer.nodeId;
  heartbeat.notePeerSeen(peer.nodeId);
  router.rebuildRoutingTable();
  browserEmit("node:online", { nodeId: peer.nodeId, name: peer.name, ip: peer.ip });
  outbox.flushNow();
}

function connectToPeer() {
  const url = `https://${config.PEER_IP}:${config.SOCKET_PORT}`;
  console.log(`[mesh] connecting to peer at ${url}`);

  meshClient = ioClient(url, {
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionDelay: 2000,
    timeout: 10000,
    rejectUnauthorized: false,
  });

  meshClient.on("connect", () => {
    meshConnected = true;
    console.log("[mesh] connected to peer");
    meshClient.emit("mesh:hello", {
      nodeId: config.NODE_ID,
      name: config.NODE_NAME,
      ip: config.MY_IP,
      publicKey: keys.publicKey,
    });
    router.rebuildRoutingTable();
    outbox.flushNow();
  });

  meshClient.on("disconnect", () => {
    meshConnected = false;
    console.log("[mesh] peer disconnected");
  });

  meshClient.on("connect_error", (err) => {
    meshConnected = false;
    console.warn("[mesh] connect error:", err.message);
  });

  meshClient.on("mesh:message", (envelope) => {
    heartbeat.notePeerSeen(envelope.from);
    router.handleIncomingEnvelope(envelope);
  });

  meshClient.on("mesh:hello", (data) => {
    if (data && data.nodeId) {
      peerNodeId = data.nodeId;
      heartbeat.notePeerSeen(data.nodeId);
      router.rebuildRoutingTable();
      browserEmit("node:online", { nodeId: data.nodeId, name: data.name, ip: data.ip });
    }
  });
}

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, "public")));

  app.post("/api/users/login", (req, res) => {
    try {
      const { username } = req.body;
      if (!username || !String(username).trim()) {
        return res.status(400).json({ error: "username required" });
      }
      const user = loginOrCreateUser(config.NODE_ID, String(username).trim());
      router.syncUserToPeer(user);
      res.json({ user: serializeUser(user) });
    } catch (err) {
      console.error("[api] login error:", err);
      res.status(500).json({ error: "login failed" });
    }
  });

  app.get("/api/users", (_req, res) => {
    try {
      const users = getAllUsers().map(serializeUser);
      res.json({ users, localNodeId: config.NODE_ID });
    } catch (err) {
      res.status(500).json({ error: "failed to load users" });
    }
  });

  app.get("/api/chats", (req, res) => {
    try {
      const { userId } = req.query;
      if (!userId) return res.status(400).json({ error: "userId required" });
      const chats = getChatsForUser(userId).map(serializeChat);
      res.json({ chats });
    } catch (err) {
      res.status(500).json({ error: "failed to load chats" });
    }
  });

  app.post("/api/chats", (req, res) => {
    try {
      const { type, userId, memberId, name, memberIds } = req.body;
      if (!userId) return res.status(400).json({ error: "userId required" });

      if (type === "dm") {
        if (!memberId) return res.status(400).json({ error: "memberId required" });
        const chat = createDmChat(userId, memberId);
        return res.json({ chat: serializeChat({ ...chat, last_message: null, last_message_at: null }) });
      }

      if (type === "group") {
        if (!name) return res.status(400).json({ error: "name required" });
        const chat = createGroupChat(name, userId, memberIds || []);
        return res.json({ chat: serializeChat({ ...chat, last_message: null, last_message_at: null }) });
      }

      return res.status(400).json({ error: "invalid chat type" });
    } catch (err) {
      console.error("[api] create chat error:", err);
      res.status(500).json({ error: "failed to create chat" });
    }
  });

  app.get("/api/messages/:chatId", (req, res) => {
    try {
      const messages = getMessagesForChat(req.params.chatId).map(serializeMessage);
      res.json({ messages });
    } catch (err) {
      res.status(500).json({ error: "failed to load messages" });
    }
  });

  app.get("/api/nodes", (_req, res) => {
    try {
      const nodes = getAllNodes().map(serializeNode);
      res.json({
        nodes,
        localNodeId: config.NODE_ID,
        peerConnected: meshConnected,
        pendingOutbox: outbox.getPendingCount(),
      });
    } catch (err) {
      res.status(500).json({ error: "failed to load nodes" });
    }
  });

  app.get("/api/config", (_req, res) => {
    res.json({
      nodeId: config.NODE_ID,
      nodeName: config.NODE_NAME,
      myIp: config.MY_IP,
      appPort: config.APP_PORT,
    });
  });

  return app;
}

function setupBrowserSockets(io) {
  io.on("connection", (socket) => {
    socket.on("user:login", (data) => {
      if (!data || !data.userId) return;
      socketUsers.set(socket.id, data.userId);
      const user = getUserById(data.userId);
      if (user) {
        router.syncUserToPeer(user);
      }
    });

    socket.on("message:send", (data) => {
      try {
        const { chatId, senderId, content, toNodeId } = data;
        if (!chatId || !senderId || !content) return;

        const sender = getUserById(senderId);
        const members = getChatMembers(chatId);
        const hasRemote = members.some((m) => m.node_id !== config.NODE_ID);

        if (!hasRemote) {
          router.routeOutgoingMessage({
            chatId,
            senderId,
            content,
            toNodeId: config.NODE_ID,
            senderName: sender ? sender.display_name : "You",
          });
          return;
        }

        router.routeOutgoingMessage({
          chatId,
          senderId,
          content,
          toNodeId: toNodeId || router.getPeerNodeId(),
          senderName: sender ? sender.display_name : "You",
        });
      } catch (err) {
        console.error("[socket] message:send error:", err);
      }
    });

    socket.on("disconnect", () => {
      socketUsers.delete(socket.id);
    });
  });
}

function setupMeshSockets(io) {
  io.on("connection", (socket) => {
    socket.on("mesh:hello", (data) => {
      if (data && data.nodeId) {
        peerNodeId = data.nodeId;
        heartbeat.notePeerSeen(data.nodeId);
        router.rebuildRoutingTable();
        browserEmit("node:online", { nodeId: data.nodeId, name: data.name, ip: data.ip });
        socket.emit("mesh:hello", {
          nodeId: config.NODE_ID,
          name: config.NODE_NAME,
          ip: config.MY_IP,
          publicKey: keys.publicKey,
        });
      }
    });

    socket.on("mesh:message", (envelope) => {
      if (envelope && envelope.from) {
        heartbeat.notePeerSeen(envelope.from);
      }
      router.handleIncomingEnvelope(envelope);
    });
  });
}

async function start() {
  initDatabases();
  keys = loadOrGenerateKeys();
  const ssl = loadOrGenerateSslCredentials(config.MY_IP);
  upsertLocalNode(config, keys.publicKey);

  router = createRouterService(config, keys, meshSend, browserEmit, () => peerNodeId);
  router.rebuildRoutingTable();

  const app = createApp();
  const appServer = https.createServer(ssl, app);

  browserIo = new Server(appServer, {
    cors: { origin: "*" },
  });
  setupBrowserSockets(browserIo);

  const meshServer = https.createServer(ssl);
  meshIo = new Server(meshServer, {
    cors: { origin: "*" },
  });
  setupMeshSockets(meshIo);

  heartbeat = createHeartbeatService(config, {
    onOffline: (nodeId) => {
      router.rebuildRoutingTable();
      browserEmit("node:offline", { nodeId });
    },
    onOnline: (nodeId) => {
      router.rebuildRoutingTable();
      browserEmit("node:online", { nodeId });
      outbox.flushNow();
    },
  });

  outbox = createOutboxService(meshSend, () => meshConnected);

  discovery = createDiscoveryService(config, keys, onPeerDiscovered);

  await discovery.start();
  heartbeat.start();
  outbox.start();

  appServer.listen(config.APP_PORT, config.MY_IP, () => {
    console.log(`✅ CyberDeck [${config.NODE_NAME}] running (HTTPS)`);
    console.log(`   UI:     https://${config.MY_IP}:${config.APP_PORT}`);
    console.log(`   Mesh:   https://${config.MY_IP}:${config.SOCKET_PORT}`);
    console.log(`   Note:   Browser will warn about self-signed cert — click Advanced → Proceed`);
  });

  meshServer.listen(config.SOCKET_PORT, config.MY_IP, () => {
    console.log(`[mesh] server listening on ${config.MY_IP}:${config.SOCKET_PORT}`);
  });

  setTimeout(connectToPeer, 2000);
}

start().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
