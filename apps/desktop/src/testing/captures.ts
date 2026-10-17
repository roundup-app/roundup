import { readFileSync } from "node:fs";
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
