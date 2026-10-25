import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../../../../", import.meta.url));
const plugin = resolve(repo, "tools/oxlint/anti-slop/index.ts");
const cases = [
  ["computed style", 'expect(getComputedStyle(element).color).toBe("red");', "appearance"],
  ["geometry", 'expect(element.getBoundingClientRect().width).toBeGreaterThan(0);', "appearance"],
  ["dimension alias", 'const size = element.offsetWidth; const larger = size + 4; expect(larger).toBe(20);', "appearance"],
  ["style matcher", 'expect(element).toHaveStyle({ color: "red" });', "appearance"],
  ["text matcher", 'expect(element).toHaveTextContent("Save changes");', "copy-candidate"],
  ["text read", 'expect(element.textContent).toBe("Save changes");', "copy-candidate"],
  ["text query", 'expect(screen.getByText("Save changes")).toBeTruthy();', "copy-candidate"],
  ["role query as copy proof", 'expect(screen.getByRole("button", { name: "Save changes" })).toBeTruthy();', "copy-candidate"],
  ["complete regex", 'expect(element.textContent).toMatch(/^Save changes$/);', "copy-candidate"],
  ["browser string", 'expect(await read("getComputedStyle(document.body).color")).toBe("red");', "appearance"],
  ["browser alias", 'const script = "document.body.getBoundingClientRect().width"; const result = await read(script); expect(result).toBe(10);', "appearance"],
  ["browser callback", 'const result = await page.evaluate(() => document.body.scrollWidth); expect(result).toBe(10);', "appearance"],
  ["browser object field", 'const result = await read("({ width: document.body.clientWidth })"); expect(result.width).toBe(10);', "appearance"],
  ["browser exact text", 'expect(await read("document.body.textContent")).toBe("Welcome");', "copy-candidate"],
  ["embedded comment is not a read", 'expect(await read("1 /* getComputedStyle(document.body) */")).toBe(1);', null],
  ["embedded string is not a read", 'expect(await read("\"getComputedStyle(document.body)\"")).toBe("getComputedStyle(document.body)");', null],
  ["style used for action only", 'const size = element.getBoundingClientRect(); await click(size.x, size.y); expect(calls).toHaveLength(1);', null],
  ["role query locating action", 'const button = screen.getByRole("button", { name: "Save changes" }); button.click(); expect(calls).toHaveLength(1);', null],
  ["role query checking focus", 'expect(screen.getByRole("button", { name: "Save changes" })).toHaveFocus();', null],
  ["accessible name presence", 'expect(element).toHaveAccessibleName();', null],
  ["text presence", 'expect(element.textContent).not.toBe("");', null],
  ["call contract", 'expect(rpc).toHaveBeenCalledWith("Save changes");', null],
  ["round trip without literal", 'expect(element.textContent).toBe(userInput);', null],
  ["aliased expect", 'check(element.scrollWidth).toBe(10);', "appearance"],
  ["shadowed expect", '{ const expect = x => ({ toBe: () => x }); expect(element.scrollWidth).toBe(10); }', null],
];

for (const [name, source, kind] of cases) {
  test(`t3779b_assertion_boundary: ${name}`, () => {
    const dir = mkdtempSync(resolve(repo, ".assertion-fixture-"));
    const file = resolve(dir, "fixture.test.tsx");
    const config = resolve(dir, "config.json");
    writeFileSync(file, 'import { expect, expect as check, test } from "vitest";\ntest("t3779b_fixture", async () => {\n' + source + '\n});');
    writeFileSync(config, JSON.stringify({
      jsPlugins: [{ name: "anti-slop", specifier: plugin }],
      rules: { "anti-slop/audit-web-assertions": "error" },
    }));
    try {
      const result = spawnSync("pnpm", ["--silent", "lint", "--no-ignore", "--config", config, "--format", "json", file], { cwd: repo, encoding: "utf8" });
      assert.equal(result.status, kind ? 1 : 0, result.stdout + result.stderr);
      const report = JSON.parse(result.stdout);
      assert.equal(report.number_of_files, 1, "The real lint command must analyze the fixture");
      const diagnostics = report.diagnostics.filter(item => item.code === "anti-slop(audit-web-assertions)");
      assert.equal(diagnostics.length, kind ? 1 : 0, result.stdout);
      if (kind) {
        const observation = JSON.parse(diagnostics[0].message);
        assert.ok(observation.kinds.includes(kind), result.stdout);
        assert.equal(observation.test, "t3779b_fixture");
        assert.match(observation.identity, /^[a-f0-9]{64}$/);
      }
      if (process.env.ASSERTION_FIXTURE_REPORT) appendFileSync(process.env.ASSERTION_FIXTURE_REPORT, JSON.stringify({ name, source, exitCode: result.status, diagnostics: diagnostics.map(item => item.message) }) + "\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
