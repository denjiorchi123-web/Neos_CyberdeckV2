import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import * as crypto from "crypto";
import { db } from "@/lib/db";
import { clearMeshSession, persistMeshSession } from "@/lib/mesh-session";

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
    const profiles: any[] = await db.$queryRawUnsafe(
      `SELECT * FROM Profile WHERE name = ? OR email = ? OR userId = ? LIMIT 1`,
      identifier, identifier, identifier
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

    const cookieStore = cookies();
    cookieStore.set("cyberdeck-user-id", profile.userId, {
      path: "/",
      maxAge: 60 * 60 * 24 * 30, // 30 days
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
