import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { currentProfile } from "@/lib/current-profile";
import { db } from "@/lib/db";
import { redis } from "@/lib/redis";

export async function POST(req: Request) {
  try {
    const profile = await currentProfile();
    const { oldPin, newPin } = await req.json();

    if (!profile) return new NextResponse("Unauthorized", { status: 401 });
    if (!oldPin || oldPin.length !== 4) return new NextResponse("Invalid current PIN", { status: 400 });
    if (!newPin || newPin.length !== 4) return new NextResponse("Invalid new PIN", { status: 400 });

    const liveProfile = await db.profile.findUnique({ where: { id: profile.id } });

    if (!liveProfile?.pinHash) return new NextResponse("PIN not set up", { status: 400 });

    const isMatch = await bcrypt.compare(oldPin, liveProfile.pinHash);
    
    if (!isMatch) {
      return new NextResponse("Incorrect current PIN", { status: 403 });
    }

    const salt = await bcrypt.genSalt(10);
    const newPinHash = await bcrypt.hash(newPin, salt);

    await db.profile.update({
      where: { id: profile.id },
      data: {
        pinHash: newPinHash,
      }
    });

    await redis.del(`profile:${profile.userId}`);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[PIN_CHANGE_POST]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
