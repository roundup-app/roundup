import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

const run = (files, listed) => {
  const root = mkdtempSync(join(tmpdir(), 'lint-sheets-'));

  try {
    for (const [path, source] of Object.entries({ ...files, '../lazy-sheets.json': JSON.stringify(listed) })) {
      mkdirSync(dirname(join(root, 'apps/desktop/src', path)), { recursive: true });
      writeFileSync(join(root, 'apps/desktop/src', path), source);
    }

    return spawnSync(process.execPath, [new URL('./eager-sheets.mjs', import.meta.url).pathname, root, join(root, 'apps/desktop/lazy-sheets.json')], { encoding: 'utf8', timeout: 10000 });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

const main = 'import "./a.css"; export const Lazy = () => import("./lazy");';

test('u4709d_a_sheet_only_a_lazy_chunk_loads_fails_lint', () => {
  const files = { 'main.tsx': main, 'a.css': '', 'lazy.tsx': 'import "./b.css"; export const l = 1;', 'b.css': '' };

  assert.equal(run(files, {}).status, 1);
  assert.match(run(files, {}).stderr, /b\.css/);
  assert.equal(run({ ...files, 'main.tsx': 'import "./b.css";' + main }, {}).status, 0);
  assert.equal(run(files, { 'b.css': 'lib/index.css' }).status, 1);
});

test('u4709d_a_listed_override_without_its_library_fails_lint', () => {
  const files = { 'main.tsx': main, 'a.css': '', 'lazy.tsx': 'export const l = () => Promise.all([import("lib/index.css"), import("./b.css")]);', 'b.css': '' };

  assert.equal(run(files, { 'b.css': 'lib/index.css' }).status, 0);
  assert.equal(run({ ...files, 'lazy.tsx': 'export const l = () => import("./b.css");' }, { 'b.css': 'lib/index.css' }).status, 1);
});
