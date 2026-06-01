import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { currentProfile } from "@/lib/current-profile";
import { db } from "@/lib/db";
import { redis } from "@/lib/redis";

export async function POST(req: Request) {
  try {
    const profile = await currentProfile();
    const { pin, securityQuestion, securityAnswer } = await req.json();

    if (!profile) return new NextResponse("Unauthorized", { status: 401 });
    if (!pin || pin.length !== 4) return new NextResponse("Invalid PIN", { status: 400 });
    if (!securityQuestion || !securityAnswer) return new NextResponse("Security question and answer required", { status: 400 });

    const salt = await bcrypt.genSalt(10);
    const pinHash = await bcrypt.hash(pin, salt);
    const securityAnswerHash = await bcrypt.hash(securityAnswer.toLowerCase().trim(), salt);

    const updatedProfile = await db.profile.update({
      where: { id: profile.id },
      data: {
        pinHash,
        securityQuestion,
        securityAnswer: securityAnswerHash
      }
    });

    await redis.del(`profile:${profile.userId}`);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[PIN_SETUP_POST]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
