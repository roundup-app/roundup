import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromePath } from "../testing/chromePage";
import { captureDir } from "../testing/captures";
import { openFontPair } from "../testing/u476Browser";

const found = chromePath();
const run = found || process.env.CI ? describe : describe.skip;
let pair: Awaited<ReturnType<typeof openFontPair>>;
beforeAll(async () => {
  if (!found) throw new Error("U476 requires CHROME_PATH");
  pair = await openFontPair(found);
}, 90_000);
afterAll(async () => { await pair?.close(); });

type Metrics = { configured: string; rendered: string | null; mono: string; cellWidth: number; cellHeight: number; cols: number; rows: number; webgl: boolean; fontSize: number; row: string; dpr: number };

const MEASURE = `async (dom) => {
  const { createXtermEmulators, xtermOptions } = await import('/src/terminal/emulator.ts');
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0;width:640px;height:400px';
  document.body.replaceChildren(host);
  const probe = { rendered() {}, written() {}, renderer(value) { this.webgl = value; }, webgl: false };
  const emulator = dom ? createXtermEmulators(probe, () => { throw new Error('U476 DOM fallback observation'); })('u476') : createXtermEmulators(probe)('u476');
  emulator.show(host, false);
  await document.fonts.ready;
  await new Promise(done => emulator.write(new TextEncoder().encode('ABCDEFGHIJKLMNOPQRSTUVWXYZ 0123456789'), done));
  const size = emulator.fit();
  await new Promise(done => requestAnimationFrame(done));
  const screen = host.querySelector('.xterm-screen');
  if (!screen) throw new Error('no active renderer screen');
  const box = screen.getBoundingClientRect();
  const row = host.querySelector('.xterm-rows > div');
  if (dom && (!row || !row.textContent.includes('ABCDEFGHIJKLMNOPQRSTUVWXYZ'))) throw new Error('missing rendered ASCII row');
  const mono = getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim();
  const result = { configured: xtermOptions.fontFamily, rendered: row ? getComputedStyle(row).fontFamily : null, mono, cellWidth: box.width / size.cols, cellHeight: box.height / size.rows, ...size, webgl: probe.webgl, fontSize: xtermOptions.fontSize, row: row?.textContent ?? '', dpr: devicePixelRatio };
  emulator.dispose();
  return result;
}`;

run("U476 Terminal regression", () => {
  it("u476_terminal_font_and_cell_metrics_match_main", async () => {
    const readings = [];
    for (const scheme of ["light", "dark"] as const) for (const dom of [true, false]) {
      const measured: Metrics[] = [];
      for (const page of [pair.baseline, pair.head]) {
        await page.scheme(scheme);
        await page.load('/harness.html?seed=agents-10', 1280, 800);
        await page.until(`() => Boolean(window.__fake && document.querySelector('.rail-row'))`);
        measured.push(await page.call<Metrics>(MEASURE, dom));
      }
      const [base, head] = measured;
      expect(head!.configured).toBe(head!.mono);
      expect(head!.configured).toBe(base!.configured);
      expect(head!.rendered).toBe(base!.rendered);
      if (dom) expect(head!.rendered).toContain("monospace");
      expect(head!.cols).toBe(base!.cols);
      expect(head!.rows).toBe(base!.rows);
      expect(head!.fontSize).toBe(base!.fontSize);
      expect(head!.webgl).toBe(base!.webgl);
      if (dom) expect(head!.webgl).toBe(false);
      for (const key of ["cellWidth", "cellHeight"] as const) {
        expect(base![key]).toBeGreaterThan(0);
        expect(head![key]).toBeGreaterThan(0);
        expect(Math.abs(head![key] - base![key])).toBeLessThanOrEqual(0.01);
      }
      readings.push({ scheme, renderer: dom ? "DOM fallback" : "active", base, head });
    }
    const art = captureDir("U476");
    if (art) {
      mkdirSync(art, { recursive: true });
      writeFileSync(join(art, "terminal.json"), JSON.stringify(readings, null, 2));
    }
  }, 120_000);
});
