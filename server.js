const { createServer } = require("https");
const { parse } = require("url");
const next = require("next");
const fs = require("fs");
const path = require("path");
const cluster = require("cluster");
const os = require("os");

// Load SSL certificates
const options = {
  key: fs.readFileSync(path.join(__dirname, "ssl", "server.key")),
  cert: fs.readFileSync(path.join(__dirname, "ssl", "server.cert"))
};

const dev = process.env.NODE_ENV !== "production";

// ── Multi-Core Clustering ────────────────────────────────────
// In a high-traffic community of 5,000+, we utilize every CPU core
// to handle massive encryption and signaling loads simultaneously.
if (cluster.isMaster && !dev) {
  const numCPUs = os.cpus().length;
  console.log(`> CyberDeck OS Cluster: Initializing ${numCPUs} High-Performance Cores...`);
  
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  cluster.on("exit", (worker) => {
    console.log(`> Node core ${worker.process.pid} offline. Re-initializing...`);
    cluster.fork();
  });
} else {
  const app = next({ dev });
  const handle = app.getRequestHandler();

  app.prepare().then(() => {
    createServer(options, (req, res) => {
      const parsedUrl = parse(req.url, true);
      handle(req, res, parsedUrl);
    }).listen(3000, "0.0.0.0", (err) => {
      if (err) throw err;
      if (!cluster.isWorker) {
        console.log("> CyberDeck Single-Core Dev Node: https://localhost:3000");
      } else {
        console.log(`> CyberDeck Worker Core [${process.pid}] online.`);
      }
    });
  });
}
