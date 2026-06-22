import { NextRequest, NextResponse } from "next/server";
import { createWriteStream, mkdirSync, renameSync } from "fs";
import { unlink, stat } from "fs/promises";
import { basename, extname, join } from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { v4 as uuidv4 } from "uuid";
import Busboy from "busboy";
import { currentProfile } from "@/lib/current-profile";
import { db } from "@/lib/db";
import { MESSAGE_FILE_MAX_SIZE, formatMaxSize } from "@/lib/upload-limits";
import { log } from "@/lib/logger";
import { ensureDirs, storageDirForMime } from "@/lib/media-dirs";

// Streaming uploads need the Node.js runtime + a non-cached, non-static response.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SIZE = MESSAGE_FILE_MAX_SIZE;

function resolveType(mime: string): string {
  if (mime.startsWith("image/")) return "IMAGE";
  if (mime.startsWith("video/")) return "VIDEO";
  if (mime.startsWith("audio/")) return "AUDIO";
  return "DOCUMENT";
}

class UploadError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

interface ParseResult {
  savedName: string;
  savedPath: string;
  originalName: string;
  mimeType: string;
  serverId: string;
  mediaKey: string | null;
}

function storedExtension(filename: string) {
  const extension = extname(basename(filename))
    .slice(1)
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 32);
  return extension || "bin";
}

/**
 * Parse multipart/form-data by streaming the request body straight to disk.
 * The file is never fully buffered in RAM, so uploads near the FAT32 4 GiB
 * ceiling work on a 4 GB Pi without OOM.
 */
function streamUploadToDisk(
  body: ReadableStream<Uint8Array>,
  headers: Record<string, string>,
  uploadDir: string,
): Promise<ParseResult> {
  return new Promise((resolve, reject) => {
    const result: Partial<ParseResult> = { serverId: "dm", mediaKey: null };
    let fileWritePromise: Promise<void> | null = null;
    let truncated = false;
    let pathToCleanup: string | null = null;
    let settled = false;

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    const cleanup = async () => {
      if (pathToCleanup) {
        await unlink(pathToCleanup).catch(() => undefined);
      }
    };

    const bb = Busboy({
      headers,
      limits: { fileSize: MAX_SIZE, files: 1, fields: 16 },
    });

    bb.on("field", (name, value) => {
      if (name === "serverId") result.serverId = value || "dm";
      else if (name === "mediaKey") result.mediaKey = value || null;
    });

    bb.on("file", (_name, fileStream, info) => {
      // Only honor the first file; drain any extras so busboy can finish.
      if (result.savedName) {
        fileStream.resume();
        return;
      }

      const originalName = info.filename || "upload.bin";
      const ext = storedExtension(originalName);
      const savedName = `${uuidv4()}.${ext}`;
      const savedPath = join(uploadDir, savedName);

      result.originalName = originalName;
      result.mimeType = info.mimeType || "application/octet-stream";
      result.savedName = savedName;
      result.savedPath = savedPath;
      pathToCleanup = savedPath;

      fileStream.on("limit", () => {
        truncated = true;
      });

      const out = createWriteStream(savedPath);
      fileWritePromise = pipeline(fileStream, out);
    });

    bb.on("error", (err: Error) => {
      settle(async () => {
        await cleanup();
        reject(err);
      });
    });

    bb.on("finish", () => {
      settle(async () => {
        try {
          if (fileWritePromise) await fileWritePromise;

          if (truncated) {
            await cleanup();
            return reject(new UploadError(`File too large (max ${formatMaxSize(MAX_SIZE)})`, 413));
          }
          if (!result.savedName) {
            return reject(new UploadError("No file provided", 400));
          }
          resolve(result as ParseResult);
        } catch (e) {
          await cleanup();
          reject(e);
        }
      });
    });

    // Pipe the Web ReadableStream from Next into the Node-style busboy parser.
    const nodeStream = Readable.fromWeb(body as any);
    nodeStream.on("error", (err) => {
      settle(async () => {
        await cleanup();
        reject(err);
      });
    });
    nodeStream.pipe(bb);
  });
}

export async function POST(req: NextRequest) {
  try {
    const profile = await currentProfile();
    if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const contentType = req.headers.get("content-type") || "";
    if (!contentType.startsWith("multipart/form-data")) {
      return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
    }
    if (!req.body) {
      return NextResponse.json({ error: "No request body" }, { status: 400 });
    }

    ensureDirs();
    const uploadDir = join(process.cwd(), "private", "uploads");
    mkdirSync(uploadDir, { recursive: true });

    const headers: Record<string, string> = {};
    req.headers.forEach((v, k) => { headers[k] = v; });

    const parsed = await streamUploadToDisk(req.body, headers, uploadDir);
    const { savedName, savedPath, originalName, mimeType, serverId, mediaKey } = parsed;

    const fileSize = (await stat(savedPath)).size;
    const fileType = resolveType(mimeType);
    const storageDir = storageDirForMime(mimeType);
    mkdirSync(storageDir, { recursive: true });
    const finalPath = join(storageDir, savedName);
    if (finalPath !== savedPath) {
      try {
        renameSync(savedPath, finalPath);
      } catch (err: any) {
        if (err.code === "EXDEV") {
          const { copyFileSync, unlinkSync } = await import("fs");
          copyFileSync(savedPath, finalPath);
          unlinkSync(savedPath);
        } else {
          throw err;
        }
      }
    }

    // Thumbnail generation for images — sharp reads from disk via streaming,
    // so even multi-hundred-MB images don't blow up RAM.
    let thumbnailUrl: string | undefined;
    if (fileType === "IMAGE") {
      try {
        const sharp = (await import("sharp")).default;
        const thumbName = `thumb_${savedName}`;
        await sharp(finalPath)
          .resize(320, 320, { fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 75 })
          .toFile(join(storageDir, thumbName));
        thumbnailUrl = `/api/files/${thumbName}`;
      } catch {
        // sharp optional / unsupported format — skip thumbnail
      }
    }

    // Audit index — non-fatal if it fails; the upload itself succeeded.
    try {
      await db.fileIndex.create({
        data: {
          name:       originalName,
          path:       savedName,
          size:       fileSize,
          mimeType,
          uploaderId: profile.id,
          serverId,
        },
      });
    } catch (err) {
      console.error("[UPLOAD] FileIndex write failed:", err);
    }

    log.event("FILE_UPLOAD", `${originalName} (${(fileSize/1024).toFixed(0)} KB, ${mimeType}) by ${profile.name}`);
    console.log(`[UPLOAD] Stored ${originalName} at ${finalPath}`);
    console.log(`[UPLOAD] Manual copy: cp ${JSON.stringify(finalPath)} ~/`);

    return NextResponse.json({
      url:          `/api/files/${savedName}`,
      thumbnailUrl: thumbnailUrl ?? null,
      fileName:     originalName,
      fileSize,
      mimeType,
      type:         fileType,
      mediaKey:     mediaKey ?? null,
    });
  } catch (e: any) {
    if (e instanceof UploadError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("[UPLOAD_POST]", e);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
