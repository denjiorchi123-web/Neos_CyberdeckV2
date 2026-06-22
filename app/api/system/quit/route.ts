import { exec } from "child_process";
import { NextResponse } from "next/server";

export async function POST() {
  try {
    // This forcefully kills all running instances of Chromium or Tauri on the Linux host
    exec("sudo /usr/bin/killall cyberdeck 2>/dev/null || true; sudo /usr/bin/killall chromium 2>/dev/null || true");
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
