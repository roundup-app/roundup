import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { expect, it } from "vitest";

// These are window definitions, not Rail, Shelf, Drawer, pointer or terminal-cell dimensions.
const unsupported = (text: string): number[] => {
  const patterns = [
    /\b(\d+)\s*(?:×|x| by )\s*\d+\b/g,
    /(?:page\.(?:load|resize)|\bload)\([^\n]*?\b(\d+)\s*,\s*\d+\s*\)/g,
    /(?:innerWidth\s*[:=]|stubGlobal\(["']innerWidth["']\s*,|["']innerWidth["'][^\n]*?value:)\s*(\d+)/g,
    /(?:width|WIDTHS)\s*(?:[:=]|of)\s*\[([^\]\n]+)\]/g,
    /\[\s*(\d+)\s*,\s*(?:\d+|["'][^"']*x\d+["'])\s*\]/g,
    /\bwidth:\s*(\d+)\s*,\s*height:\s*\d+\b/g,
    /set[\s"',]+viewport[\s"',]+(\d+)/g,
    /--window-size[=, ]+(\d+)/g,
    /window\s+(?:under|below|width(?:\s+of)?|at)\s+(\d+)\s*px/g,
  ];

  const lines = new Set<number>();

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const before = text.slice(Math.max(0, match.index! - 200), match.index);

      if (pattern.source.startsWith("\\b(\\d+)") && (/terminal|emulator|columns|rows|cells/i.test(before) || /size\s*$/.test(before)) && !/window|browser|chromium|capture|viewport/i.test(before)) continue;

      if (pattern.source.startsWith("\\bwidth:") && /Extent|Place|FALLBACK_EXTENT|getBoundingClientRect|clamped\(|type:\s*["'](?:rectangle|arrow)["']/.test(before)) continue;

      if (pattern.source.startsWith("(?:width|") && !/innerWidth|page\.|WIDTHS|viewport/.test(text.slice(match.index, match.index! + 800))) continue;

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
    .filter((file) => !file.endsWith("ui-drawer.md") && !file.endsWith("u453_viewports.test.ts"))
    .flatMap((file) => unsupported(readFileSync(file, "utf8")).map((line) => `${file.slice(root.length + 1)}:${line}`));

  expect(violations).toEqual([]);
});

it.each([
  "window under 1102px", "at 700×100", "at 700×900", "at 700×800", "at 640 by 400", "page.load('/harness.html', 700, 800)", "page.resize(1024, 900)", "page.resize(1024, 800)",
  "const WIDTHS = [700, 1280]", "for (const width of [1280, 700]) { window.innerWidth = width; }", "for (const [width, height] of [[1280, 800], [640, 400]])", "for (const [width, height] of [[1000, 900]])",
  'window.innerWidth = 700', 'Object.assign(window, { innerWidth: 700 })', 'vi.stubGlobal("innerWidth", 700)',
  'Object.defineProperty(window, "innerWidth", { value: 700 })', '{ width: 700, height: 800 }', '{ width: 700, height: 900 }',
  'set viewport 700 800', 'browser("set", "viewport", "700", "800")', '--window-size=700,800',
])("u453_parser_reports_a_window_definition: %s", (text) => {
  expect(unsupported(`\n${text}`)).toEqual([2]);
});

it.each(["Terminal spawned at 80x24", '["size 100x30", "SCREEN"]', "Rail is 252 px wide", "Shelf width: 320", "width: 560px", "const FALLBACK_EXTENT: Extent = { width: 800, height: 600 }", "element.getBoundingClientRect = () => ({ width: 100, height: 50 })", "clamped(place, { width: 800, height: 600 })", "{ type: 'rectangle', width: 160, height: 80 }", "expect([px(icon.width), px(icon.height)]).toEqual([24, 24])", "drag(shelfEdge(), 700, 600)", "terminal.resize(60, 24)", "at 1280×800", "for (const [width, height] of [[1280, 800], [1440, 800]])"])("u453_parser_keeps_components_and_supported_windows: %s", (text) => {
  expect(unsupported(text)).toEqual([]);
});

it("u453_shelf_span_has_no_window_cap", () => {
  const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
  expect(css).toMatch(/--shelf-span:\s*var\(--shelf-width\);/);
});

it("u453_no_retired_narrow_capture", () => {
  const root = resolve(process.cwd(), "../../artifacts/ux");

  const violations = files(root).flatMap((file) => {
    if (file.endsWith(".png")) {
      const png = readFileSync(file);

      return png.readUInt32BE(16) < 1280 ? [file] : [];
    }

    if (file.endsWith(".json")) {
      const viewports = [...readFileSync(file, "utf8").matchAll(/"viewport"\s*:\s*"(\d+)x/g)];

      return viewports.some((match) => Number(match[1]) < 1280) ? [file] : [];
    }

    return [];
  });

  expect(violations).toEqual([]);
});
