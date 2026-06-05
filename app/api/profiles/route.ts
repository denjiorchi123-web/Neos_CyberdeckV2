import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import * as crypto from "crypto";
import { db } from "@/lib/db";

/**
 * Basic PBKDF2 hashing to avoid external dependencies like bcryptjs
 */
function hashPassword(password: string, salt: string) {
  return crypto.pbkdf2Sync(password, salt, 1000, 64, "sha512").toString("hex");
}

function normalizeProfileName(name: string) {
  return name.trim().replace(/\s+/g, " ");
}

function profileDisplayKey(name: string) {
  return normalizeProfileName(name).toLowerCase();
}

function isMeshContactEmail(email?: string | null) {
  return String(email || "").toLowerCase().endsWith("@mesh.local");
}

function dedupeProfilesForDisplay<T extends { name: string; email?: string | null; createdAt?: Date }>(profiles: T[]) {
  const byName = new Map<string, T>();
  for (const profile of profiles) {
    const key = profileDisplayKey(profile.name);
    const existing = byName.get(key);
    if (!existing) {
      byName.set(key, profile);
      continue;
    }

    const existingIsMesh = isMeshContactEmail(existing.email);
    const currentIsMesh = isMeshContactEmail(profile.email);
    if (existingIsMesh && !currentIsMesh) {
      byName.set(key, profile);
    }
  }
  return Array.from(byName.values());
}

/**
 * GET /api/profiles
 * Returns all profiles.
 */
export async function GET() {
  try {
    const profiles = await db.profile.findMany({
      select: {
        id: true,
        userId: true,
        name: true,
        imageUrl: true,
        email: true,
        isOnline: true,
        lastSeen: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: "desc" }
    });
    return NextResponse.json(dedupeProfilesForDisplay(profiles));
  } catch (error) {
    console.error("[PROFILES_GET]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}

/**
 * POST /api/profiles
 * Creates a new profile with a password.
 */
export async function POST(req: Request) {
  try {
    const { name, email, imageUrl, password } = await req.json();

    if (!name) return new NextResponse("Name is required", { status: 400 });
    if (!password) return new NextResponse("Password is required", { status: 400 });

    const finalName = normalizeProfileName(String(name));
    const finalEmail = String(email || `${finalName.toLowerCase().replace(/\s/g, ".")}@cyberdeck.local`).trim();

    // Check for existing profile
    const existing: any[] = await db.$queryRawUnsafe(
      `SELECT id FROM Profile
       WHERE lower(trim(name)) = lower(trim(?))
          OR lower(trim(email)) = lower(trim(?))
       LIMIT 1`,
      finalName, finalEmail
    );

    if (existing.length > 0) {
      return new NextResponse("Profile with this name or email already exists", { status: 400 });
    }

    const id = uuidv4();
    const userId = `user_${uuidv4().replace(/-/g, "").slice(0, 20)}`;
    const hashedPassword = hashPassword(password, userId);
    const finalImageUrl = imageUrl || "";

    // Use Raw SQL to insert with password field, bypassing Prisma type checks
    await db.$executeRawUnsafe(
      `INSERT INTO Profile (id, userId, name, imageUrl, email, password, createdAt, updatedAt) 
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      id, userId, finalName, finalImageUrl, finalEmail, hashedPassword
    );

    const profile = { id, userId, name: finalName, imageUrl: finalImageUrl, email: finalEmail };

    // Auto-join the default server if it exists
    const defaultServer = await db.server.findFirst({
      where: { inviteCode: "cyberdeck-default" }
    });

    if (defaultServer) {
      await db.member.create({
        data: {
          profileId: id,
          serverId: defaultServer.id,
          role: "GUEST"
        }
      });
    }

    return NextResponse.json(profile);
  } catch (error) {
    console.error("[PROFILES_POST]", error);
    return new NextResponse(`Internal Error: ${error}`, { status: 500 });
  }
}
