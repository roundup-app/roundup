import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

it("u2749c_lint_rejects_tooltip_bypasses", () => {
  const root = resolve(import.meta.dirname, "../../../..");
  const temporary = mkdtempSync(join(tmpdir(), "u2749-"));

  const cases = [
    ["ark", "ask", 1], ["root", "ask", 1], ["title", "ask", 1], ["component-title", "ask", 1],
    ["tip", "ask", 0], ["primitive", "ui", 0],
  ] as const;

  try {
    for (const [fixture, directory, expected] of cases) {
      const folder = join(temporary, "apps/desktop/src", directory);
      mkdirSync(folder, { recursive: true });
      const path = join(folder, `${fixture}.tsx`);
      writeFileSync(path, readFileSync(join(root, "tools/oxlint/tooltip-fixtures", `${fixture}.tsx.txt`)));
      const result = spawnSync(join(root, "node_modules/.bin/oxlint"), ["--config", join(root, ".oxlintrc.json"), path], { cwd: root, encoding: "utf8" });
      console.log(`${fixture}: exit ${result.status}`);
      expect(result.status, result.stdout + result.stderr).toBe(expected);

      if (expected !== 0) expect(result.stdout + result.stderr).toContain("no-tooltip-bypass");
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
