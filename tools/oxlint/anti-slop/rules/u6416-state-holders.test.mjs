import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repo = fileURLToPath(new URL("../../../../", import.meta.url));

test("u6416_state_holder_lints", () => {
  const dir = mkdtempSync(resolve(repo, "apps/desktop/src/.u6416-"));
  const cases = [
    ["no-signal-poke", "setVersion(previous => previous + 1);", 1],
    ["no-signal-poke", "setAll(all => [...all]);", 1],
    ["no-signal-poke", "setSeen(seen => new Set(seen));", 1],
    ["no-signal-poke", "setAll(all => [...all, 1]);", 0],
    ["no-signal-poke", "setCount(count => count + 2);", 0],
    ["no-promise-chain-queue", "let writes = Promise.resolve(); writes = writes.then(() => work());", 1],
    ["no-promise-chain-queue", "let writes = Promise.resolve(); writes = writes.then(a).catch(b);", 1],
    ["no-promise-chain-queue", "let writes = Promise.resolve(); writes = other.then(() => work());", 0],
    ["no-draft-bypass", "drafts.settle(revision, \"acknowledged\"); setTimeout(() => {}, 15_000);", 1],
    ["no-draft-bypass", "lifetime.settle(); setTimeout(() => {}, 500);", 0],
    ["no-repair-effect", "const [a, setA] = createSignal(0); createEffect(() => { if (b() === null) setA(0); });", 1],
    ["no-repair-effect", "const [a, setA] = createSignal(0); createEffect(on(key, () => setA(0)));", 1],
    ["no-repair-effect", "const [a, setA] = createSignal(0); createEffect(on(key, (value, previous) => { if (previous) setA(0); }));", 0],
    ["no-repair-effect", "const [a, setA] = createSignal(0); createEffect(() => { push(b()); setA(0); });", 0],
    ["no-stale-counter", "let latest = 0; const run = () => ++latest;", 1],
    ["no-stale-counter", "let alive = true; onCleanup(() => { alive = false; });", 1],
    ["no-stale-counter", "let latest = 5; const total = latest + 1;", 0],
    ["no-promise-chain-queue", "const queue = createQueue(); queue.add(() => work());", 0],
  ];

  try {
    cases.forEach(([rule, source, expected], index) => {
      const file = resolve(dir, `case${index}.ts`);
      writeFileSync(file, source);
      const result = spawnSync(resolve(repo, "node_modules/.bin/oxlint"), ["--config", resolve(repo, ".oxlintrc.json"), file], { cwd: repo, encoding: "utf8" });
      const hit = result.stdout.includes(`anti-slop(${rule})`);
      assert.equal(hit, expected === 1, `${rule}: ${source}\n${result.stdout}\n${result.stderr}`);
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
