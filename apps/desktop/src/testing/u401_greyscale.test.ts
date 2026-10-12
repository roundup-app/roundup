import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chromePath, openPage } from "./chromePage";
import type { ChromePage } from "./chromePage";

/** U401: the six Glyphs differ pairwise in a greyscale capture of their boxes, at 163 px, at 200% zoom and under `prefers-contrast: more`, in light and dark (4% of the box: the thinnest pair, `blocked` and `idle`, cannot differ by more than a dashed 1.5 px ring). */

const found = chromePath();

const run = found || process.env["CI"] ? describe : describe.skip;

let page: ChromePage;

const ART = resolve(process.cwd(), "../../artifacts/ux/U401");

beforeAll(async () => {
  if (!found) throw new Error("U401 needs a Chrome binary: set CHROME_PATH");

  page = await openPage(found);
}, 90_000);

afterAll(async () => {
  await page?.close();
});

/** Page-side: rasterises one Glyph per Kind at `zoom`× with its computed colours, in greyscale, and returns the pairwise differing share of the box and a PNG row of all six. */
const DIFFS = `async (zoom) => {
  const kinds = ["error", "needs-you", "blocked", "working", "idle", "done"];
  const ground = getComputedStyle(document.documentElement).getPropertyValue("--ground").trim() || "#fff";
  const size = 16 * zoom;
  const grey = [];
  const row = document.createElement("canvas");
  row.width = size * 6;
  row.height = size;
  const rowCtx = row.getContext("2d");
  for (const [index, kind] of kinds.entries()) {
    const glyph = document.querySelector('.glyph[data-fill][aria-label="' + kind + '"]') ?? document.querySelector('.glyph[data-fill]:has(svg)[aria-label="' + kind + '"]');
    if (!glyph) return { missing: kind };
    const svg = glyph.querySelector("svg").cloneNode(true);
    svg.setAttribute("width", size);
    svg.setAttribute("height", size);
    svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    svg.style.color = getComputedStyle(glyph).color;
    const markup = new XMLSerializer().serializeToString(svg).replaceAll("var(--ground)", ground);
    const img = new Image();
    await new Promise((done, fail) => { img.onload = done; img.onerror = fail; img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(markup); });
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = ground;
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(img, 0, 0, size, size);
    rowCtx.drawImage(canvas, index * size, 0);
    const data = ctx.getImageData(0, 0, size, size).data;
    const px = [];
    for (let i = 0; i < data.length; i += 4) px.push(Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]));
    grey.push(px);
  }
  const diffs = [];
  for (let a = 0; a < 6; a++) for (let b = a + 1; b < 6; b++) {
    let n = 0;
    for (let i = 0; i < grey[a].length; i++) if (Math.abs(grey[a][i] - grey[b][i]) > 64) n++;
    diffs.push({ pair: kinds[a] + "/" + kinds[b], share: n / grey[a].length });
  }
  return { diffs, png: row.toDataURL("image/png").split(",")[1] };
}`;

type Read = {
  missing?: string;
  diffs: { pair: string; share: number }[];
  png: string;
};

run("u401 greyscale", () => {
  vi.setConfig({ testTimeout: 30_000 });

  for (const scheme of ["light", "dark"] as const) {
    for (const [label, width, zoom, contrast] of [
      ["163px", 163, 1, undefined],
      ["200%", 1280, 2, undefined],
      ["contrast-more", 1280, 1, "more"],
    ] as const) {
      it(`u401_the_six_glyphs_differ_in_greyscale at ${label} in ${scheme}`, async () => {
        await page.scheme(scheme, contrast);
        await page.load("/harness.html?seed=tree-40", width, 820);
        await page.until(
          `() => Boolean(window.__fake) && document.querySelector(".glyph svg") !== null`,
        );
        const read = await page.call<Read>(DIFFS, zoom);

        expect(read.missing).toBeUndefined();
        expect(read.diffs).toHaveLength(15);
        expect(read.diffs.filter(({ share }) => share <= 0.04)).toEqual([]);

        mkdirSync(ART, { recursive: true });
        writeFileSync(
          join(ART, `kinds-${label}-${scheme}-${16 * zoom}px.png`),
          Buffer.from(read.png, "base64"),
        );
      });
    }
  }
});
