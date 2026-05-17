import { NextResponse } from "next/server";
import * as crypto from "crypto";
import { db } from "@/lib/db";
import { currentProfile } from "@/lib/current-profile";

function hashPassword(password: string, salt: string) {
  return crypto.pbkdf2Sync(password, salt, 1000, 64, "sha512").toString("hex");
}

export async function POST(
  req: Request,
  { params }: { params: { profileId: string } }
) {
  const me = await currentProfile();
  if (!me || me.id !== params.profileId) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { currentPassword, newPassword } = await req.json();
  if (!newPassword || newPassword.length < 4) {
    return new NextResponse("New password too short", { status: 400 });
  }

  const row = await db.$queryRawUnsafe<{ password: string; userId: string }[]>(
    `SELECT password, userId FROM Profile WHERE id = ? LIMIT 1`,
    params.profileId
  );
  if (!row.length) return new NextResponse("Not found", { status: 404 });

  const { userId, password: storedHash } = row[0];

  // Verify current password (skip if account has no password set)
  if (storedHash) {
    const check = hashPassword(currentPassword ?? "", userId);
    if (check !== storedHash) {
      return new NextResponse("Current password incorrect", { status: 400 });
    }
  }

  const newHash = hashPassword(newPassword, userId);
  await db.$executeRawUnsafe(
    `UPDATE Profile SET password = ?, updatedAt = datetime('now') WHERE id = ?`,
    newHash, params.profileId
  );

  return NextResponse.json({ ok: true });
}
