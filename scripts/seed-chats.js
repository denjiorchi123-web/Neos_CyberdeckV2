/**
 * Seeds communities, groups (servers), and broadcast channels for UI testing.
 * Run: npm run seed:test
 * Re-seed: npm run seed:test -- --force
 */
const { PrismaClient } = require("@prisma/client");
const { v4: uuidv4 } = require("uuid");

const db = new PrismaClient();
const FORCE = process.argv.includes("--force");

const IMG = {
  community:
    "https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?q=80&w=400&auto=format&fit=crop",
  group:
    "https://images.unsplash.com/photo-1614729939124-032f0b56c9ce?q=80&w=400&auto=format&fit=crop",
  broadcast:
    "https://images.unsplash.com/photo-1585829365295-ab7cd400c167?q=80&w=400&auto=format&fit=crop",
};

const SEED_COMMUNITIES = [
  {
    name: "Tactical Mesh Alliance",
    description: "Coordinated field mesh networks and ops planning.",
    groups: [
      {
        name: "Field Ops Alpha",
        channels: ["general", "patrol-log"],
        messages: ["Alpha team online.", "Checkpoint 3 clear."],
      },
      {
        name: "Supply Chain",
        channels: ["general", "inventory"],
        messages: ["Battery stock at 72%.", "Requesting spare antennas."],
      },
    ],
    announcements: [
      "Welcome to Tactical Mesh Alliance.",
      "Weekly sync: Friday 1800 UTC.",
    ],
  },
  {
    name: "Off-Grid Builders",
    description: "Hardware mods, solar rigs, and portable comms builds.",
    groups: [
      {
        name: "Hardware Mods",
        channels: ["general", "pcb-design"],
        messages: ["New KiCad footprint pack uploaded.", "Who has the Pi 5 hat pinout?"],
      },
      {
        name: "Power Systems",
        channels: ["general", "solar"],
        messages: ["LiFePO4 pack tested at 12.4V under load."],
      },
    ],
    announcements: ["Off-Grid Builders: share your latest build photos."],
  },
  {
    name: "Signal Corps",
    description: "Encrypted comms, LoRa, and Batman-adv mesh tuning.",
    groups: [
      {
        name: "LoRa Mesh",
        channels: ["general", "lora-mesh"],
        messages: ["Node 7 relay is back online.", "SF9 profile saved for valley link."],
      },
    ],
    announcements: ["Signal Corps channel — post firmware notes here."],
  },
  {
    name: "CyberDeck Labs",
    description: "CyberDeck OS development and air-gapped deployments.",
    groups: [
      {
        name: "OS Development",
        channels: ["general", "dev-chat", "releases"],
        messages: ["Kiosk mode patch merged.", "Testing unified chat sidebar."],
      },
      {
        name: "Field Testing",
        channels: ["general", "bug-reports"],
        messages: ["Pin/unpin works on Pi 5 build.", "Archive tab looks good."],
      },
    ],
    announcements: [
      "CyberDeck Labs announcements — OS updates and release notes.",
      "v0.2 beta images available on the mesh share.",
    ],
  },
];

const STANDALONE_GROUPS = [
  {
    name: "Local Mesh Network Sync",
    channels: ["general", "node-status"],
    messages: ["Mesh heartbeat OK.", "3 peers visible on bat0."],
  },
  {
    name: "Weekend Ops Crew",
    channels: ["general", "logistics"],
    messages: ["Meet at grid ref NK-4421.", "Bring handheld units."],
  },
];

const STANDALONE_BROADCASTS = [
  {
    name: "CyberDeck OS Updates",
    description: "Official firmware and app release broadcasts.",
    messages: [
      "CyberDeck OS 0.1.0 baseline image published.",
      "Reminder: run prisma generate after schema changes.",
    ],
  },
  {
    name: "Mesh Security Bulletin",
    description: "Security advisories for mesh nodes.",
    messages: ["Rotate node keys quarterly.", "No open Wi-Fi on field kits."],
  },
  {
    name: "Community Digest",
    description: "Weekly highlights from all communities.",
    messages: ["Top thread: Off-Grid solar pack build.", "New members: +4 this week."],
  },
];

const ALL_SEED_NAMES = {
  communities: SEED_COMMUNITIES.map((c) => c.name),
  groups: [
    ...SEED_COMMUNITIES.flatMap((c) => c.groups.map((g) => g.name)),
    ...STANDALONE_GROUPS.map((g) => g.name),
  ],
  broadcasts: [
    ...SEED_COMMUNITIES.map((c) => `${c.name} Announcements`),
    ...STANDALONE_BROADCASTS.map((b) => b.name),
  ],
};

async function getSeedProfile() {
  return (
    (await db.profile.findFirst({ where: { userId: "user_admin" } })) ||
    (await db.profile.findFirst({ orderBy: { createdAt: "asc" } }))
  );
}

async function clearSeedData(profileId) {
  const communities = await db.community.findMany({
    where: { profileId, name: { in: ALL_SEED_NAMES.communities } },
    select: { id: true, announcementsChannelId: true },
  });

  for (const comm of communities) {
    await db.server.deleteMany({ where: { communityId: comm.id } });
    if (comm.announcementsChannelId) {
      await db.broadcastChannel.deleteMany({
        where: { id: comm.announcementsChannelId },
      });
    }
  }

  await db.community.deleteMany({
    where: { profileId, name: { in: ALL_SEED_NAMES.communities } },
  });

  await db.server.deleteMany({
    where: {
      profileId,
      name: { in: ALL_SEED_NAMES.groups },
      NOT: { inviteCode: "cyberdeck-default" },
    },
  });

  await db.broadcastChannel.deleteMany({
    where: { profileId, name: { in: ALL_SEED_NAMES.broadcasts } },
  });
}

async function createGroup(profileId, { name, communityId, channels, messages = [] }) {
  const server = await db.server.create({
    data: {
      name,
      imageUrl: IMG.group,
      inviteCode: `seed-${uuidv4().slice(0, 8)}`,
      profileId,
      communityId: communityId || null,
      members: { create: { profileId, role: "ADMIN" } },
      channels: {
        create: channels.map((channelName) => ({
          name: channelName,
          profileId,
          type: "TEXT",
        })),
      },
    },
    include: { members: true, channels: true },
  });

  const member = server.members[0];
  const channel =
    server.channels.find((c) => c.name === "general") || server.channels[0];

  for (const content of messages) {
    await db.message.create({
      data: { content, memberId: member.id, channelId: channel.id, type: "TEXT" },
    });
  }

  return server;
}

async function createCommunity(profileId, data) {
  const broadcast = await db.broadcastChannel.create({
    data: {
      name: `${data.name} Announcements`,
      description: `Official announcements for ${data.name}`,
      imageUrl: IMG.broadcast,
      profileId,
      followers: { create: { profileId, role: "ADMIN" } },
      messages: {
        create: data.announcements.map((content) => ({ content, type: "TEXT" })),
      },
    },
  });

  const community = await db.community.create({
    data: {
      name: data.name,
      description: data.description,
      imageUrl: IMG.community,
      profileId,
      announcementsChannelId: broadcast.id,
      members: { create: { profileId, role: "ADMIN" } },
    },
  });

  for (const group of data.groups) {
    await createGroup(profileId, { ...group, communityId: community.id });
  }

  return community;
}

async function createBroadcast(profileId, { name, description, messages }) {
  return db.broadcastChannel.create({
    data: {
      name,
      description,
      imageUrl: IMG.broadcast,
      profileId,
      followers: { create: { profileId, role: "ADMIN" } },
      messages: {
        create: messages.map((content) => ({ content, type: "TEXT" })),
      },
    },
  });
}

async function main() {
  const profile = await getSeedProfile();
  if (!profile) {
    console.error(
      "No profile found. Sign in once or run: npx prisma db seed (or /api/debug/seed)"
    );
    process.exit(1);
  }

  console.log(`Seeding test chats for: ${profile.name} (${profile.email})`);

  const existing = await db.community.findFirst({
    where: { profileId: profile.id, name: SEED_COMMUNITIES[0].name },
  });

  if (existing && !FORCE) {
    console.log(
      'Test data already exists. Use "npm run seed:test -- --force" to replace it.'
    );
    return;
  }

  if (FORCE) {
    console.log("Removing previous seed data...");
    await clearSeedData(profile.id);
  }

  console.log("Creating communities and groups...");
  for (const community of SEED_COMMUNITIES) {
    const created = await createCommunity(profile.id, community);
    console.log(`  Community: ${created.name} (${community.groups.length} groups)`);
  }

  console.log("Creating standalone groups...");
  for (const group of STANDALONE_GROUPS) {
    const created = await createGroup(profile.id, group);
    console.log(`  Group: ${created.name}`);
  }

  console.log("Creating broadcast channels...");
  for (const broadcast of STANDALONE_BROADCASTS) {
    const created = await createBroadcast(profile.id, broadcast);
    console.log(`  Channel: ${created.name}`);
  }

  const counts = {
    communities: await db.community.count({ where: { profileId: profile.id } }),
    groups: await db.server.count({
      where: {
        profileId: profile.id,
        NOT: { inviteCode: "cyberdeck-default" },
      },
    }),
    broadcasts: await db.broadcastChannel.count({ where: { profileId: profile.id } }),
  };

  console.log("\nSeed complete.");
  console.log(
    `  ${counts.communities} communities, ${counts.groups} groups, ${counts.broadcasts} broadcast channels (owned by you)`
  );
  console.log("Refresh the app to see them in the chat list.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
