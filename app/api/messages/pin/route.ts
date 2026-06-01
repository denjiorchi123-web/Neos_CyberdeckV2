import { NextResponse } from "next/server";
import { currentProfile } from "@/lib/current-profile";
import { db } from "@/lib/db";

export async function POST(req: Request) {
  try {
    const profile = await currentProfile();
    const { messageId, isPinned } = await req.json();

    if (!profile) return new NextResponse("Unauthorized", { status: 401 });
    if (!messageId) return new NextResponse("Message ID Missing", { status: 400 });

    const message = await db.message.update({
      where: {
        id: messageId
      },
      data: {
        isPinned
      }
    });

    return NextResponse.json(message);
  } catch (error) {
    console.error("[MESSAGE_PIN_POST]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
