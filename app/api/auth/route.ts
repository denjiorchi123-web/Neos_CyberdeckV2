import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import * as crypto from "crypto";
import { db } from "@/lib/db";
import { clearMeshSession, persistMeshSession } from "@/lib/mesh-session";
import { ensureProfileWorkspace } from "@/lib/profile-workspace";

/**
 * Basic PBKDF2 hashing to avoid external dependencies like bcryptjs
 */
function hashPassword(password: string, salt: string) {
  return crypto.pbkdf2Sync(password, salt, 1000, 64, "sha512").toString("hex");
}

/**
 * POST /api/auth
 * Verifies credentials and sets the session cookie.
 */
export async function POST(req: Request) {
  try {
    const { identifier, password } = await req.json();

    if (!identifier || !password) {
      return new NextResponse("Credentials missing", { status: 400 });
    }

    // Use Raw SQL to bypass stale Prisma Client types
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

    // Verify password using PBKDF2
    const hashedPassword = hashPassword(password, profile.userId);

    if (hashedPassword !== profile.password) {
      return new NextResponse("Invalid password", { status: 401 });
    }

    await ensureProfileWorkspace(profile);

    const cookieStore = cookies();
    const expires = new Date(Date.now() + 60 * 60 * 24 * 30 * 1000);
    cookieStore.set("cyberdeck-user-id", profile.userId, {
      path: "/",
      maxAge: 60 * 60 * 24 * 30, // 30 days
      expires,
      httpOnly: true,
      sameSite: "lax",
    });
    persistMeshSession({
      id: profile.id,
      userId: profile.userId,
      name: profile.name,
      imageUrl: profile.imageUrl,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[AUTH_POST]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}

/**
 * DELETE /api/auth
 * Clears the 'cyberdeck-user-id' cookie.
 */
export async function DELETE() {
  const cookieStore = cookies();
  cookieStore.delete("cyberdeck-user-id");
  clearMeshSession();
  return NextResponse.json({ success: true });
}
