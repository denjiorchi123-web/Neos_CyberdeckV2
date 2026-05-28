const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { v4: uuidv4 } = require("uuid");

const DATA_DIR = path.join(__dirname, "..", "data");
const MESSAGES_DB = path.join(DATA_DIR, "messages.db");
const MESH_DB = path.join(DATA_DIR, "mesh.db");

let messagesDb;
let meshDb;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function initMessagesDb() {
  messagesDb = new Database(MESSAGES_DB);
  messagesDb.pragma("journal_mode = WAL");
  messagesDb.pragma("foreign_keys = ON");

  messagesDb.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      node_id TEXT NOT NULL,
      username TEXT NOT NULL,
      display_name TEXT NOT NULL,
      public_key TEXT,
      is_local INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'offline',
      created_at INTEGER NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_node_username
      ON users(node_id, username);

    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT,
      created_by TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS chat_members (
      chat_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      joined_at INTEGER NOT NULL,
      PRIMARY KEY (chat_id, user_id),
      FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      content TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'text',
      sent_at INTEGER NOT NULL,
      delivered INTEGER NOT NULL DEFAULT 0,
      read_status INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
      FOREIGN KEY (sender_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_messages_chat_sent
      ON messages(chat_id, sent_at);
  `);
}

function initMeshDb() {
  meshDb = new Database(MESH_DB);
  meshDb.pragma("journal_mode = WAL");

  meshDb.exec(`
    CREATE TABLE IF NOT EXISTS nodes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      ip TEXT NOT NULL,
      public_key TEXT,
      is_online INTEGER NOT NULL DEFAULT 0,
      last_seen INTEGER NOT NULL DEFAULT 0,
      hop_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS routing (
      destination TEXT PRIMARY KEY,
      via_node TEXT NOT NULL,
      hop_count INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS outbox (
      id TEXT PRIMARY KEY,
      to_node TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0
    );
  `);
}

function initDatabases() {
  ensureDataDir();
  initMessagesDb();
  initMeshDb();
}

function getMessagesDb() {
  return messagesDb;
}

function getMeshDb() {
  return meshDb;
}

function upsertLocalNode(config, publicKey) {
  const now = Date.now();
  meshDb.prepare(`
    INSERT INTO nodes (id, name, ip, public_key, is_online, last_seen, hop_count)
    VALUES (@id, @name, @ip, @publicKey, 1, @now, 0)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      ip = excluded.ip,
      public_key = excluded.public_key,
      is_online = 1,
      last_seen = excluded.last_seen
  `).run({
    id: config.NODE_ID,
    name: config.NODE_NAME,
    ip: config.MY_IP,
    publicKey,
    now,
  });
}

function upsertRemoteNode(node) {
  const now = Date.now();
  meshDb.prepare(`
    INSERT INTO nodes (id, name, ip, public_key, is_online, last_seen, hop_count)
    VALUES (@id, @name, @ip, @publicKey, 1, @now, 1)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      ip = excluded.ip,
      public_key = COALESCE(excluded.public_key, nodes.public_key),
      is_online = 1,
      last_seen = excluded.last_seen,
      hop_count = 1
  `).run({
    id: node.nodeId,
    name: node.name,
    ip: node.ip,
    publicKey: node.publicKey || null,
    now: node.timestamp || now,
  });
}

function getAllNodes() {
  return meshDb.prepare("SELECT * FROM nodes ORDER BY name").all();
}

function getOnlineNodes() {
  return meshDb.prepare("SELECT * FROM nodes WHERE is_online = 1").all();
}

function markNodeOffline(nodeId) {
  meshDb.prepare(`
    UPDATE nodes SET is_online = 0 WHERE id = ?
  `).run(nodeId);
}

function touchNode(nodeId) {
  meshDb.prepare(`
    UPDATE nodes SET is_online = 1, last_seen = ? WHERE id = ?
  `).run(Date.now(), nodeId);
}

function saveRoutingTable(routes) {
  const del = meshDb.prepare("DELETE FROM routing");
  const ins = meshDb.prepare(`
    INSERT INTO routing (destination, via_node, hop_count, updated_at)
    VALUES (@destination, @viaNode, @hopCount, @updatedAt)
  `);
  const tx = meshDb.transaction((rows) => {
    del.run();
    const now = Date.now();
    for (const row of rows) {
      ins.run({
        destination: row.destination,
        viaNode: row.viaNode,
        hopCount: row.hopCount,
        updatedAt: now,
      });
    }
  });
  tx(routes);
}

function getRoutingTable() {
  return meshDb.prepare("SELECT * FROM routing").all();
}

function getRouteTo(destination) {
  return meshDb.prepare(`
    SELECT * FROM routing WHERE destination = ?
  `).get(destination);
}

function addOutbox(toNode, payload) {
  const id = uuidv4();
  meshDb.prepare(`
    INSERT INTO outbox (id, to_node, payload, created_at, attempts)
    VALUES (?, ?, ?, ?, 0)
  `).run(id, toNode, JSON.stringify(payload), Date.now());
  return id;
}

function getOutboxForNode(toNode) {
  return meshDb.prepare(`
    SELECT * FROM outbox WHERE to_node = ? ORDER BY created_at ASC
  `).all(toNode);
}

function getAllOutbox() {
  return meshDb.prepare(`
    SELECT * FROM outbox ORDER BY created_at ASC
  `).all();
}

function deleteOutbox(id) {
  meshDb.prepare("DELETE FROM outbox WHERE id = ?").run(id);
}

function incrementOutboxAttempt(id) {
  meshDb.prepare(`
    UPDATE outbox SET attempts = attempts + 1 WHERE id = ?
  `).run(id);
}

function loginOrCreateUser(nodeId, username) {
  const existing = messagesDb.prepare(`
    SELECT * FROM users WHERE node_id = ? AND username = ?
  `).get(nodeId, username);

  if (existing) {
    messagesDb.prepare(`
      UPDATE users SET status = 'online' WHERE id = ?
    `).run(existing.id);
    return messagesDb.prepare("SELECT * FROM users WHERE id = ?").get(existing.id);
  }

  const id = uuidv4();
  const now = Date.now();
  messagesDb.prepare(`
    INSERT INTO users (id, node_id, username, display_name, public_key, is_local, status, created_at)
    VALUES (?, ?, ?, ?, NULL, 1, 'online', ?)
  `).run(id, nodeId, username, username, now);

  return messagesDb.prepare("SELECT * FROM users WHERE id = ?").get(id);
}

function syncRemoteUser(user) {
  const existing = messagesDb.prepare(`
    SELECT * FROM users WHERE node_id = ? AND username = ?
  `).get(user.node_id, user.username);

  if (existing) {
    messagesDb.prepare(`
      UPDATE users
      SET display_name = ?, public_key = ?, status = ?
      WHERE id = ?
    `).run(user.display_name, user.public_key || null, user.status || "online", existing.id);
    return messagesDb.prepare("SELECT * FROM users WHERE id = ?").get(existing.id);
  }

  const id = user.id || uuidv4();
  messagesDb.prepare(`
    INSERT INTO users (id, node_id, username, display_name, public_key, is_local, status, created_at)
    VALUES (?, ?, ?, ?, ?, 0, ?, ?)
  `).run(
    id,
    user.node_id,
    user.username,
    user.display_name || user.username,
    user.public_key || null,
    user.status || "online",
    user.created_at || Date.now()
  );

  return messagesDb.prepare("SELECT * FROM users WHERE id = ?").get(id);
}

function getAllUsers() {
  return messagesDb.prepare(`
    SELECT * FROM users ORDER BY is_local DESC, display_name ASC
  `).all();
}

function getUserById(id) {
  return messagesDb.prepare("SELECT * FROM users WHERE id = ?").get(id);
}

function findDmChat(userAId, userBId) {
  return messagesDb.prepare(`
    SELECT c.* FROM chats c
    JOIN chat_members m1 ON m1.chat_id = c.id AND m1.user_id = ?
    JOIN chat_members m2 ON m2.chat_id = c.id AND m2.user_id = ?
    WHERE c.type = 'dm'
    LIMIT 1
  `).get(userAId, userBId);
}

function createDmChat(localUserId, remoteUserId) {
  const existing = findDmChat(localUserId, remoteUserId);
  if (existing) return existing;

  const remote = getUserById(remoteUserId);
  const local = getUserById(localUserId);
  const chatId = uuidv4();
  const now = Date.now();
  const name = remote ? `${remote.display_name}` : "Direct Message";

  messagesDb.prepare(`
    INSERT INTO chats (id, type, name, created_by, created_at)
    VALUES (?, 'dm', ?, ?, ?)
  `).run(chatId, name, localUserId, now);

  const addMember = messagesDb.prepare(`
    INSERT INTO chat_members (chat_id, user_id, role, joined_at)
    VALUES (?, ?, 'member', ?)
  `);
  addMember.run(chatId, localUserId, now);
  addMember.run(chatId, remoteUserId, now);

  return messagesDb.prepare("SELECT * FROM chats WHERE id = ?").get(chatId);
}

function createGroupChat(name, creatorId, memberIds) {
  const chatId = uuidv4();
  const now = Date.now();

  messagesDb.prepare(`
    INSERT INTO chats (id, type, name, created_by, created_at)
    VALUES (?, 'group', ?, ?, ?)
  `).run(chatId, name, creatorId, now);

  const addMember = messagesDb.prepare(`
    INSERT INTO chat_members (chat_id, user_id, role, joined_at)
    VALUES (?, ?, ?, ?)
  `);
  addMember.run(chatId, creatorId, "admin", now);
  for (const memberId of memberIds) {
    if (memberId !== creatorId) {
      addMember.run(chatId, memberId, "member", now);
    }
  }

  return messagesDb.prepare("SELECT * FROM chats WHERE id = ?").get(chatId);
}

function getChatsForUser(userId) {
  return messagesDb.prepare(`
    SELECT c.*,
      (
        SELECT content FROM messages m
        WHERE m.chat_id = c.id
        ORDER BY m.sent_at DESC LIMIT 1
      ) AS last_message,
      (
        SELECT sent_at FROM messages m
        WHERE m.chat_id = c.id
        ORDER BY m.sent_at DESC LIMIT 1
      ) AS last_message_at
    FROM chats c
    JOIN chat_members cm ON cm.chat_id = c.id
    WHERE cm.user_id = ?
    ORDER BY COALESCE(last_message_at, c.created_at) DESC
  `).all(userId);
}

function getChatMembers(chatId) {
  return messagesDb.prepare(`
    SELECT u.*, cm.role
    FROM chat_members cm
    JOIN users u ON u.id = cm.user_id
    WHERE cm.chat_id = ?
  `).all(chatId);
}

function saveMessage(message) {
  messagesDb.prepare(`
    INSERT INTO messages (id, chat_id, sender_id, content, type, sent_at, delivered, read_status)
    VALUES (@id, @chatId, @senderId, @content, @type, @sentAt, @delivered, @readStatus)
  `).run(message);
  return messagesDb.prepare("SELECT * FROM messages WHERE id = ?").get(message.id);
}

function getMessagesForChat(chatId) {
  return messagesDb.prepare(`
    SELECT m.*, u.display_name AS sender_name, u.node_id AS sender_node
    FROM messages m
    JOIN users u ON u.id = m.sender_id
    WHERE m.chat_id = ?
    ORDER BY m.sent_at ASC
  `).all(chatId);
}

function markMessageDelivered(messageId) {
  messagesDb.prepare(`
    UPDATE messages SET delivered = 1 WHERE id = ?
  `).run(messageId);
}

module.exports = {
  DATA_DIR,
  initDatabases,
  getMessagesDb,
  getMeshDb,
  upsertLocalNode,
  upsertRemoteNode,
  getAllNodes,
  getOnlineNodes,
  markNodeOffline,
  touchNode,
  saveRoutingTable,
  getRoutingTable,
  getRouteTo,
  addOutbox,
  getOutboxForNode,
  getAllOutbox,
  deleteOutbox,
  incrementOutboxAttempt,
  loginOrCreateUser,
  syncRemoteUser,
  getAllUsers,
  getUserById,
  findDmChat,
  createDmChat,
  createGroupChat,
  getChatsForUser,
  getChatMembers,
  saveMessage,
  getMessagesForChat,
  markMessageDelivered,
};
