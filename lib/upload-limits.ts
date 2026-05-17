/**
 * Centralized upload size limits.
 *
 * The CyberDeck data partition uses FAT32, which has a hard per-file limit of
 * (2^32 - 1) bytes = 4 GiB - 1. Anything larger cannot be written to disk no
 * matter how the upload pipeline is implemented.
 *
 * The upload route (app/api/upload/route.ts) streams the multipart body
 * straight to disk via busboy + pipeline + fs.createWriteStream, so the file
 * is NOT buffered in RAM. A 3.9 GiB transfer on a 4 GB Pi 5 uses only a few
 * MB of resident memory at any moment.
 *
 * Tune to taste:
 *   - Want to forbid >1 GiB attachments to keep the FAT32 partition tidy?
 *     Set MESSAGE_FILE_MAX_SIZE = 1024 * 1024 * 1024 below.
 *   - Want to enforce a smaller cap purely for UX? Same idea.
 */

/** FAT32 hard ceiling: one byte short of 4 GiB. */
export const FAT32_MAX_FILE_SIZE = 4 * 1024 * 1024 * 1024 - 1;

/** Attachment upload cap (chat documents, images, videos, audio). */
export const MESSAGE_FILE_MAX_SIZE = FAT32_MAX_FILE_SIZE;

/** Profile/server avatar cap — kept small on purpose (no reason for huge avatars). */
export const SERVER_IMAGE_MAX_SIZE = 16 * 1024 * 1024; // 16 MB

/** Human-readable formatter for UI hints ("max 4 GB"). */
export function formatMaxSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(0)} GB`;
  if (bytes >= 1024 * 1024)         return `${Math.round(bytes / 1024 / 1024)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}
