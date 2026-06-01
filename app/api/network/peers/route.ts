import { NextResponse } from "next/server";

export async function GET() {
  try {
    const res = await fetch("http://127.0.0.1:5007/peers", { 
      cache: "no-store"
    });
    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("[NETWORK_PEERS_GET]", error);
    return NextResponse.json({ error: "Failed to fetch peers from mesh daemon" }, { status: 500 });
  }
}
