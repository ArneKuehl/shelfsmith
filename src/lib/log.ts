import {
  BaseDirectory,
  exists,
  mkdir,
  readTextFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { appLogDir } from "@tauri-apps/api/path";

const LOG_FILE = "connection-tests.log";
const MAX_BYTES = 256 * 1024;

let ensured = false;
async function ensureDir() {
  if (ensured) return;
  try {
    if (!(await exists("", { baseDir: BaseDirectory.AppLog }))) {
      await mkdir("", { baseDir: BaseDirectory.AppLog, recursive: true });
    }
  } catch {
    /* ignore — directory probably already exists or unsupported */
  }
  ensured = true;
}

export async function appendConnectionLog(line: string): Promise<string | null> {
  const stamp = new Date().toISOString();
  const entry = `[${stamp}] ${line}\n`;
  try {
    await ensureDir();
    let prev = "";
    try {
      prev = await readTextFile(LOG_FILE, { baseDir: BaseDirectory.AppLog });
    } catch {
      /* file does not exist yet */
    }
    let next = prev + entry;
    if (next.length > MAX_BYTES) next = next.slice(next.length - MAX_BYTES);
    await writeTextFile(LOG_FILE, next, { baseDir: BaseDirectory.AppLog });
    try {
      const dir = await appLogDir();
      return `${dir}/${LOG_FILE}`;
    } catch {
      return null;
    }
  } catch (e) {
    console.warn("connection log write failed:", e);
    return null;
  }
}

export async function getConnectionLogPath(): Promise<string | null> {
  try {
    const dir = await appLogDir();
    return `${dir}/${LOG_FILE}`;
  } catch {
    return null;
  }
}
