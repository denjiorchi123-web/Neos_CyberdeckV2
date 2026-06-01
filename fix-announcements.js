const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const communities = await prisma.community.findMany({
    where: { announcementsChannelId: null },
    include: { profile: true }
  });

  for (const c of communities) {
    const channel = await prisma.broadcastChannel.create({
      data: {
        name: c.name + ' Announcements',
        description: 'Official announcements for ' + c.name,
        profileId: c.profileId,
        followers: {
          create: [{ profileId: c.profileId, role: 'ADMIN' }]
        }
      }
    });

    await prisma.community.update({
      where: { id: c.id },
      data: { announcementsChannelId: channel.id }
    });

    console.log('Fixed:', c.name);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
