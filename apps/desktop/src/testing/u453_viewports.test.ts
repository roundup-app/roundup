import fs, { readFileSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, basename } from "node:path";
import { expect, it, vi } from "vitest";
import * as v from "valibot";
import { captureFiles, captureWidth } from "./captures";

// These are window definitions, not Rail, Shelf, Drawer, pointer or terminal-cell dimensions.
const unsupported = (text: string): number[] => {
  const patterns = [
    /\b(\d+)\s*(?:×|x| by )\s*\d+\b/g,
    /(?:page\.(?:load|resize)|\bload)\([^\n]*?\b(\d+)\s*,\s*\d+\s*\)/g,
    /(?:innerWidth\s*[:=]|stubGlobal\(["']innerWidth["']\s*,|["']innerWidth["'][^\n]*?value:)\s*(\d+)/g,
    /\b(?:width|WIDTHS)\s*(?:(?::[^=\n]+)?=|of)\s*\[([^\]]+)\]/g,
    /\[\s*(\d+)\s*,\s*(?:\d+|["'][^"']*x\d+["'])\s*\]/g,
    /\bwidth:\s*(\d+)\s*,\s*height:\s*\d+\b/g,
    /set[\s"',]+viewport[\s"',]+(\d+)/g,
    /--window-size[=, ]+(\d+)/g,
    /window\s+(?:under|below|width(?:\s+of)?|at)\s+(\d+)\s*px/g,
    /it\.each\(\[([^\]]+)\]\)/g,
  ];

  const lines = new Set<number>();

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const before = text.slice(Math.max(0, match.index! - 200), match.index);

      if (pattern.source.startsWith("\\b(\\d+)") && (/terminal|emulator|columns|rows|cells/i.test(before) || /size\s*$/.test(before)) && !/window|browser|chromium|capture|viewport/i.test(before)) continue;

      if (pattern.source.startsWith("\\bwidth:") && /Extent|Place|FALLBACK_EXTENT|getBoundingClientRect|clamped\(|type:\s*["'](?:rectangle|arrow)["']/.test(before)) continue;

      if (pattern.source.startsWith("\\b(?:width|") && !/innerWidth|page\.|WIDTHS|viewport/.test(text.slice(match.index, match.index! + 800))) continue;

      if (pattern.source.startsWith("it\\.each") && !/innerWidth|viewport|page\.(?:load|resize)/.test(text.slice(match.index, match.index! + 800))) continue;

      if (pattern.source.startsWith("\\[") && !/\[\s*width\s*,|WIDTHS|VIEWPORTS|CONFIGS|viewport|for[^\n]+\bwidth\b/.test(before)) continue;
      const widths = match[1]!.split(",").map((value) => Number(value.trim()));

      if (widths.some((width) => width > 0 && width < 1280)) lines.add(text.slice(0, match.index).split("\n").length);
    }
  }

  return [...lines];
};

const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)]);

it("u453_no_unsupported_viewport", () => {
  const root = resolve(process.cwd(), "../..");

  const violations = [...files(join(root, "scenarios")), ...files(join(root, "apps/desktop/src"))]
    .filter((file) => !file.endsWith("ui-drawer.md") && !file.endsWith("u453_viewports.test.ts") && !file.endsWith("u2230b_browser.test.ts"))
    .flatMap((file) => unsupported(readFileSync(file, "utf8")).map((line) => `${file.slice(root.length + 1)}:${line}`));

  expect(violations).toEqual([]);
});

it.each([
  "window under 1102px", "at 700×100", "at 700×900", "at 700×800", "at 640 by 400", "page.load('/harness.html', 700, 800)", "page.resize(1024, 900)", "page.resize(1024, 800)",
  "it.each([700, 1280])((width) => { window.innerWidth = width; })", "const WIDTHS = [\n1280,\n700,\n1440\n]", "const WIDTHS = [700, 1280]", "const WIDTHS: readonly number[] = [700, 1280]", "for (const width of [1280, 700]) { window.innerWidth = width; }", "for (const [width, height] of [[1280, 800], [640, 400]])", "for (const [width, height] of [[1000, 900]])",
  'window.innerWidth = 700', 'Object.assign(window, { innerWidth: 700 })', 'vi.stubGlobal("innerWidth", 700)',
  'Object.defineProperty(window, "innerWidth", { value: 700 })', '{ width: 700, height: 800 }', '{ width: 700, height: 900 }',
  'set viewport 700 800', 'browser("set", "viewport", "700", "800")', '--window-size=700,800',
])("u453_parser_reports_a_window_definition: %s", (text) => {
  expect(unsupported(`\n${text}`)).toEqual([2]);
});

it.each(["Terminal spawned at 80x24", '["size 100x30", "SCREEN"]', "it.each([80, 100])((cols) => terminal.resize(cols, 24))", "Rail is 252 px wide", "Shelf width: 320", "width: 560px", "const FALLBACK_EXTENT: Extent = { width: 800, height: 600 }", "element.getBoundingClientRect = () => ({ width: 100, height: 50 })", "clamped(place, { width: 800, height: 600 })", "{ type: 'rectangle', width: 160, height: 80 }", "expect([px(icon.width), px(icon.height)]).toEqual([24, 24])", "drag(shelfEdge(), 700, 600)", "terminal.resize(60, 24)", "at 1280×800", "for (const [width, height] of [[1280, 800], [1440, 800]])"])("u453_parser_keeps_components_and_supported_windows: %s", (text) => {
  expect(unsupported(text)).toEqual([]);
});

it("u453_shelf_span_has_no_window_cap", () => {
  const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
  expect(css).toMatch(/--shelf-span:\s*var\(--shelf-width\);/);
});

// Reads every committed capture's PNG header and Checks: about 1 s on an idle runner, 6 s beside a vite build and Chromium tests.
it("u453_no_retired_narrow_capture", () => {
  const checks = v.object({ D10: v.object({ value: v.object({ viewport: v.string() }) }) });

  const reading = v.union([
    checks,
    v.pipe(v.object({ checks }), v.transform((wrapped) => wrapped.checks)),
    v.pipe(v.string(), v.transform((encoded) => JSON.parse(encoded)), checks),
  ]);

  const violations = captureFiles().flatMap((file) => {
    const namedWidths = [...basename(file).matchAll(/(?:^|-)(?:(\d+)x\d+|(700)(?=-|\.))/g)].map((match) => Number(match[1] ?? match[2]));

    if (namedWidths.some((width) => width > 0 && width < 1280)) return [file];

    if (file.endsWith(".png")) {
      return captureWidth(file) < 1280 ? [file] : [];
    }

    if (file.endsWith(".checks.json")) {
      const parsed = v.safeParse(reading, JSON.parse(readFileSync(file, "utf8")));

      return parsed.success && Number(parsed.output.D10.value.viewport.split("x")[0]) < 1280 ? [file] : [];
    }

    return [];
  });

  expect(violations).toEqual([]);
}, 30_000);

it("u453_capture_width_reads_only_the_png_header", () => {
  const dir = mkdtempSync(join(tmpdir(), "u453-"));
  const read = vi.spyOn(fs, "readSync");
  const whole = vi.spyOn(fs, "readFileSync");

  try {
    for (const width of [700, 1280]) {
      const header = Buffer.alloc(24);
      header.set([137, 80, 78, 71, 13, 10, 26, 10]);
      header.writeUInt32BE(13, 8);
      header.write("IHDR", 12);
      header.writeUInt32BE(width, 16);
      header.writeUInt32BE(800, 20);
      const file = join(dir, `${width}.png`);
      writeFileSync(file, header);

      expect(captureWidth(file)).toBe(width);
    }

    expect(whole).not.toHaveBeenCalled();
    expect(read.mock.calls).toHaveLength(2);

    for (const call of read.mock.calls) {
      expect(call[2]?.offset).toBe(0);
      expect(call[2]?.length).toBeLessThanOrEqual(24);
      expect(call[2]?.position).toBe(0);
    }
  } finally {
    read.mockRestore();
    whole.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  }
});
