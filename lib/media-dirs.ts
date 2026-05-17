import { mkdirSync } from "fs";
import { join } from "path";

const ROOT = join(process.cwd(), "private");

export const DIRS = {
  uploads:   join(ROOT, "uploads"),
  photos:    join(ROOT, "media", "photos"),
  videos:    join(ROOT, "media", "videos"),
  audio:     join(ROOT, "media", "audio"),
  documents: join(ROOT, "media", "documents"),
  logs:      join(ROOT, "logs"),
} as const;

export function ensureDirs() {
  for (const dir of Object.values(DIRS)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function categoryFromMime(mime: string): keyof typeof DIRS {
  if (mime.startsWith("image/")) return "photos";
  if (mime.startsWith("video/")) return "videos";
  if (mime.startsWith("audio/")) return "audio";
  return "documents";
}

// All stored files are served from /api/files/<filename> regardless of category
export function fileUrl(filename: string) {
  return `/api/files/${filename}`;
}
