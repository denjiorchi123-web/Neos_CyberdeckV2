import { appendFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";

const LOG_FILE = join(process.cwd(), "private", "logs", "app.log");

type Level = "INFO" | "WARN" | "ERROR" | "EVENT";

function write(level: Level, event: string, detail?: string) {
  try {
    mkdirSync(dirname(LOG_FILE), { recursive: true });
    const ts   = new Date().toISOString();
    const line = `${ts} [${level}] ${event}${detail ? " | " + detail : ""}\n`;
    appendFileSync(LOG_FILE, line, "utf8");
  } catch { /* never crash the caller due to logging */ }
}

export const log = {
  info:  (event: string, detail?: string) => write("INFO",  event, detail),
  warn:  (event: string, detail?: string) => write("WARN",  event, detail),
  error: (event: string, detail?: string) => write("ERROR", event, detail),
  event: (event: string, detail?: string) => write("EVENT", event, detail),
};
