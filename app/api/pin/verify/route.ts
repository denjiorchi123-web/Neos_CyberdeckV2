import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { currentProfile } from "@/lib/current-profile";
import { db } from "@/lib/db";

export async function POST(req: Request) {
  try {
    const profile = await currentProfile();
    const { pin } = await req.json();

    if (!profile) return new NextResponse("Unauthorized", { status: 401 });

    const liveProfile = await db.profile.findUnique({ where: { id: profile.id } });

    if (!liveProfile?.pinHash) return new NextResponse("PIN not set up", { status: 400 });
    if (!pin) return new NextResponse("PIN required", { status: 400 });

    const isMatch = await bcrypt.compare(pin, liveProfile.pinHash);
    
    if (!isMatch) {
      return new NextResponse("Incorrect PIN", { status: 403 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[PIN_VERIFY_POST]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
