import os from "os";
import { resolve, sep } from "path";

export function fileManagerRoot(): string {
  return resolve(
    process.platform === "win32"
      ? os.homedir()
      : (process.env.CYBERDECK_HOME || "/opt/cyberdeck")
  );
}

export function resolveFileManagerPath(raw: string | null): string | null {
  if (!raw) return null;

  const root = fileManagerRoot();
  const candidate = resolve(raw);

  if (candidate === root || candidate.startsWith(root + sep)) {
    return candidate;
  }

  return null;
}
