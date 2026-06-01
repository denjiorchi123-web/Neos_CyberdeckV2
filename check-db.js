const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const communities = await prisma.community.findMany();
  console.log("Communities:", communities);

  const channels = await prisma.broadcastChannel.findMany();
  console.log("Broadcast Channels:", channels);

  const servers = await prisma.server.findMany();
  console.log("Servers:", servers);
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
