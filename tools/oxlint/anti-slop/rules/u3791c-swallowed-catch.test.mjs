import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repo = fileURLToPath(new URL("../../../../", import.meta.url));

test("u3791c_swallowed_catch_lint", () => {
  const dir = mkdtempSync(resolve(repo, "apps/desktop/src/.u3791c-"));
  const cases = [
    ["production.ts", "request.catch(() => undefined);", 1],
    ["production.ts", "request.catch(console.warn);", 1],
    ["production.ts", "request.catch(error => report(error));", 0],
    ["fixture.test.ts", "request.catch(() => undefined);", 0],
    ["apps/desktop/src/testing/helper.ts", "request.catch(console.warn);", 0],
    ["apps/desktop/src/todos/laneBrowser.ts", "request.catch(() => undefined);", 0],
    ["apps/desktop/src/shelf/u371Browser.ts", "request.catch(() => {});", 0],
  ];

  try {
    for (const [path, source, expected] of cases) {
      const file = resolve(dir, path);
      mkdirSync(resolve(file, ".."), { recursive: true });
      writeFileSync(file, source);
      const result = spawnSync(resolve(repo, "node_modules/.bin/oxlint"), ["--config", resolve(repo, ".oxlintrc.json"), file], { cwd: repo, encoding: "utf8" });
      assert.equal(result.status, expected, `${path}: ${source}\n${result.stdout}\n${result.stderr}`);
      if (expected) assert.match(result.stdout, /anti-slop\(no-swallowed-catch\)/);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
