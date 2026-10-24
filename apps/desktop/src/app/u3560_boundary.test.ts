import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, it } from "vitest";

// Disallow even handing the browser clipboard to a helper: only its owner may access it.
const forbidden = (file: string, source: string) => file !== "app/clipboard.ts" && /navigator\s*(?:\.\s*clipboard|\[\s*["']clipboard["']\s*\])/.test(source);

const sources = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const file = join(directory, entry.name);

  return entry.isDirectory() ? sources(file) : /\.tsx?$/.test(file) && !file.includes(".test.") ? [file] : [];
});

it.each(["read()", "readText()", "writeText(text)"])("u3560a_clipboard_access_has_one_owner_%s", access => {
  const source = `navigator.clipboard.${access}`;
  expect(forbidden("terminal/Pane.tsx", source)).toBe(true);
  expect(forbidden("app/clipboard.ts", source)).toBe(false);
});

it("u3560a_the_source_tree_keeps_clipboard_access_with_its_owner", () => {
  const violations = sources("src").filter(file => forbidden(relative("src", file), readFileSync(file, "utf8")));
  expect(violations).toEqual([]);
});
