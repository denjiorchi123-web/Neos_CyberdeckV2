import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { currentProfile } from "@/lib/current-profile";

const configPath = path.join(process.cwd(), "mesh_config.json");

export async function GET() {
  const profile = await currentProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
    const profile = await currentProfile();
    if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    fs.writeFileSync(configPath, JSON.stringify(body, null, 2));
    
    return NextResponse.json({ success: true, restartRequired: true });
  } catch (error) {
    return NextResponse.json({ error: "Failed to write config" }, { status: 500 });
  }
}
