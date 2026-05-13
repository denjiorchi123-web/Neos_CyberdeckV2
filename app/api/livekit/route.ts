import { NextResponse } from "next/server";

// CyberDeck: LiveKit removed — using native WebRTC via Socket.io signaling
export async function GET() {
  return NextResponse.json({
    message: "LiveKit removed. Voice/video uses native WebRTC on LAN."
  });
}
