import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    "cyberdeck-chat": [
      { ip: "localhost", port: 3000, last_seen: Math.floor(Date.now()/1000), meta: {} }
    ]
  });
}
