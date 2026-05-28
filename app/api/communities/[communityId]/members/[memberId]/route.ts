import { NextResponse } from "next/server";
import { currentProfile } from "@/lib/current-profile";
import { db } from "@/lib/db";

export async function DELETE(
  req: Request,
  { params }: { params: { communityId: string, memberId: string } }
) {
  try {
    const profile = await currentProfile();
    if (!profile) return new NextResponse("Unauthorized", { status: 401 });

    if (!params.communityId) return new NextResponse("Community ID Missing", { status: 400 });
    if (!params.memberId) return new NextResponse("Member ID Missing", { status: 400 });

    const community = await db.community.update({
      where: {
        id: params.communityId,
        profileId: profile.id
      },
      data: {
        members: {
          deleteMany: {
            id: params.memberId,
            profileId: {
              not: profile.id
            }
          }
        }
      },
      include: {
        members: {
          include: { profile: true },
          orderBy: { role: "asc" }
        }
      }
    });

    return NextResponse.json(community);
  } catch (error) {
    console.error("[COMMUNITY_MEMBER_DELETE]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: { communityId: string, memberId: string } }
) {
  try {
    const { role } = await req.json();
    const profile = await currentProfile();

    if (!profile) return new NextResponse("Unauthorized", { status: 401 });
    if (!params.communityId) return new NextResponse("Community ID Missing", { status: 400 });
    if (!params.memberId) return new NextResponse("Member ID Missing", { status: 400 });

    const community = await db.community.update({
      where: {
        id: params.communityId,
        profileId: profile.id
      },
      data: {
        members: {
          update: {
            where: {
              id: params.memberId,
              profileId: {
                not: profile.id
              }
            },
            data: { role }
          }
        }
      },
      include: {
        members: {
          include: { profile: true },
          orderBy: { role: "asc" }
        }
      }
    });

    return NextResponse.json(community);
  } catch (error) {
    console.error("[COMMUNITY_MEMBER_PATCH]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
