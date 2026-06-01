"use client";

// ── Offline Message Queue ──────────────────────────────────────────────────────
// Stores outgoing messages in IndexedDB when the server/socket is unreachable.
// The ChatInput component drains this queue on every successful socket reconnect.
// Each entry tracks retry count and last attempt so we don't spam a recovering server.

export interface QueuedMessage {
  id: string;           // client-generated UUID (matches clientMsgId field)
  apiUrl: string;
  query: Record<string, string>;
  content: string;
  fileUrl?: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  thumbnailUrl?: string;
  mediaKey?: string;
  type?: string;
  replyToId?: string;
  queuedAt: number;     // Date.now() when queued
  retryCount: number;
  lastAttempt?: number;
}

const DB_NAME  = "cyberdeck-offline";
const DB_VER   = 1;
const STORE    = "outbox";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("queuedAt", "queuedAt", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

export async function enqueue(msg: QueuedMessage): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(msg);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

export async function dequeue(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

export async function listAll(): Promise<QueuedMessage[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE, "readonly");
    const req   = tx.objectStore(STORE).index("queuedAt").getAll();
    req.onsuccess = () => resolve(req.result as QueuedMessage[]);
    req.onerror   = () => reject(req.error);
  });
}

export async function updateRetry(id: string, count: number): Promise<void> {
  const db  = await openDB();
  const all = await listAll();
  const msg = all.find(m => m.id === id);
  if (!msg) return;
  msg.retryCount  = count;
  msg.lastAttempt = Date.now();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(msg);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

// Drain: attempt to send every queued message in FIFO order.
// Caller provides the send function (returns true on success, false on failure).
export async function drainQueue(
  send: (msg: QueuedMessage) => Promise<boolean>
): Promise<{ sent: number; failed: number }> {
  const queue  = await listAll();
  let sent = 0, failed = 0;

  for (const msg of queue) {
    // Skip messages that failed recently (exponential back-off: 2^n seconds, max 60s)
    const backOff = Math.min(60, Math.pow(2, msg.retryCount)) * 1000;
    if (msg.lastAttempt && Date.now() - msg.lastAttempt < backOff) {
      failed++;
      continue;
    }

    const ok = await send(msg);
    if (ok) {
      await dequeue(msg.id);
      sent++;
    } else {
      await updateRetry(msg.id, msg.retryCount + 1);
      failed++;
    }
  }

  return { sent, failed };
}
