import { NextResponse } from "next/server";
import { currentProfile } from "@/lib/current-profile";
import { db } from "@/lib/db";

export async function GET(req: Request) {
  try {
    const profile = await currentProfile();

    if (!profile) return new NextResponse("Unauthorized", { status: 401 });

    // Get all servers and their channels where user is a member
    const servers = await db.server.findMany({
      where: {
        members: {
          some: { profileId: profile.id }
        }
      },
      include: {
        channels: true
      }
    });

    const channels = servers.flatMap(server => 
      server.channels.map(channel => ({
        id: channel.id,
        name: `${server.name} > #${channel.name}`,
        type: "channel",
        imageUrl: server.imageUrl,
        serverId: server.id
      }))
    );

    // Get all conversations
    const conversations = await db.conversation.findMany({
      where: {
        OR: [
          { memberOne: { profileId: profile.id } },
          { memberTwo: { profileId: profile.id } }
        ]
      },
      include: {
        memberOne: { include: { profile: true } },
        memberTwo: { include: { profile: true } }
      }
    });

    const dms = conversations.map(conv => {
      const otherMember = conv.memberOne.profileId === profile.id ? conv.memberTwo : conv.memberOne;
      return {
        id: conv.id,
        name: otherMember.profile.name,
        type: "conversation",
        imageUrl: otherMember.profile.imageUrl,
        otherMemberId: otherMember.id // we need memberId for socket queries
      };
    });

    // We can also fetch Communities and Broadcast channels, but let's keep it to normal channels/DMs for now to match the scope
    const destinations = [...channels, ...dms];

    return NextResponse.json(destinations);
  } catch (error) {
    console.error("[FORWARD_DESTINATIONS_GET]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
