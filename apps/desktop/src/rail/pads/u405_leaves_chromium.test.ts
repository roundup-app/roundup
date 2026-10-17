import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chromePath, openPage } from "../../testing/chromePage";
import type { ChromePage } from "../../testing/chromePage";
import { captureDir } from "../../testing/captures";

/** U405 in a real Chromium: the leaves of an Agent's `◇<n>` control hang one `--rail-step` under its Glyph, and their marks share one column. */

const found = chromePath();

const run = found || process.env["CI"] ? describe : describe.skip;

let page: ChromePage;

const ART = captureDir("U405");

beforeAll(async () => {
  if (!found) throw new Error("U405 needs a Chrome binary: set CHROME_PATH");

  page = await openPage(found);
}, 90_000);

afterAll(async () => {
  await page?.close();
});

type Read = { agentMark: number; marks: number[]; leaves: number; overflow: boolean; step: number; rowsAbove: number[] };

const READ = `() => {
  const row = document.querySelector('.rail-row[data-id="tokens"]');
  const control = row.querySelector("[data-pads-control]");
  const rows = [...document.querySelectorAll('.rail-row[data-id]')];
  const tops = () => rows.slice(0, rows.indexOf(row) + 1).map((each) => each.getBoundingClientRect().top);
  const before = tops();
  control.click();
  const leaves = [...document.querySelectorAll(".rail-leaf")];
  const probe = document.createElement("span");
  probe.style.cssText = "display:inline-block;width:var(--rail-step)";
  document.querySelector(".rail-tree").appendChild(probe);
  const step = probe.getBoundingClientRect().width;
  probe.remove();
  const tree = document.querySelector(".rail-tree");
  return {
    agentMark: row.querySelector(":scope > .line > .glyph").getBoundingClientRect().left,
    marks: leaves.map((leaf) => (leaf.querySelector(".glyph, svg") ?? leaf).getBoundingClientRect().left),
    leaves: leaves.length, overflow: tree.scrollWidth > tree.clientWidth, step,
    rowsAbove: tops().map((top, at) => top - before[at]),
  };
}`;

run("u405 leaves in a real Chromium", () => {
  vi.setConfig({ testTimeout: 90_000 });

  for (const scheme of ["light", "dark"] as const) {
    for (const [width, height] of [[1280, 800]] as const) {
      it(`u405_leaf_marks_share_one_column at ${width}x${height} ${scheme}`, async () => {
        await page.scheme(scheme);
        await page.load("/harness.html?seed=tree-40", width, height);
        await page.until(`() => Boolean(document.querySelector('[data-id="tokens"] [data-pads-control]'))`, 60_000);

        const read = await page.call<Read>(READ);

        expect(read.leaves).toBeGreaterThan(0);
        expect(read.overflow).toBe(false);
        expect(read.rowsAbove.every((moved) => moved === 0)).toBe(true);

        for (const mark of read.marks) expect(Math.abs(mark - (read.agentMark + read.step)), "a leaf mark one step under the Agent's Glyph").toBeLessThanOrEqual(1);

        if (ART) {
          mkdirSync(ART, { recursive: true });
          writeFileSync(join(ART, `leaves-${width}x${height}-${scheme}.png`), Buffer.from(await page.shot(), "base64"));
        }
      });
    }
  }
});
