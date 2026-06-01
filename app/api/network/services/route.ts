import { NextResponse } from "next/server";

export async function GET() {
  try {
    const res = await fetch("http://127.0.0.1:5007/services", { 
      cache: "no-store"
    });
    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("[NETWORK_SERVICES_GET]", error);
    return NextResponse.json({ error: "Failed to fetch services from mesh daemon" }, { status: 500 });
  }
}
