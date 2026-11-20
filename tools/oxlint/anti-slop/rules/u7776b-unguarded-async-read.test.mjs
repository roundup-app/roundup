import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repo = fileURLToPath(new URL("../../../../", import.meta.url));

test("u7776b_lint_flags_unguarded_async_reactive_read", () => {
  const dir = mkdtempSync(resolve(repo, "apps/desktop/src/.u7776b-"));
  const cases = [
    ["flagged.ts", "createMemo(async () => (await rpc()).refs);", 1],
    ["flagged.ts", "createSignal(async () => await rpc());", 1],
    ["guarded.ts", "createMemo(async () => { try { return await rpc(); } catch { return []; } });", 0],
    ["guarded.ts", "createSignal(async () => rpc().catch(() => []));", 0],
    ["guarded.ts", "createMemo(async () => { await failureOf(() => rpc()); });", 0],
    ["guarded.ts", "// read-guarded: the effect shows it.\ncreateMemo(async () => rpc());", 0],
  ];

  try {
    for (const [name, source, expected] of cases) {
      const file = resolve(dir, name);
      writeFileSync(file, source);
      const result = spawnSync(resolve(repo, "node_modules/.bin/oxlint"), ["--config", resolve(repo, ".oxlintrc.json"), file], { cwd: repo, encoding: "utf8" });
      const flagged = /anti-slop\(no-unguarded-async-read\)/.test(result.stdout);
      assert.equal(flagged, expected === 1, `${name}: ${source}\n${result.stdout}`);
      if (flagged) assert.match(result.stdout, /flagged\.ts/);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
