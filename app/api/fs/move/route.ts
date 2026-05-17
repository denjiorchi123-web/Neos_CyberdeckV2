import { NextRequest, NextResponse } from "next/server";
import { renameSync, existsSync } from "fs";
import { normalize, sep } from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function resolvePath(raw: string | null): string | null {
  if (!raw) return null;
  const abs = normalize(raw);
  if (abs.includes(".." + sep)) return null;
  return abs;
}

// POST { from, to } — rename or move
export async function POST(req: NextRequest) {
  let body: { from: string; to: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const from = resolvePath(body.from ?? null);
  const to   = resolvePath(body.to   ?? null);
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
