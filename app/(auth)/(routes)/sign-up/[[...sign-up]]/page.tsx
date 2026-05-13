import { redirect } from "next/navigation";

export default function Page() {
  // CyberDeck: No cloud auth — auto-authenticated on LAN
  redirect("/");
}
