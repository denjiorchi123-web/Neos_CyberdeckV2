import { NextResponse } from "next/server";
import { currentProfile } from "@/lib/current-profile";
import { db } from "@/lib/db";

export async function GET(req: Request) {
  try {
    const profile = await currentProfile();
    const { searchParams } = new URL(req.url);
    const query = searchParams.get("q");

    if (!profile) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    if (!query) {
      return new NextResponse("Query missing", { status: 400 });
    }

    // Search Direct Messages
    const directMessages = await db.directMessage.findMany({
      where: {
        OR: [
          {
            conversation: {
              memberOne: { profileId: profile.id }
            }
          },
          {
            conversation: {
              memberTwo: { profileId: profile.id }
            }
          }
        ],
        content: {
          contains: query
        }
      },
      include: {
        member: {
          include: {
            profile: true
          }
        },
        conversation: {
          include: {
            memberOne: { include: { profile: true } },
            memberTwo: { include: { profile: true } }
          }
        }
      },
      orderBy: {
        createdAt: "desc"
      }
    });

    // Search Channel Messages
    const channelMessages = await db.message.findMany({
      where: {
        member: {
          profileId: profile.id
        },
        content: {
          contains: query
        }
      },
      include: {
        member: {
          include: {
            profile: true
          }
        },
        channel: true
      },
      orderBy: {
        createdAt: "desc"
      }
    });

    // Format and combine results
    const results = [
      ...directMessages.map(dm => ({
        id: dm.id,
        content: dm.content,
        timestamp: dm.createdAt,
        type: "direct",
        sender: dm.member.profile.name,
        chatName: dm.conversation.memberOne.profileId === profile.id 
          ? dm.conversation.memberTwo.profile.name 
          : dm.conversation.memberOne.profile.name
      })),
      ...channelMessages.map(m => ({
        id: m.id,
        content: m.content,
        timestamp: m.createdAt,
        type: "channel",
        sender: m.member.profile.name,
        chatName: m.channel.name
      }))
    ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return NextResponse.json(results);
  } catch (error) {
    console.log("[SEARCH_GET]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
