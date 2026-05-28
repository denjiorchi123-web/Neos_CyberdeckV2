import { NextResponse } from "next/server";
import { currentProfile } from "@/lib/current-profile";
import { db } from "@/lib/db";

export async function POST(req: Request) {
  try {
    const profile = await currentProfile();
    if (!profile) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const { name, description, groupIds } = await req.json();

    if (!name) {
      return new NextResponse("Name is required", { status: 400 });
    }

    const community = await db.community.create({
      data: {
        name,
        description,
        profile: { connect: { id: profile.id } },
        groups: {
          connect: (groupIds || []).map((id: string) => ({ id }))
        },
        members: {
          create: [
            {
              profileId: profile.id,
              role: "ADMIN"
            }
          ]
        },
        announcementsChannel: {
          create: {
            name: `${name} Announcements`,
            description: `Official announcements for ${name}`,
            profile: { connect: { id: profile.id } },
            followers: {
              create: [
                {
                  profile: { connect: { id: profile.id } },
                  role: "ADMIN"
                }
              ]
            }
          }
        }
      }
    });

    return NextResponse.json(community);
  } catch (error) {
    console.error("[COMMUNITIES_POST]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
