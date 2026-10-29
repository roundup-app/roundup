import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

it("u4464_no_ad_hoc_empty_blocks_remain", () => {
  const files = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(directory, entry.name)) : /\.(tsx|css)$/.test(entry.name) && !entry.name.includes(".test.") ? [join(directory, entry.name)] : []);
  const retired = /\b(?:reaction-empty|overview-empty|pane-empty|timeline-empty)\b/;
  expect(files("src").filter(file => retired.test(readFileSync(file, "utf8")))).toEqual([]);
});
