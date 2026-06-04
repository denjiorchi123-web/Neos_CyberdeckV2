import { existsSync, mkdirSync, readdirSync } from "fs";
import { join } from "path";

const ROOT = join(process.cwd(), "private");
const CYBERDECK_ROOT = join(ROOT, "CyberDeck");
const MEDIA_ROOT = join(CYBERDECK_ROOT, "Media");

export const DIRS = {
  uploads:   join(ROOT, "uploads"), // Legacy location; kept readable for old messages.
  root:      CYBERDECK_ROOT,
  databases: join(CYBERDECK_ROOT, "Databases"),
  media:     MEDIA_ROOT,
  photos:    join(MEDIA_ROOT, "CyberDeck Images"),
  videos:    join(MEDIA_ROOT, "CyberDeck Video"),
  audio:     join(MEDIA_ROOT, "CyberDeck Audio"),
  documents: join(MEDIA_ROOT, "CyberDeck Documents"),
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

export function storageDirForMime(mime: string) {
  return DIRS[categoryFromMime(mime)];
}

function findNestedFile(dir: string, filename: string, depth = 2): string | null {
  if (depth < 0 || !existsSync(dir)) return null;

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isFile() && entry.name === filename) return fullPath;
    if (entry.isDirectory()) {
      const found = findNestedFile(fullPath, filename, depth - 1);
      if (found) return found;
    }
  }

  return null;
}

export function resolveStoredFilePath(filename: string) {
  const candidates = [
    join(DIRS.photos, filename),
    join(DIRS.videos, filename),
    join(DIRS.audio, filename),
    join(DIRS.documents, filename),
    join(DIRS.uploads, filename),
  ];
  const direct = candidates.find((candidate) => existsSync(candidate));
  if (direct) return direct;

  for (const dir of [DIRS.photos, DIRS.videos, DIRS.audio, DIRS.documents]) {
    const nested = findNestedFile(dir, filename);
    if (nested) return nested;
  }

  return candidates[0];
}

// All stored files are served from /api/files/<filename> regardless of category
export function fileUrl(filename: string) {
  return `/api/files/${filename}`;
}
