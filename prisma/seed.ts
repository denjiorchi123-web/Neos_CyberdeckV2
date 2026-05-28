import { PrismaClient } from "@prisma/client";
import * as nodeCrypto from "crypto";

const db = new PrismaClient();

function hashPassword(password: string, salt: string) {
  return nodeCrypto.pbkdf2Sync(password, salt, 1000, 64, "sha512").toString("hex");
}

async function main() {
  console.log("Cleaning up database...");
  
  await db.fileIndex.deleteMany();
  await db.callHistory.deleteMany();
  await db.directMessage.deleteMany();
  await db.message.deleteMany();
  await db.channel.deleteMany();
  await db.member.deleteMany();
  await db.server.deleteMany();
  await db.profile.deleteMany();

  console.log("Seeding profiles...");

  const seedProfiles = [
    { name: "Cyber Admin", email: "admin@cyberdeck.local", userId: "user_admin", imageUrl: "" },
    { name: "Satoshi", email: "satoshi@bitcoin.org", userId: "user_satoshi", imageUrl: "" },
    { name: "Trinity", email: "trinity@matrix.io", userId: "user_trinity", imageUrl: "" },
    { name: "Neo", email: "neo@theone.com", userId: "user_neo", imageUrl: "" },
    { name: "Morpheus", email: "morpheus@neb.com", userId: "user_morpheus", imageUrl: "" },
    { name: "Agent Smith", email: "smith@matrix.system", userId: "user_smith", imageUrl: "" },
  ];

  const profiles = [];
  for (const p of seedProfiles) {
    const password = hashPassword("password123", p.userId);
    const profile = await db.profile.create({
      data: {
        ...p,
        password
      }
    });
    profiles.push(profile);
  }

  console.log("Creating default server...");
  const admin = profiles[0];
  const server = await db.server.create({
    data: {
      profileId: admin.id,
      name: "CyberDeck Main",
      imageUrl: "",
      inviteCode: "cyberdeck-default",
      channels: {
        create: [
          { name: "general", profileId: admin.id },
          { name: "announcements", profileId: admin.id },
          { name: "dev-chat", profileId: admin.id },


        ]
      }
    }
  });

  console.log("Adding members to server...");
  for (const profile of profiles) {
    await db.member.create({
      data: {
        profileId: profile.id,
        serverId: server.id,
        role: profile.userId === "user_admin" ? "ADMIN" : "GUEST"
      }
    });
  }

  console.log("Seed successful!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
