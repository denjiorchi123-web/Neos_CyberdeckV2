import { NextResponse } from "next/server";
import fs from "fs";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json([
    "[NodeMesh] Signed UDP discovery is active on port 5005.",
    "[NodeMesh] Signed TCP handshake control is active on port 5006.",
    "[NodeMesh] Peer trust decisions are persisted in the local SQLite database."
  ]);
}
