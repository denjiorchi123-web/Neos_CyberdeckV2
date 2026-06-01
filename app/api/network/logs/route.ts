import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export async function GET() {
  try {
    const logPath = path.join(process.cwd(), "mesh.log");
    if (!fs.existsSync(logPath)) {
      return NextResponse.json(["[LOGS] No mesh.log file found yet. Waiting for daemon to initialize..."]);
    }

    const logContent = fs.readFileSync(logPath, "utf-8");
    const lines = logContent.split("\n").filter(Boolean);
    
    // Return the last 50 lines
    const lastLines = lines.slice(-50);
    return NextResponse.json(lastLines);
  } catch (error) {
    console.error("[NETWORK_LOGS_GET] Failed to read mesh.log", error);
    return NextResponse.json({ error: "Failed to read mesh.log file" }, { status: 500 });
  }
}
