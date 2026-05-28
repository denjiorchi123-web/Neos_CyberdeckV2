import React from "react";
import { redirect } from "next/navigation";

import { initialProfile } from "@/lib/initial-profile";
import { db } from "@/lib/db";
import { InitialModal } from "@/components/modals/initial-modal";

export default async function SetupPage() {
  const profile = await initialProfile();

  if (!profile) {
    return redirect("/sign-in");
  }

  return redirect("/me");
}
