import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

for (const [name, files, status] of [
  ['acyclic', { 'a.ts': 'export type A = string', 'b.tsx': 'import type { A } from "./a"; export type B = A' }, 0],
  ['type imports', { 'a.ts': 'import type { B } from "./b"; export type A = B', 'b.tsx': 'import type { A } from "./a"; export type B = A' }, 1],
  ['type reexports', { 'a.ts': 'export type { B } from "./b";', 'b.ts': 'export type { A } from "./a";' }, 1],
  ['self import', { 'a.ts': 'import type { A } from "./a"; export type B = A' }, 1],
  ['unresolved graph', { 'a.ts': 'import { missing } from "./missing"; export const a = missing;' }, 2],
  ['invalid syntax', { 'a.ts': 'export const =' }, 2],
  ['mixed edges', { 'a.tsx': 'import { b } from "./b"; export const a = b;', 'b.ts': 'import type { a } from "./a"; export const b: typeof a = 0;' }, 1],
]) {
  test(`t3797a_cycles_include_types: ${name}`, () => {
    const root = mkdtempSync(join(tmpdir(), 'lint-cycle-'));

    try {
      mkdirSync(join(root, 'apps/desktop/src'), { recursive: true });
      writeFileSync(join(root, 'apps/desktop/tsconfig.json'), '{"compilerOptions":{"jsx":"preserve"}}');

      for (const [path, source] of Object.entries(files)) writeFileSync(join(root, 'apps/desktop/src', path), source);
      const result = spawnSync(process.execPath, [new URL('./cycles.mjs', import.meta.url).pathname, root], { encoding: 'utf8' });
      assert.equal(result.status, status, result.stdout + result.stderr);

      if (status === 1) assert.match(result.stdout, /a\.ts/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
