import { NextRequest, NextResponse } from "next/server";
import { mkdirSync, writeFileSync, existsSync } from "fs";
import { normalize, sep } from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function resolvePath(raw: string | null): string | null {
  if (!raw) return null;
  const abs = normalize(raw);
  if (abs.includes(".." + sep)) return null;
  return abs;
}

export async function POST(req: NextRequest) {
  let body: { path: string; type: "file" | "dir" };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const path = resolvePath(body.path ?? null);
  if (!path) return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  if (body.type !== "file" && body.type !== "dir") {
    return NextResponse.json({ error: 'type must be "file" or "dir"' }, { status: 400 });
  }
  if (existsSync(path)) {
    return NextResponse.json({ error: "Already exists" }, { status: 409 });
  }

  try {
    if (body.type === "dir") {
      mkdirSync(path, { recursive: true });
    } else {
      writeFileSync(path, "", "utf-8");
    }
    return NextResponse.json({ ok: true, path });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
