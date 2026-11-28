import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const sources = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const path = join(dir, entry.name);

  if (entry.isDirectory()) return sources(path);

  return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.|harness|domStubs/i.test(entry.name) ? [path] : [];
});

it("u8031d_every_intersection_observer_passes_a_root_margin", () => {
  const bare = sources(join(import.meta.dirname, "..")).filter(path => {
    const text = readFileSync(path, "utf8");

    return /new IntersectionObserver\(/.test(text) && !/rootMargin/.test(text);
  });

  expect(bare).toEqual([]);
});
