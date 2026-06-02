import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentProfile } from "@/lib/current-profile";

/**
 * PATCH /api/profiles/[profileId]
 * Updates a profile.
 */
export async function PATCH(
  req: Request,
  { params }: { params: { profileId: string } }
) {
  try {
    const me = await currentProfile();
    if (!me || me.id !== params.profileId) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const { name, email, imageUrl } = await req.json();

    if (!params.profileId) return new NextResponse("Profile ID missing", { status: 400 });

    const profile = await db.profile.update({
      where: { id: params.profileId },
      data: { name, email, imageUrl }
    });

    return NextResponse.json(profile);
  } catch (error) {
    console.error("[PROFILE_PATCH]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}

/**
 * DELETE /api/profiles/[profileId]
 * Deletes a profile.
 */
export async function DELETE(
  req: Request,
  { params }: { params: { profileId: string } }
) {
  try {
    const me = await currentProfile();
    if (!me || me.id !== params.profileId) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    if (!params.profileId) return new NextResponse("Profile ID missing", { status: 400 });

    const profile = await db.profile.delete({
      where: { id: params.profileId }
    });

    return NextResponse.json(profile);
  } catch (error) {
    console.error("[PROFILE_DELETE]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
