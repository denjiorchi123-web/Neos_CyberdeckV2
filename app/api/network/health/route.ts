import { NextResponse } from "next/server";

export async function GET() {
  try {
    const res = await fetch("http://127.0.0.1:5007/health", { 
      cache: "no-store"
    });
    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("[NETWORK_HEALTH_GET]", error);
    return NextResponse.json({ error: "Failed to fetch health from mesh daemon" }, { status: 500 });
  }
}
