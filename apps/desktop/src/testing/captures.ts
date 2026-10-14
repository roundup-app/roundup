import fs, { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const root = () => resolve(process.cwd(), "../..", "artifacts/ux");

/** L105: the directory a capture test writes `<id>`'s PNGs and checks to, or null when this run does not name `<id>`. Creates nothing. */
export function captureDir(id: string): string | null {
  const named = (process.env.ROUNDUP_CAPTURES ?? "").split(",").map((part) => part.trim());

  if (!named.includes(id)) return null;

  if (id.startsWith("J")) return /^J[0-9]+[a-z]?$/.test(id) ? join(root(), "journey", id) : null;

  return join(root(), id);
}

/** U453: committed observer readings remain readable when capture writes are disabled. */
export function readCapture(id: string, name: string): string {
  return readFileSync(join(root(), id, name), "utf8");
}

/** U453: enumerate committed captures for retirement checks without enabling writes. */
export function captureFiles(): string[] {
  const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)]);

  return files(root());
}

/** U453: avoid reading capture bodies when only the PNG header width is needed. */
export function captureWidth(file: string): number {
  const descriptor = fs.openSync(file, "r");

  try {
    const header = Buffer.alloc(24);
    const bytes = fs.readSync(descriptor, header, { offset: 0, length: header.length, position: 0 });

    return header.subarray(0, bytes).readUInt32BE(16);
  } finally {
    fs.closeSync(descriptor);
  }
}
