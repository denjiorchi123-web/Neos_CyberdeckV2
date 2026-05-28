import { NextResponse } from "next/server";
import { currentProfile } from "@/lib/current-profile";
import { db } from "@/lib/db";

export async function POST(req: Request) {
  try {
    const profile = await currentProfile();
    if (!profile) return new NextResponse("Unauthorized", { status: 401 });

    const { chatId } = await req.json();
    if (!chatId) return new NextResponse("Missing chatId", { status: 400 });

    const archivedChat = await db.archivedChat.create({
      data: {
        profileId: profile.id,
        chatId
      }
    });

    return NextResponse.json(archivedChat);
  } catch (error) {
    console.error("[ARCHIVE_POST]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const profile = await currentProfile();
    if (!profile) return new NextResponse("Unauthorized", { status: 401 });

    const { searchParams } = new URL(req.url);
    const chatId = searchParams.get("chatId");
    
    if (!chatId) return new NextResponse("Missing chatId", { status: 400 });

    const deletedArchive = await db.archivedChat.deleteMany({
      where: {
        profileId: profile.id,
        chatId
      }
    });

    return NextResponse.json(deletedArchive);
  } catch (error) {
    console.error("[ARCHIVE_DELETE]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
