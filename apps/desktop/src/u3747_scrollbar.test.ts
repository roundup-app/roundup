import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const sheets = Object.fromEntries(
  readdirSync(import.meta.dirname, { recursive: true, encoding: "utf8" })
    .filter((path) => path.endsWith(".css"))
    .map((path) => [path, readFileSync(join(import.meta.dirname, path), "utf8")]),
);

const SHARED = "scrollbar.css";

// A scrollbar declaration: a standard property or a WebKit pseudo-element rule.
const declarations = (css: string): string[] =>
  [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(scrollbar-(?:width|color|gutter)\s*:[^;}]+|::-webkit-scrollbar[\w-]*[^{]*\{[^}]*\})/g)].map((m) => (m[1] ?? "").trim());

it("u3747_no_stylesheet_outside_the_shared_scrollbar_style_sets_a_scrollbar", () => {
  expect(Object.keys(sheets)).toContain(SHARED);

  const strays = Object.entries(sheets)
    .filter(([path]) => path !== SHARED)
    .flatMap(([path, css]) => declarations(css).filter((d) => !/:\s*none$|display\s*:\s*none/.test(d)).map((d) => `${path}: ${d}`));

  expect(strays).toEqual([]);
  expect(declarations(sheets[SHARED] ?? "").length).toBeGreaterThan(0);
});
