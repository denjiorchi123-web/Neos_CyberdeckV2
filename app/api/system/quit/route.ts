import { exec } from "child_process";
import { NextResponse } from "next/server";

export async function POST() {
  try {
    // This forcefully kills all running instances of Chromium on the Linux host
    exec("killall chromium");
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
