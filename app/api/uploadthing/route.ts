import { NextResponse } from "next/server";

// CyberDeck: UploadThing removed — redirecting to local upload
export async function GET() {
  return NextResponse.json({ message: "Use /api/upload for file uploads" });
}

export async function POST() {
  return NextResponse.json(
    { message: "Use /api/upload for file uploads" },
    { status: 308 }
  );
}
