import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { expect, it } from "vitest";

// These are window definitions, not Rail, Shelf, Drawer, pointer or terminal-cell dimensions.
const unsupported = (text: string): number[] => {
  const patterns = [
    /\b(\d+)\s*(?:×|x| by )\s*(?:400|800|820)\b/g,
    /(?:page\.(?:load|resize)|\bload)\([^\n]*?\b(\d+)\s*,\s*\d+\s*\)/g,
    /(?:innerWidth\s*[:=]|stubGlobal\(["']innerWidth["']\s*,|["']innerWidth["'][^\n]*?value:)\s*(\d+)/g,
    /(?:width|WIDTHS)\s*(?:[:=]|of)\s*\[([^\]\n]+)\]/g,
    /\[\s*(\d+)\s*,\s*(?:400|800|820|["'][^"']*x800["'])\s*\]/g,
    /\bwidth:\s*(\d+)\s*,\s*height:\s*(?:400|800|820)\b/g,
    /set[\s"',]+viewport[\s"',]+(\d+)/g,
    /--window-size[=, ]+(\d+)/g,
  ];
  const lines = new Set<number>();
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      if (pattern.source.startsWith("(?:width|") && !/innerWidth|page\.|WIDTHS|viewport/.test(text.slice(match.index, match.index! + 800))) continue;
      const widths = match[1]!.split(",").map((value) => Number(value.trim()));
      if (pattern.source.startsWith("\\[") && !/width|WIDTHS/.test(text.slice(Math.max(0, match.index! - 100), match.index))) continue;
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
  "at 700×800", "at 640 by 400", "page.load('/harness.html', 700, 800)", "page.resize(1024, 800)",
  "const WIDTHS = [700, 1280]", "for (const width of [1280, 700]) { window.innerWidth = width; }", "for (const [width, height] of [[1280, 800], [640, 400]])",
  'window.innerWidth = 700', 'Object.assign(window, { innerWidth: 700 })', 'vi.stubGlobal("innerWidth", 700)',
  'Object.defineProperty(window, "innerWidth", { value: 700 })', '{ width: 700, height: 800 }',
  'set viewport 700 800', 'browser("set", "viewport", "700", "800")', '--window-size=700,800',
])("u453_parser_reports_a_window_definition: %s", (text) => {
  expect(unsupported(`\n${text}`)).toEqual([2]);
});

it.each(["Rail is 252 px wide", "Shelf width: 320", "width: 560px", "drag(shelfEdge(), 700, 600)", "terminal.resize(60, 24)", "at 1280×800", "for (const [width, height] of [[1280, 800], [1440, 800]])"])("u453_parser_keeps_components_and_supported_windows: %s", (text) => {
  expect(unsupported(text)).toEqual([]);
});
