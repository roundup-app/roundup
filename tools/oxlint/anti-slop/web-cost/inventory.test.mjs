import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { inventory as discover } from "./inventory.mjs";

async function inventory(files) {
  const root = mkdtempSync(join(tmpdir(), "web-cost-inventory-"));

  try {
    for (const [name, source] of Object.entries(files)) {
      const file = join(root, name);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, source);
    }

    return await discover(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("t3779c_real_daemon_inventory_follows_runtime_imports_to_test_consumers", async () => {
  const report = await inventory({
    "testing/realDaemonFixture.ts": 'throw new Error("do not execute fixtures"); export const start = () => {};',
    "testing/realDaemonPlugin.ts": "export const plugin = () => {};",
    "testing/barrel.ts": 'export { start } from "./realDaemonFixture";',
    "testing/lane.ts": 'import { start } from "./barrel.js"; export const lane = start;',
    "rail/indirect.test.tsx": 'import { lane } from "../testing/lane"; import { it as check } from "vitest"; check("u1_indirect", () => lane());',
    "rail/dynamic.test.ts": 'import { test } from "vitest"; test.skip("u2_dynamic", async () => { const { start } = await import("../testing/realDaemonFixture"); start(); });',
    "rail/plugin.test.ts": 'import { plugin } from "../testing/realDaemonPlugin"; import { it } from "vitest"; it.each([1, 2])("u3_plugin_%i", () => plugin());',
    "rail/type-only.test.ts": 'import type { start } from "../testing/realDaemonFixture"; import { it } from "vitest"; it("u4_no_launch", () => {});',
    "rail/mixed-type.test.ts": 'import { type start } from "../testing/realDaemonFixture"; import { it } from "vitest"; it("u5_no_launch", () => {});',
    "rail/type-barrel.ts": 'export type { start } from "../testing/realDaemonFixture";',
    "rail/type-barrel.test.ts": 'import { start } from "./type-barrel"; import { it } from "vitest"; it("u6_no_launch", () => {});',
    "rail/comment.test.ts": '// startDaemon real_daemon realDaemon\nimport { it } from "vitest"; it("u7_no_launch", () => {});',
    "rail/metadata.json": '{"name":"real_daemon"}',
  });

  assert.deepEqual(report.consumers.map(({ file, tests, path }) => ({ file, tests, path })), [
    { file: "rail/dynamic.test.ts", tests: ["u2_dynamic"], path: ["rail/dynamic.test.ts", "testing/realDaemonFixture.ts"] },
    { file: "rail/indirect.test.tsx", tests: ["u1_indirect"], path: ["rail/indirect.test.tsx", "testing/lane.ts", "testing/barrel.ts", "testing/realDaemonFixture.ts"] },
    { file: "rail/plugin.test.ts", tests: ["u3_plugin_%i"], path: ["rail/plugin.test.ts", "testing/realDaemonPlugin.ts"] },
  ]);
});

test("t3779c_real_daemon_inventory_refuses_an_unresolvable_runtime_dependency", async () => {
  await assert.rejects(inventory({
    "testing/realDaemonFixture.ts": "export const start = () => {};",
    "rail/missing.test.ts": 'import { start } from "../testing/missing"; import { it } from "vitest"; it("u1_missing", () => start());',
  }), /Unresolved runtime dependency/);
});
