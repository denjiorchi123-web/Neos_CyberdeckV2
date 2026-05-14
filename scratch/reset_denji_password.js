const { PrismaClient } = require("@prisma/client");
const crypto = require("crypto");
const db = new PrismaClient();

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 1000, 64, "sha512").toString("hex");
}

async function fixDenji() {
  const targetName = "Denji";
  const newRawPassword = "password123";

  try {
    console.log(`Searching for profiles named "${targetName}"...`);
    
    const profiles = await db.$queryRawUnsafe(
      "SELECT * FROM Profile WHERE name = ?",
      targetName
    );

    if (profiles.length === 0) {
      console.error(`Error: No profiles found with name "${targetName}".`);
      return;
    }

    console.log(`Found ${profiles.length} profiles. Resetting passwords...`);

    for (const profile of profiles) {
      const newHashedPassword = hashPassword(newRawPassword, profile.userId);
      await db.$executeRawUnsafe(
        "UPDATE Profile SET password = ? WHERE id = ?",
        newHashedPassword, profile.id
      );
      console.log(`Updated password for ID: ${profile.userId}`);
    }

    // Optional: Clean up the duplicate if there are two
    if (profiles.length > 1) {
      console.log("Detected duplicate. Removing the extra Denji profile...");
      const extraId = profiles[1].id;
      await db.$executeRawUnsafe("DELETE FROM Profile WHERE id = ?", extraId);
      console.log("Duplicate removed.");
    }

    console.log("------------------------------------------");
    console.log(`SUCCESS: You can now log in as "${targetName}"`);
    console.log(`Password: ${newRawPassword}`);
    console.log("------------------------------------------");

  } catch (err) {
    console.error("Failed to fix profiles:", err);
  } finally {
    await db.$disconnect();
  }
}

fixDenji();
