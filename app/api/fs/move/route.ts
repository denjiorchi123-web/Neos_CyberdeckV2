import { NextRequest, NextResponse } from "next/server";
import { renameSync, existsSync } from "fs";
import { currentProfile } from "@/lib/current-profile";
import { resolveFileManagerPath } from "@/lib/file-manager-path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { from, to } — rename or move
export async function POST(req: NextRequest) {
  const profile = await currentProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { from: string; to: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const from = resolveFileManagerPath(body.from ?? null);
  const to   = resolveFileManagerPath(body.to   ?? null);
  if (!from || !to) return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  if (!existsSync(from)) return NextResponse.json({ error: "Source not found" }, { status: 404 });
  if (existsSync(to))    return NextResponse.json({ error: "Destination already exists" }, { status: 409 });

  try {
    renameSync(from, to);
    return NextResponse.json({ ok: true, to });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
