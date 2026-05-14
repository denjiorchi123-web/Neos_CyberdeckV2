const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();

async function checkProfiles() {
  try {
    console.log("Fetching all registered profiles...");
    const profiles = await db.$queryRawUnsafe("SELECT name, email, userId FROM Profile");
    
    if (profiles.length === 0) {
      console.log("------------------------------------------");
      console.log("The database is EMPTY. No profiles found.");
      console.log("------------------------------------------");
    } else {
      console.log("------------------------------------------");
      console.log("Profiles found in Database:");
      profiles.forEach((p, i) => {
        console.log(`${i + 1}. Name: "${p.name}" | Email: ${p.email}`);
      });
      console.log("------------------------------------------");
    }
  } catch (err) {
    console.error("Error fetching profiles:", err);
  } finally {
    await db.$disconnect();
  }
}

checkProfiles();
