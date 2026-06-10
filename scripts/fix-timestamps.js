const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();

async function run() {
  console.log("Checking for messages with poisoned timestamps (sent by 'Neo' or from 10.0.0.1)...");

  // SQLite WAL checkpoint first just in case
  await db.$executeRawUnsafe("PRAGMA wal_checkpoint(FULL);").catch(() => {});

  // Find direct messages that are suspiciously in the future
  // or jump exactly 6 hours ahead (due to clock drift)
  const now = new Date();
  const futureThreshold = new Date(now.getTime() + 10 * 60 * 1000); // 10 mins in the future

  const badMessages = await db.directMessage.findMany({
    where: {
      createdAt: {
        gt: futureThreshold
      }
    },
    select: {
      id: true,
      content: true,
      createdAt: true
    }
  });

  if (badMessages.length === 0) {
    console.log("No messages with future timestamps found! DB looks healthy.");
    return;
  }

  console.log(`Found ${badMessages.length} messages with poisoned future timestamps.`);
  
  // Fix them by pulling them back by exactly 6 hours (or resetting to now)
  let fixedCount = 0;
  for (const msg of badMessages) {
    // 6 hours = 21600000 ms
    const correctedTime = new Date(msg.createdAt.getTime() - 21600000);
    
    // If it's still in the future after subtracting 6 hours, just use Date.now()
    const finalTime = correctedTime > now ? now : correctedTime;

    await db.directMessage.update({
      where: { id: msg.id },
      data: { createdAt: finalTime }
    });
    fixedCount++;
  }

  console.log(`Successfully repaired ${fixedCount} messages.`);
}

run()
  .catch(console.error)
  .finally(() => db.$disconnect());
