import { NextResponse } from "next/server";
import { currentProfile } from "@/lib/current-profile";
import { db } from "@/lib/db";

export async function POST(req: Request) {
  try {
    const profile = await currentProfile();
    if (!profile) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const { name, description } = await req.json();

    if (!name) {
      return new NextResponse("Name is required", { status: 400 });
    }

    const broadcast = await db.broadcastChannel.create({
      data: {
        name,
        description,
        profileId: profile.id,
        followers: {
          create: [
            {
              profileId: profile.id,
              role: "ADMIN"
            }
          ]
        }
      }
    });

    return NextResponse.json(broadcast);
  } catch (error) {
    console.error("[BROADCASTS_POST]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
