import { resolve } from "node:path";

/** L105: the directory a capture test writes `<id>`'s PNGs and checks to, or null when this run does not name `<id>`. Creates nothing. */
export function captureDir(id: string): string | null {
  const named = (process.env.ROUNDUP_CAPTURES ?? "").split(",").map((part) => part.trim());

  return named.includes(id) ? resolve(process.cwd(), "../..", "artifacts/ux", id) : null;
}
