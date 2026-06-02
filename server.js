const { createServer } = require("https");
const http = require("http");
const { parse } = require("url");
const next = require("next");
const fs = require("fs");
const path = require("path");
const cluster = require("cluster");
const os = require("os");
const { spawn, execSync } = require("child_process");

// ── Native Node.js Mesh Discovery ──────────────────────────────────────────────
const { startMeshDiscovery } = require("./server/mesh");

// ── Windows: self-elevate to Administrator ───────────────────────────────────
// Network config (netsh) requires admin rights. If not elevated, re-launch
// via PowerShell Start-Process -Verb RunAs which triggers a UAC prompt once.
if (process.platform === "win32") {
  let elevated = false;
  try { execSync("net session", { stdio: "pipe" }); elevated = true; } catch {}
  if (!elevated) {
    const nodeBin  = process.execPath.replace(/\\/g, "\\\\");
    const script   = path.resolve(__dirname, "server.js").replace(/\\/g, "\\\\");
    const projDir  = __dirname.replace(/\\/g, "\\\\");
    const psCmd    =
      `Start-Process '${nodeBin}' -Verb RunAs ` +
      `-ArgumentList '"${script}"' -WorkingDirectory '${projDir}'`;
    console.log("> Requesting Administrator privileges (UAC prompt)…");
    spawn("powershell", ["-NoProfile", "-Command", psCmd], { stdio: "inherit" })
      .on("exit", () => process.exit(0));
    return; // stop the non-elevated process
  }

  // Now we are elevated. Ensure Firewall rules exist for CyberDeck ports.
  try {
    const rules = [
      { name: "CyberDeck Port 3000 TCP", port: 3000, proto: "TCP" },
      { name: "CyberDeck Port 5005 UDP", port: 5005, proto: "UDP" },
      { name: "CyberDeck Port 5006 TCP", port: 5006, proto: "TCP" },
      { name: "CyberDeck Port 5353 UDP", port: 5353, proto: "UDP" }
    ];
    for (const rule of rules) {
      const fwCmd = `New-NetFirewallRule -DisplayName "${rule.name}" -Direction Inbound -LocalPort ${rule.port} -Protocol ${rule.proto} -Action Allow -Profile Any -ErrorAction SilentlyContinue`;
      execSync(`powershell -NoProfile -Command "${fwCmd}"`, { stdio: "ignore" });
    }
    console.log("> Windows Firewall configured for all incoming CyberDeck ports.");
  } catch (err) {
    // Ignore if it already exists or fails
  }
}

// ── Only spawn the daemon once in the primary cluster process
if (cluster.isPrimary) {
  startMeshDiscovery();
}

// Load SSL certificates
const options = {
  key: fs.readFileSync(path.join(__dirname, "ssl", "server.key")),
  cert: fs.readFileSync(path.join(__dirname, "ssl", "server.cert"))
};

const dev = process.env.NODE_ENV !== "production";

// ── Multi-Core Clustering ────────────────────────────────────
// In a high-traffic community of 5,000+, we utilize every CPU core
// to handle massive encryption and signaling loads simultaneously.
// Socket.IO polling sessions need sticky routing before clustered workers are safe.
if (cluster.isPrimary && !dev && process.env.CYBERDECK_CLUSTER === "1") {
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
