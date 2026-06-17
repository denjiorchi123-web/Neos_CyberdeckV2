import { NextResponse } from "next/server";
import * as crypto from "crypto";
import { db } from "@/lib/db";

/**
 * Basic PBKDF2 hashing to avoid external dependencies like bcryptjs
 */
function hashPassword(password: string, salt: string) {
  return crypto.pbkdf2Sync(password, salt, 1000, 64, "sha512").toString("hex");
}

/**
 * PATCH /api/auth/reset
 * Resets the password for a given identifier without verification (Local Reset).
 */
export async function PATCH(req: Request) {
  try {
    const { identifier, newPassword } = await req.json();

    if (!identifier || !newPassword) {
      return new NextResponse("Identifier and new password required", { status: 400 });
    }

    const normalizedIdentifier = String(identifier).trim();

    const profiles: any[] = await db.$queryRawUnsafe(
      `SELECT *
       FROM Profile
       WHERE lower(trim(name)) = lower(trim(?))
          OR lower(trim(email)) = lower(trim(?))
          OR userId = ?
       ORDER BY
         CASE WHEN email LIKE '%@mesh.local' THEN 1 ELSE 0 END ASC,
         CASE WHEN password IS NULL OR password = '' THEN 1 ELSE 0 END ASC,
         createdAt ASC
       LIMIT 1`,
      normalizedIdentifier, normalizedIdentifier, normalizedIdentifier
    );

    const profile = profiles[0];

    if (!profile) {
      return new NextResponse("User not found", { status: 404 });
    }

    // Verify password using PBKDF2 (userId is the salt)
    const hashedPassword = hashPassword(newPassword, profile.userId);

    await db.$executeRawUnsafe(
      `UPDATE Profile SET password = ? WHERE id = ?`,
      hashedPassword, profile.id
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[AUTH_RESET_PATCH]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
