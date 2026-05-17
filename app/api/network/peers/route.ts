import { NextRequest, NextResponse } from "next/server";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface StaticPeer {
  name:     string;
  host:     string;
  address?: string;
}

interface PeersFile {
  peers: StaticPeer[];
}

const PEERS_PATH = process.env.CYBERDECK_PEERS_FILE
  || (process.platform === "win32"
      ? join(process.cwd(), "config", "peers.json.example")   // dev fallback
      : "/opt/cyberdeck/peers.json");

function read(): PeersFile {
  try {
    const raw = readFileSync(PEERS_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    // Strip comment keys that exist in the example file
    const peers = (parsed.peers ?? []).filter(
      (p: StaticPeer) => typeof p.host === "string" && p.host.length > 0
    );
    return { peers };
  } catch {
    return { peers: [] };
  }
}

function write(data: PeersFile) {
  writeFileSync(PEERS_PATH, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

// GET — list all static peers
export async function GET() {
  return NextResponse.json(read());
}

// POST — add a peer  { name, host, address? }
export async function POST(req: NextRequest) {
  let body: Partial<StaticPeer>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const host = body.host?.trim();
  const name = body.name?.trim() || host;
  if (!host) return NextResponse.json({ error: "host is required" }, { status: 400 });

  const data = read();
  if (data.peers.some(p => p.host === host)) {
    return NextResponse.json({ error: "Peer already exists" }, { status: 409 });
  }

  const peer: StaticPeer = { name: name!, host };
  if (body.address?.trim()) peer.address = body.address.trim();
  data.peers.push(peer);
  write(data);

  return NextResponse.json({ ok: true, peer });
}

// DELETE — remove a peer by host  ?host=deck-02.local
export async function DELETE(req: NextRequest) {
  const host = req.nextUrl.searchParams.get("host")?.trim();
  if (!host) return NextResponse.json({ error: "host query param required" }, { status: 400 });

  const data    = read();
  const before  = data.peers.length;
  data.peers    = data.peers.filter(p => p.host !== host);

  if (data.peers.length === before) {
    return NextResponse.json({ error: "Peer not found" }, { status: 404 });
  }
  write(data);
  return NextResponse.json({ ok: true });
}

// PATCH — edit an existing peer  { host (key), name?, address? }
export async function PATCH(req: NextRequest) {
  let body: Partial<StaticPeer> & { host: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (!body.host) return NextResponse.json({ error: "host is required" }, { status: 400 });

  const data  = read();
  const index = data.peers.findIndex(p => p.host === body.host);
  if (index === -1) return NextResponse.json({ error: "Peer not found" }, { status: 404 });

  if (body.name)    data.peers[index].name    = body.name.trim();
  if (body.address !== undefined)
                    data.peers[index].address  = body.address?.trim() || undefined;
  write(data);
  return NextResponse.json({ ok: true, peer: data.peers[index] });
}
