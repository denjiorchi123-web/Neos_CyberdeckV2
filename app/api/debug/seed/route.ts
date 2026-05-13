import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import * as crypto from "crypto";
import { v4 as uuidv4 } from "uuid";

function hashPassword(password: string, salt: string) {
  return crypto.pbkdf2Sync(password, salt, 1000, 64, "sha512").toString("hex");
}

export async function GET() {
  try {
    console.log("Forcing schema update via Raw SQL...");
    
    // Attempt to add the password column if it's missing
    try {
      await db.$executeRawUnsafe(`ALTER TABLE Profile ADD COLUMN password TEXT DEFAULT ''`);
      await db.$executeRawUnsafe(`ALTER TABLE DirectMessage ADD COLUMN status TEXT DEFAULT 'SENT'`);
      await db.$executeRawUnsafe(`ALTER TABLE Message ADD COLUMN status TEXT DEFAULT 'SENT'`);
      console.log("Updated schema columns successfully.");
    } catch (e) {
      console.log("Columns might already exist or table is locked.");
    }

    try {
      await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS CallHistory (
        id TEXT PRIMARY KEY,
        callerId TEXT,
        calleeId TEXT,
        channelId TEXT,
        type TEXT DEFAULT 'audio',
        roomId TEXT,
        duration INTEGER DEFAULT 0,
        status TEXT DEFAULT 'ended',
        startedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        endedAt DATETIME,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);
      console.log("Created CallHistory table.");
    } catch (e) {}

    try {
      await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS FileIndex (
        id TEXT PRIMARY KEY,
        name TEXT,
        path TEXT,
        size INTEGER DEFAULT 0,
        mimeType TEXT DEFAULT 'application/octet-stream',
        uploaderId TEXT,
        serverId TEXT,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);
      console.log("Created FileIndex table.");
    } catch (e) {}

    console.log("Cleaning up database...");
    await db.$executeRawUnsafe(`DELETE FROM FileIndex`);
    await db.$executeRawUnsafe(`DELETE FROM CallHistory`);
    await db.$executeRawUnsafe(`DELETE FROM DirectMessage`);
    await db.$executeRawUnsafe(`DELETE FROM Message`);
    await db.$executeRawUnsafe(`DELETE FROM Channel`);
    await db.$executeRawUnsafe(`DELETE FROM Member`);
    await db.$executeRawUnsafe(`DELETE FROM Server`);
    await db.$executeRawUnsafe(`DELETE FROM Profile`);

    console.log("Seeding profiles...");

    const seedProfiles = [
      { name: "Cyber Admin", email: "admin@cyberdeck.local", userId: "user_admin", imageUrl: "https://avatar.vercel.sh/admin" },
      { name: "Satoshi", email: "satoshi@bitcoin.org", userId: "user_satoshi", imageUrl: "https://avatar.vercel.sh/satoshi" },
      { name: "Trinity", email: "trinity@matrix.io", userId: "user_trinity", imageUrl: "https://avatar.vercel.sh/trinity" },
      { name: "Neo", email: "neo@theone.com", userId: "user_neo", imageUrl: "https://avatar.vercel.sh/neo" },
      { name: "Morpheus", email: "morpheus@neb.com", userId: "user_morpheus", imageUrl: "https://avatar.vercel.sh/morpheus" },
      { name: "Agent Smith", email: "smith@matrix.system", userId: "user_smith", imageUrl: "https://avatar.vercel.sh/smith" },
    ];

    const profileIds: string[] = [];
    for (const p of seedProfiles) {
      const id = uuidv4();
      const hashedPassword = hashPassword("password123", p.userId);
      
      await db.$executeRawUnsafe(
        `INSERT INTO Profile (id, userId, name, imageUrl, email, password, createdAt, updatedAt) 
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        id, p.userId, p.name, p.imageUrl, p.email, hashedPassword
      );
      profileIds.push(id);
    }

    console.log("Creating default server...");
    const adminId = profileIds[0];
    const serverId = uuidv4();
    
    await db.$executeRawUnsafe(
      `INSERT INTO Server (id, name, imageUrl, inviteCode, profileId, createdAt, updatedAt) 
       VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      serverId, "CyberDeck Main", "https://avatar.vercel.sh/cyberdeck-main", "cyberdeck-default", adminId
    );

    const channels = ["general", "announcements", "voice-hq"];
    for (const channelName of channels) {
      await db.$executeRawUnsafe(
        `INSERT INTO Channel (id, name, type, profileId, serverId, createdAt, updatedAt) 
         VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        uuidv4(), channelName, channelName === "voice-hq" ? "AUDIO" : "TEXT", adminId, serverId
      );
    }

    for (const pid of profileIds) {
      await db.$executeRawUnsafe(
        `INSERT INTO Member (id, role, profileId, serverId, createdAt, updatedAt) 
         VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`,
        uuidv4(), pid === adminId ? "ADMIN" : "GUEST", pid, serverId
      );
    }

    return NextResponse.json({ success: true, message: "Database forced update and seeded successfully" });
  } catch (error) {
    console.error("[FORCE_SEED_ERROR]", error);
    return new NextResponse(`Force Seed failed: ${error}`, { status: 500 });
  }
}
