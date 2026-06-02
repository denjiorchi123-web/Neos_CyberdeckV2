import { NextResponse } from "next/server";
import { currentProfile } from "@/lib/current-profile";

export async function POST() {
  const profile = await currentProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return NextResponse.json({
    success: false,
    restartRequired: true,
    message: "Mesh discovery runs inside the Node service. Restart cyberdeck.service to apply transport changes.",
  });
}
