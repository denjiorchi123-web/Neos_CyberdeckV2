import { NextRequest, NextResponse } from "next/server";
import { readFileSync, writeFileSync, statSync } from "fs";
import { currentProfile } from "@/lib/current-profile";
import { resolveFileManagerPath } from "@/lib/file-manager-path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_EDIT_SIZE = 2 * 1024 * 1024; // 2 MB — above this we refuse to load into editor

// GET — read file as text
export async function GET(req: NextRequest) {
  const profile = await currentProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const path = resolveFileManagerPath(req.nextUrl.searchParams.get("path"));
  if (!path) return NextResponse.json({ error: "Invalid path" }, { status: 400 });

  try {
    const stat = statSync(path);
    if (stat.isDirectory()) return NextResponse.json({ error: "Is a directory" }, { status: 400 });
    if (stat.size > MAX_EDIT_SIZE) {
      return NextResponse.json({ error: `File too large to edit (${(stat.size / 1048576).toFixed(1)} MB > 2 MB)` }, { status: 413 });
    }
    const content = readFileSync(path, "utf-8");
    return NextResponse.json({ path, content, size: stat.size });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.code === "ENOENT" ? 404 : 500 });
  }
}

// PUT — write file content
export async function PUT(req: NextRequest) {
  const profile = await currentProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { path: string; content: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const path = resolveFileManagerPath(body.path ?? null);
  if (!path) return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  if (typeof body.content !== "string") {
    return NextResponse.json({ error: "content must be a string" }, { status: 400 });
  }

  try {
    writeFileSync(path, body.content, "utf-8");
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
