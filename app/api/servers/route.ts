import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { MemberRole } from "@/lib/db-enums";

import { currentProfile } from "@/lib/current-profile";
import { db } from "@/lib/db";

export async function POST(req: Request) {
  try {
    const { name, imageUrl, memberIds } = await req.json();
    const profile = await currentProfile();

    if (!profile) return new NextResponse("Unauthorized", { status: 401 });

    const membersData = [{ profileId: profile.id, role: "ADMIN" }];
    if (memberIds && Array.isArray(memberIds)) {
      for (const id of memberIds) {
        if (id !== profile.id) {
          membersData.push({ profileId: id, role: "GUEST" });
        }
      }
    }

    const server = await db.server.create({
      data: {
        profileId: profile.id,
        name,
        imageUrl,
        inviteCode: uuidv4(),
        channels: { create: [{ name: "general", profileId: profile.id }] },
        members: { create: membersData }
      }
    });

    return NextResponse.json(server);
  } catch (error) {
    console.error("[SERVERS_POST]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const profile = await currentProfile();
    if (!profile) return new NextResponse("Unauthorized", { status: 401 });

    const servers = await db.server.findMany({
      where: {
        members: {
          some: {
            profileId: profile.id
          }
        }
      }
    });

    return NextResponse.json(servers);
  } catch (error) {
    console.error("[SERVERS_GET]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
