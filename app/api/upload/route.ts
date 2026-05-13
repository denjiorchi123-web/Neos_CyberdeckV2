import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { v4 as uuidv4 } from "uuid";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Sanitize filename and add UUID prefix to avoid collisions
    const ext = file.name.split(".").pop() || "bin";
    const safeName = `${uuidv4()}.${ext}`;

    const uploadDir = join(process.cwd(), "public", "uploads");
    await mkdir(uploadDir, { recursive: true });

    const filePath = join(uploadDir, safeName);
    await writeFile(filePath, buffer);

    const url = `/uploads/${safeName}`;

    return NextResponse.json({ url });
  } catch (error) {
    console.error("[UPLOAD_POST]", error);
    return new NextResponse("Upload failed", { status: 500 });
  }
}
