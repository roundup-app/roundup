import assert from 'node:assert/strict';
import test from 'node:test';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// CI7297e: a null `started_at` on the running step reads as now; the step prints its line and exits 0 with no warning.
test('CI7297e a null started_at of the job time step exits 0 with no warning', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lane-budget-'));

  const reply = {
    started_at: new Date().toISOString(),
    steps: [
      { name: 'test-rust', started_at: null, completed_at: null },
      { name: 'CI7297e mac job time', started_at: null, completed_at: null },
    ],
  };

  writeFileSync(join(dir, 'gh'), `#!/bin/sh\necho '${JSON.stringify(reply)}'\n`);
  chmodSync(join(dir, 'gh'), 0o755);

  const r = spawnSync(
    'python3',
    ['-I', join(dirname(fileURLToPath(import.meta.url)), 'lane-budget.py'), '--job', 'mac', '300', 'test-rust'],
    {
      encoding: 'utf8',
      env: {
        PATH: `${dir}:${process.env.PATH}`,
        GITHUB_REPOSITORY: 'o/r',
        GITHUB_RUN_ID: '1',
        GITHUB_RUN_ATTEMPT: '1',
      },
    },
  );

  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /mac: job /);
  assert.doesNotMatch(r.stdout, /::warning::/);
});
