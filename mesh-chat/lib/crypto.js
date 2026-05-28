const fs = require("fs");
const path = require("path");
const nacl = require("tweetnacl");
const naclUtil = require("tweetnacl-util");
const { DATA_DIR } = require("./db");

const PRIVATE_KEY_FILE = path.join(DATA_DIR, "private.key");
const PUBLIC_KEY_FILE = path.join(DATA_DIR, "public.key");

function ensureKeyDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadOrGenerateKeys() {
  ensureKeyDir();

  if (fs.existsSync(PRIVATE_KEY_FILE) && fs.existsSync(PUBLIC_KEY_FILE)) {
    const secretKey = naclUtil.decodeBase64(fs.readFileSync(PRIVATE_KEY_FILE, "utf8"));
    const publicKey = naclUtil.decodeBase64(fs.readFileSync(PUBLIC_KEY_FILE, "utf8"));
    const keyPair = nacl.box.keyPair.fromSecretKey(secretKey);
    return {
      publicKey: naclUtil.encodeBase64(keyPair.publicKey),
      secretKey: naclUtil.encodeBase64(keyPair.secretKey),
      publicKeyBytes: keyPair.publicKey,
      secretKeyBytes: keyPair.secretKey,
    };
  }

  const keyPair = nacl.box.keyPair();
  const publicKey = naclUtil.encodeBase64(keyPair.publicKey);
  const secretKey = naclUtil.encodeBase64(keyPair.secretKey);

  fs.writeFileSync(PRIVATE_KEY_FILE, secretKey, { encoding: "utf8", mode: 0o600 });
  fs.writeFileSync(PUBLIC_KEY_FILE, publicKey, { encoding: "utf8" });

  return {
    publicKey,
    secretKey,
    publicKeyBytes: keyPair.publicKey,
    secretKeyBytes: keyPair.secretKey,
  };
}

function encryptMessage(content, recipientPublicKeyBase64, senderSecretKeyBytes) {
  const recipientPublicKey = naclUtil.decodeBase64(recipientPublicKeyBase64);
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const messageBytes = naclUtil.decodeUTF8(content);
  const cipher = nacl.box(messageBytes, nonce, recipientPublicKey, senderSecretKeyBytes);

  return {
    cipher: naclUtil.encodeBase64(cipher),
    nonce: naclUtil.encodeBase64(nonce),
  };
}

function decryptMessage(cipherBase64, nonceBase64, senderPublicKeyBase64, recipientSecretKeyBytes) {
  try {
    const cipher = naclUtil.decodeBase64(cipherBase64);
    const nonce = naclUtil.decodeBase64(nonceBase64);
    const senderPublicKey = naclUtil.decodeBase64(senderPublicKeyBase64);
    const opened = nacl.box.open(cipher, nonce, senderPublicKey, recipientSecretKeyBytes);
    if (!opened) return null;
    return naclUtil.encodeUTF8(opened);
  } catch {
    return null;
  }
}

module.exports = {
  loadOrGenerateKeys,
  encryptMessage,
  decryptMessage,
};
