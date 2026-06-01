"use client";

// ── Device-Side Encrypted Media Storage ───────────────────────────────────────
// Files received from peers are cached in IndexedDB as AES-GCM encrypted blobs.
// The encryption key travels with the message record (mediaKey field).
// Nothing leaves this device in plaintext — the server only ever stores the
// ciphertext blob; only the sender and recipient can decrypt it.
//
// Usage:
//   const url  = await DeviceStorage.storeMedia(fileUrl, mediaKey, mimeType);
//   // url is a blob: URL the browser can display directly
//   await DeviceStorage.remove(fileUrl);

const DB_NAME    = "cyberdeck-media";
const DB_VER     = 2;
const STORE_BLOB = "blobs";
const STORE_META = "meta";

function openMediaDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      
      // Clear old corrupted cache on upgrade to v2
      if (e.oldVersion < 2) {
        if (db.objectStoreNames.contains(STORE_BLOB)) db.deleteObjectStore(STORE_BLOB);
        if (db.objectStoreNames.contains(STORE_META)) db.deleteObjectStore(STORE_META);
      }

      if (!db.objectStoreNames.contains(STORE_BLOB)) {
        db.createObjectStore(STORE_BLOB, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

// ── Crypto helpers ────────────────────────────────────────────────────────────

/** Convert hex string → Uint8Array */
function hexToBytes(hex: string): Uint8Array {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < arr.length; i++) {
    arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return arr;
}

/** Convert Uint8Array → hex string */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

/** Generate a random 256-bit AES-GCM key, return as hex */
export async function generateMediaKey(): Promise<string> {
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
  const raw = await crypto.subtle.exportKey("raw", key);
  return bytesToHex(new Uint8Array(raw));
}

/** Encrypt an ArrayBuffer with the given hex key. Returns { iv, ciphertext } both as hex. */
export async function encryptMedia(
  data: ArrayBuffer,
  keyHex: string
): Promise<{ ivHex: string; ciphertextHex: string }> {
  const keyBytes = hexToBytes(keyHex);
  const cryptoKey = await crypto.subtle.importKey(
    "raw", keyBytes, { name: "AES-GCM" }, false, ["encrypt"]
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    cryptoKey,
    data
  );
  return {
    ivHex: bytesToHex(iv),
    ciphertextHex: bytesToHex(new Uint8Array(encrypted))
  };
}

/** Decrypt ciphertext (hex) using key (hex) and iv (hex). Returns ArrayBuffer. */
export async function decryptMedia(
  ciphertextHex: string,
  keyHex: string,
  ivHex: string
): Promise<ArrayBuffer> {
  const keyBytes    = hexToBytes(keyHex);
  const iv          = hexToBytes(ivHex);
  const ciphertext  = hexToBytes(ciphertextHex);
  const cryptoKey   = await crypto.subtle.importKey(
    "raw", keyBytes, { name: "AES-GCM" }, false, ["decrypt"]
  );
  return crypto.subtle.decrypt({ name: "AES-GCM", iv }, cryptoKey, ciphertext);
}

// ── Storage operations ────────────────────────────────────────────────────────

interface BlobEntry {
  id: string;            // file server URL — used as stable key
  ivHex: string;
  ciphertextHex: string;
  mimeType: string;
  size: number;
  cachedAt: number;
}

/**
 * Download, encrypt, and cache a remote file URL.
 * Returns a decrypted blob: URL ready for <img src> or <video src>.
 * On subsequent calls, returns from cache without network request.
 */
export async function storeMedia(
  fileUrl: string,
  mediaKey: string,
  mimeType: string
): Promise<string> {
  const db = await openMediaDB();

  // 1. Check cache first
  const existing = await new Promise<BlobEntry | undefined>((resolve, reject) => {
    const tx  = db.transaction(STORE_BLOB, "readonly");
    const req = tx.objectStore(STORE_BLOB).get(fileUrl);
    req.onsuccess = () => resolve(req.result as BlobEntry | undefined);
    req.onerror   = () => reject(req.error);
  });

  if (existing) {
    const plain = await decryptMedia(existing.ciphertextHex, mediaKey, existing.ivHex);
    return URL.createObjectURL(new Blob([plain], { type: existing.mimeType }));
  }

  // 2. Fetch from server
  const response = await fetch(fileUrl, { credentials: "include" });
  if (!response.ok) throw new Error(`[DeviceStorage] fetch ${fileUrl} → ${response.status}`);
  const raw = await response.arrayBuffer();

  // 3. Parse the server's ciphertext
  // The server stores the payload as "ivHex:ciphertextHex" (UTF-8 text)
  const textPayload = new TextDecoder().decode(raw);
  const [ivHex, ciphertextHex] = textPayload.split(":");

  if (!ivHex || !ciphertextHex) {
    throw new Error(`[DeviceStorage] Invalid encrypted payload format for ${fileUrl}`);
  }

  const entry: BlobEntry = {
    id: fileUrl,
    ivHex,
    ciphertextHex,
    mimeType,
    size: raw.byteLength,
    cachedAt: Date.now()
  };

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_BLOB, "readwrite");
    tx.objectStore(STORE_BLOB).put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });

  // 4. Decrypt and return a fresh blob URL
  const plain = await decryptMedia(ciphertextHex, mediaKey, ivHex);
  return URL.createObjectURL(new Blob([plain], { type: mimeType }));
}

/** Remove a cached media entry (e.g. when message is deleted). */
export async function removeMedia(fileUrl: string): Promise<void> {
  const db = await openMediaDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_BLOB, "readwrite");
    tx.objectStore(STORE_BLOB).delete(fileUrl);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

/** Total bytes stored in the media cache. */
export async function cacheSize(): Promise<number> {
  const db = await openMediaDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_BLOB, "readonly");
    const req = tx.objectStore(STORE_BLOB).getAll();
    req.onsuccess = () => {
      const total = (req.result as BlobEntry[]).reduce((s, e) => s + e.size, 0);
      resolve(total);
    };
    req.onerror = () => reject(req.error);
  });
}

/** Clear all cached media (e.g. storage low). */
export async function clearCache(): Promise<void> {
  const db = await openMediaDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_BLOB, "readwrite");
    tx.objectStore(STORE_BLOB).clear();
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}
