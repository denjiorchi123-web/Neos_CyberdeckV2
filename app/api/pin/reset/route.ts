import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { currentProfile } from "@/lib/current-profile";
import { db } from "@/lib/db";
import { redis } from "@/lib/redis";

export async function POST(req: Request) {
  try {
    const profile = await currentProfile();
    const { answer } = await req.json();

    if (!profile) return new NextResponse("Unauthorized", { status: 401 });

    const liveProfile = await db.profile.findUnique({ where: { id: profile.id } });

    if (!liveProfile?.securityAnswer) return new NextResponse("Security question not set up", { status: 400 });
    if (!answer) return new NextResponse("Answer required", { status: 400 });

    const isMatch = await bcrypt.compare(answer.toLowerCase().trim(), liveProfile.securityAnswer);
    
    if (!isMatch) {
      return new NextResponse("Incorrect answer", { status: 403 });
    }

    // Reset PIN
    await db.profile.update({
      where: { id: profile.id },
      data: {
        pinHash: null,
        securityQuestion: null,
        securityAnswer: null
      }
    });

    // Also clear all locked chats for this user since their PIN is gone
    await db.lockedChat.deleteMany({
      where: { profileId: profile.id }
    });

    await redis.del(`profile:${profile.userId}`);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[PIN_RESET_POST]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
