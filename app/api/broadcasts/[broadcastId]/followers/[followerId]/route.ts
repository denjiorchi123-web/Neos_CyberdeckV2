import { NextResponse } from "next/server";
import { currentProfile } from "@/lib/current-profile";
import { db } from "@/lib/db";

export async function DELETE(
  req: Request,
  { params }: { params: { broadcastId: string, followerId: string } }
) {
  try {
    const profile = await currentProfile();
    if (!profile) return new NextResponse("Unauthorized", { status: 401 });

    if (!params.broadcastId) return new NextResponse("Broadcast ID Missing", { status: 400 });
    if (!params.followerId) return new NextResponse("Follower ID Missing", { status: 400 });

    const channel = await db.broadcastChannel.update({
      where: {
        id: params.broadcastId,
        profileId: profile.id
      },
      data: {
        followers: {
          deleteMany: {
            id: params.followerId,
            profileId: {
              not: profile.id
            }
          }
        }
      },
      include: {
        followers: {
          include: { profile: true },
          orderBy: { role: "asc" }
        }
      }
    });

    return NextResponse.json(channel);
  } catch (error) {
    console.error("[BROADCAST_FOLLOWER_DELETE]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: { broadcastId: string, followerId: string } }
) {
  try {
    const { role } = await req.json();
    const profile = await currentProfile();

    if (!profile) return new NextResponse("Unauthorized", { status: 401 });
    if (!params.broadcastId) return new NextResponse("Broadcast ID Missing", { status: 400 });
    if (!params.followerId) return new NextResponse("Follower ID Missing", { status: 400 });

    const channel = await db.broadcastChannel.update({
      where: {
        id: params.broadcastId,
        profileId: profile.id
      },
      data: {
        followers: {
          update: {
            where: {
              id: params.followerId,
              profileId: {
                not: profile.id
              }
            },
            data: { role }
          }
        }
      },
      include: {
        followers: {
          include: { profile: true },
          orderBy: { role: "asc" }
        }
      }
    });

    return NextResponse.json(channel);
  } catch (error) {
    console.error("[BROADCAST_FOLLOWER_PATCH]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
