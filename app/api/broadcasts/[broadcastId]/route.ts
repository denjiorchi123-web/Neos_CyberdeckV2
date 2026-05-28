import { NextResponse } from "next/server";
import { currentProfile } from "@/lib/current-profile";
import { db } from "@/lib/db";

export async function DELETE(
  req: Request,
  { params }: { params: { broadcastId: string } }
) {
  try {
    const profile = await currentProfile();

    if (!profile) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    if (!params.broadcastId) {
      return new NextResponse("Broadcast ID missing", { status: 400 });
    }

    const channel = await db.broadcastChannel.findUnique({
      where: { id: params.broadcastId }
    });

    if (!channel || channel.profileId !== profile.id) {
      return new NextResponse("Unauthorized or Not Found", { status: 401 });
    }

    const deletedChannel = await db.broadcastChannel.delete({
      where: {
        id: params.broadcastId
      }
    });

    return NextResponse.json(deletedChannel);
  } catch (error) {
    console.error("[BROADCAST_ID_DELETE]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
