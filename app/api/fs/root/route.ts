import { NextResponse } from "next/server";
import { currentProfile } from "@/lib/current-profile";
import { fileManagerRoot } from "@/lib/file-manager-path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const profile = await currentProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return NextResponse.json({ root: fileManagerRoot() });
}
