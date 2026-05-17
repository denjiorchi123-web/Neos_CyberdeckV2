import { NextResponse } from "next/server";
import { currentProfile } from "@/lib/current-profile";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const profile = await currentProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [messageCount, dmCount, serverCount, callHistory] = await Promise.all([
    db.message.count({ where: { member: { profileId: profile.id }, deleted: false } }),
    db.directMessage.count({ where: { member: { profileId: profile.id }, deleted: false } }),
    db.server.count({ where: { members: { some: { profileId: profile.id } } } }),
    (db as any).callHistory.findMany({
      where: { OR: [{ callerId: profile.id }, { calleeId: profile.id }] },
      orderBy: { startedAt: "desc" },
      take: 20,
    }),
  ]);

  return NextResponse.json({
    profile: {
      id:        profile.id,
      name:      profile.name,
      email:     profile.email,
      imageUrl:  profile.imageUrl,
      createdAt: profile.createdAt,
    },
    stats: {
      messages: messageCount,
      dms:      dmCount,
      servers:  serverCount,
      calls:    callHistory.length,
      missed:   callHistory.filter((c: any) => c.status === "missed").length,
    },
    callHistory,
  });
}
