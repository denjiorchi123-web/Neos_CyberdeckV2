import { NextResponse } from "next/server";
import os from "os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const root = process.platform === "win32"
    ? os.homedir()
    : (process.env.CYBERDECK_HOME || "/opt/cyberdeck");
  return NextResponse.json({ root });
}
