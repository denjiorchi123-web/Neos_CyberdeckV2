import { NextResponse } from "next/server";
import { currentProfile } from "@/lib/current-profile";
import { db } from "@/lib/db";

export async function POST(req: Request) {
  try {
    const profile = await currentProfile();
    const { memberId } = await req.json();

    if (!profile) return new NextResponse("Unauthorized", { status: 401 });
    if (!memberId) return new NextResponse("Member ID Missing", { status: 400 });

    const member = await db.member.findUnique({
      where: { id: memberId },
    });

    if (!member) return new NextResponse("Member Not Found", { status: 404 });

    const blockedProfileId = member.profileId;

    const blockedUser = await db.blockedUser.upsert({
      where: {
        blockerId_blockedId: {
          blockerId: profile.id,
          blockedId: blockedProfileId,
        }
      },
      update: {},
      create: {
        blockerId: profile.id,
        blockedId: blockedProfileId,
      }
    });

    return NextResponse.json(blockedUser);
  } catch (error) {
    console.error("[BLOCK_USER_POST]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const profile = await currentProfile();
    const { searchParams } = new URL(req.url);
    const memberId = searchParams.get("memberId");
    const profileIdQuery = searchParams.get("profileId");

    if (!profile) return new NextResponse("Unauthorized", { status: 401 });
    if (!memberId && !profileIdQuery) return new NextResponse("Member ID or Profile ID Missing", { status: 400 });

    let blockedProfileId = profileIdQuery;

    if (!blockedProfileId && memberId) {
      const member = await db.member.findUnique({
        where: { id: memberId },
      });
      if (!member) return new NextResponse("Member Not Found", { status: 404 });
      blockedProfileId = member.profileId;
    }

    if (!blockedProfileId) return new NextResponse("Profile ID Missing", { status: 400 });

    await db.blockedUser.delete({
      where: {
        blockerId_blockedId: {
          blockerId: profile.id,
          blockedId: blockedProfileId,
        }
      }
    });

    return new NextResponse("Unblocked", { status: 200 });
  } catch (error) {
    console.error("[BLOCK_USER_DELETE]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
