import { NextResponse } from "next/server";
import { currentProfile } from "@/lib/current-profile";
import { db } from "@/lib/db";

export async function GET() {
  try {
    const profile = await currentProfile();

    if (!profile) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    // Fetch live preferences (Mutes/Blocks) from DB directly to bypass profile cache
    const livePrefs = await db.profile.findUnique({
      where: { id: profile.id },
      include: {
        mutedChats: true,
        blockedUsers: true,
        blockedBy: true,
        lockedChats: true,
      }
    });

    const responseData = {
      ...profile,
      mutedChats: livePrefs?.mutedChats || [],
      blockedUsers: livePrefs?.blockedUsers || [],
      blockedBy: livePrefs?.blockedBy || [],
      lockedChats: livePrefs?.lockedChats || [],
      hasPinEnabled: !!livePrefs?.pinHash,
      securityQuestion: livePrefs?.securityQuestion || null,
    };

    return NextResponse.json(responseData);
  } catch (error) {
    console.error("[AUTH_ME_GET]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
