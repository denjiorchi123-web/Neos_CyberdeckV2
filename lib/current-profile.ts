import { db } from "@/lib/db";
import { cookies } from "next/headers";
import { redis } from "@/lib/redis";

export const currentProfile = async () => {
  const cookieStore = cookies();
  const userId = cookieStore.get("cyberdeck-user-id")?.value;

  if (!userId) return null;

  try {
    // 1. Try Redis cache first
    const cachedProfile = await redis.get(`profile:${userId}`);
    if (cachedProfile) {
      return JSON.parse(cachedProfile);
    }

    // 2. Fallback to Database
    const profile = await db.profile.findUnique({
      where: { userId }
    });

    // 3. Cache the result for 1 hour
    if (profile) {
      await redis.set(`profile:${userId}`, JSON.stringify(profile), "EX", 3600);
    }

    return profile;
  } catch (error) {
    console.error("[CURRENT_PROFILE_REDIS_ERROR]", error);
    // Silent failover to DB if Redis is down
    return await db.profile.findUnique({ where: { userId } });
  }
};

/**
 * Development helper to ensure at least one profile and server exists.
 * (Used only as fallback/check)
 */
export const ensureDefaultData = async () => {
  const defaultUserId = "user_admin";
  
  let profile = await db.profile.findUnique({
    where: { userId: defaultUserId }
  });

  // If seeded data is wiped, we can recreate a basic admin here if needed,
  // but we prefer using the seed script.
  return profile;
};
