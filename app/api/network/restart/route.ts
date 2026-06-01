import { NextResponse } from "next/server";
import { spawn, execSync } from "child_process";
import path from "path";

export async function POST() {
  try {
    console.log("[NETWORK_RESTART] Nuking zombie python processes...");
    try { 
      if (process.platform === "win32") {
        execSync("taskkill /F /IM python.exe");
      } else {
        execSync("pkill -f mesh_node.py");
      }
    } catch (e) {}
    const res = await fetch("http://127.0.0.1:5007/restart", { 
      cache: "no-store"
    });
    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("[NETWORK_RESTART_POST] Daemon is dead. Force-starting it now...");
    try {
      const pyBin = process.platform === "win32" ? "python" : "python3";
      const scriptPath = path.join(process.cwd(), "scripts", "mesh_node.py");
      
      const meshDaemon = spawn(pyBin, [scriptPath], { 
        detached: true,
        stdio: "ignore" 
      });
      meshDaemon.unref(); // Detach completely

      return NextResponse.json({ success: true, status: "force-started" });
    } catch (spawnError) {
      console.error("[NETWORK_RESTART_POST] Failed to force-start:", spawnError);
      return NextResponse.json({ error: "Failed to start mesh daemon" }, { status: 500 });
    }
  }
}
