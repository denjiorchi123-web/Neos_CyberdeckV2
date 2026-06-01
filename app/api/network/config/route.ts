import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const configPath = path.join(process.cwd(), "mesh_config.json");

export async function GET() {
  try {
    if (fs.existsSync(configPath)) {
      const data = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      return NextResponse.json(data);
    }
    return NextResponse.json({});
  } catch (error) {
    return NextResponse.json({ error: "Failed to read config" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    fs.writeFileSync(configPath, JSON.stringify(body, null, 2));
    
    // Auto-restart the python daemon so changes take effect
    try {
      await fetch("http://127.0.0.1:5007/restart", { method: "POST" }).catch(() => {});
    } catch {}

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "Failed to write config" }, { status: 500 });
  }
}
