import { db } from "@/lib/db";
import { cookies } from "next/headers";

/**
 * Retrieves the current user profile based on a cookie.
 */
export const currentProfile = async () => {
  const cookieStore = cookies();
  const userId = cookieStore.get("cyberdeck-user-id")?.value;

  if (!userId) {
    return null;
  }
  
  const profile = await db.profile.findUnique({
    where: { userId }
  });

  return profile;
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
