const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    const deleted = await prisma.community.delete({
      where: { id: 'f0d4b5fb-73de-4dae-96cd-41ab51365cd0' }
    });
    console.log("Deleted Community:", deleted);
  } catch (e) {
    console.error("Error deleting Community:", e);
  }

  try {
    const deletedBC = await prisma.broadcastChannel.delete({
      where: { id: '8d9e6f0b-6f2e-413f-892b-f3a71f66e40b' }
    });
    console.log("Deleted Broadcast Channel:", deletedBC);
  } catch (e) {
    console.error("Error deleting Broadcast Channel:", e);
  }
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
