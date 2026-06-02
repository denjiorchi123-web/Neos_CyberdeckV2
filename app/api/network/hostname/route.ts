import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";
import os from "os";
import { currentProfile } from "@/lib/current-profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HOSTNAME_RE = /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/i;

export async function GET() {
  return NextResponse.json({ hostname: os.hostname() });
}

export async function POST(req: NextRequest) {
  const profile = await currentProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (process.platform === "win32") {
    return NextResponse.json(
      { error: "Hostname changes are not supported on Windows dev mode." },
      { status: 400 }
    );
  }

  let body: { hostname: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { hostname } = body;
  if (!hostname || !HOSTNAME_RE.test(hostname)) {
    return NextResponse.json(
      { error: "Hostname must be 2–63 characters, letters/numbers/hyphens only, no leading/trailing hyphen." },
      { status: 400 }
    );
  }

  try {
    execSync(`sudo hostnamectl set-hostname ${hostname}`, { timeout: 5000 });
    return NextResponse.json({ ok: true, hostname });
  } catch (e: any) {
    return NextResponse.json({ error: `Failed: ${e.message}` }, { status: 500 });
  }
}
