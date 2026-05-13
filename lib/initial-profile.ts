import { currentProfile } from "@/lib/current-profile";

/**
 * For the initial setup, we use currentProfile.
 * If null, the caller (SetupPage) will redirect to /sign-in.
 */
export const initialProfile = async () => {
  return await currentProfile();
};
