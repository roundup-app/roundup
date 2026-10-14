import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

it("u476_font_families_are_owned_by_tokens", () => {
  const tokens = readFileSync("src/tokens.css", "utf8");
  expect(tokens).toContain('--font-ui: -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif;');
  expect(tokens).toContain('--font-mono: ui-monospace, "SF Mono", Menlo, monospace;');
  expect(tokens).toContain("--mono: var(--font-mono);");
  const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)]);

  for (const file of files("src").filter((file) => /\.(css|tsx?)$/.test(file) && !/\.test\./.test(file) && file !== "src/tokens.css")) {
    const source = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

    if (file.endsWith(".css")) expect(source, file).not.toMatch(/--(?:mono|font-ui|font-mono)\s*:/);

    for (const match of source.matchAll(/font-family\s*["']?\s*:\s*([^;\n}]+)/g)) {
      expect(match[1], file).toMatch(/var\(--(?:font-ui|font-mono|mono)\)|style\.fontFamily|getComputedStyle/);
    }

    expect(source, file).not.toMatch(/fontFamily:\s*['"](?!var\(--(?:font-ui|font-mono|mono)\))[^'"]+/);
  }
});
