import { existsSync, mkdirSync, readdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const ROOT = join(process.cwd(), "private");
const LEGACY_CYBERDECK_ROOT = join(ROOT, "CyberDeck");
const LEGACY_MEDIA_ROOT = join(LEGACY_CYBERDECK_ROOT, "Media");
const MEDIA_ROOT = process.env.CYBERDECK_MEDIA_ROOT || join(homedir(), "LAN_Chat_Media");

export const DIRS = {
  uploads:   join(ROOT, "uploads"), // Legacy location; kept readable for old messages.
  root:      MEDIA_ROOT,
  databases: join(ROOT, "CyberDeck", "Databases"),
  media:     MEDIA_ROOT,
  photos:    join(MEDIA_ROOT, "Images"),
  videos:    join(MEDIA_ROOT, "Videos"),
  audio:     join(MEDIA_ROOT, "Audio"),
  documents: join(MEDIA_ROOT, "Documents"),
  logs:      join(ROOT, "logs"),
} as const;

const LEGACY_DIRS = {
  photos:    join(LEGACY_MEDIA_ROOT, "CyberDeck Images"),
  videos:    join(LEGACY_MEDIA_ROOT, "CyberDeck Video"),
  audio:     join(LEGACY_MEDIA_ROOT, "CyberDeck Audio"),
  documents: join(LEGACY_MEDIA_ROOT, "CyberDeck Documents"),
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
    join(LEGACY_DIRS.photos, filename),
    join(LEGACY_DIRS.videos, filename),
    join(LEGACY_DIRS.audio, filename),
    join(LEGACY_DIRS.documents, filename),
    join(DIRS.uploads, filename),
  ];
  const direct = candidates.find((candidate) => existsSync(candidate));
  if (direct) return direct;

  for (const dir of [
    DIRS.photos,
    DIRS.videos,
    DIRS.audio,
    DIRS.documents,
    LEGACY_DIRS.photos,
    LEGACY_DIRS.videos,
    LEGACY_DIRS.audio,
    LEGACY_DIRS.documents,
  ]) {
    const nested = findNestedFile(dir, filename);
    if (nested) return nested;
  }

  return candidates[0];
}

// All stored files are served from /api/files/<filename> regardless of category
export function fileUrl(filename: string) {
  return `/api/files/${filename}`;
}
