const fs = require("fs");
const path = require("path");
const selfsigned = require("selfsigned");
const { DATA_DIR } = require("./db");

const SSL_DIR = path.join(DATA_DIR, "ssl");
const KEY_FILE = path.join(SSL_DIR, "server.key");
const CERT_FILE = path.join(SSL_DIR, "server.cert");

function ensureSslDir() {
  if (!fs.existsSync(SSL_DIR)) {
    fs.mkdirSync(SSL_DIR, { recursive: true });
  }
}

function generateSelfSignedCert(commonName) {
  ensureSslDir();
  const attrs = [{ name: "commonName", value: commonName }];
  const pems = selfsigned.generate(attrs, {
    days: 3650,
    keySize: 2048,
    algorithm: "sha256",
  });

  fs.writeFileSync(KEY_FILE, pems.private, { mode: 0o600 });
  fs.writeFileSync(CERT_FILE, pems.cert);

  console.log(`[ssl] generated self-signed certificate for CN=${commonName}`);
  return {
    key: pems.private,
    cert: pems.cert,
  };
}

function loadOrGenerateSslCredentials(commonName) {
  ensureSslDir();

  if (fs.existsSync(KEY_FILE) && fs.existsSync(CERT_FILE)) {
    return {
      key: fs.readFileSync(KEY_FILE, "utf8"),
      cert: fs.readFileSync(CERT_FILE, "utf8"),
    };
  }

  return generateSelfSignedCert(commonName || "cyberdeck.local");
}

module.exports = {
  SSL_DIR,
  loadOrGenerateSslCredentials,
};
