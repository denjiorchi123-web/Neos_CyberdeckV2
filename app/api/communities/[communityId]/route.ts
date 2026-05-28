import { NextResponse } from "next/server";
import { currentProfile } from "@/lib/current-profile";
import { db } from "@/lib/db";

export async function DELETE(
  req: Request,
  { params }: { params: { communityId: string } }
) {
  try {
    const profile = await currentProfile();

    if (!profile) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    if (!params.communityId) {
      return new NextResponse("Community ID missing", { status: 400 });
    }

    const community = await db.community.findUnique({
      where: { id: params.communityId }
    });

    if (!community || community.profileId !== profile.id) {
      return new NextResponse("Unauthorized or Not Found", { status: 401 });
    }

    const deletedCommunity = await db.community.delete({
      where: {
        id: params.communityId
      }
    });

    return NextResponse.json(deletedCommunity);
  } catch (error) {
    console.error("[COMMUNITY_ID_DELETE]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
