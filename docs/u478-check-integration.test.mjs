// Run explicitly: pnpm test:token-integration. Never nest this observer in check.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync, unlinkSync, mkdtempSync, readFileSync, openSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const logs = mkdtempSync(join(tmpdir(), 'u478-check-'));

const probe = 'apps/desktop/src/u478-integration-probe.css';

const observer = 'docs/ui-tokens.test.mjs';

let sequence = 0;

function check(args, label, expectedFailure) {
  const log = join(logs, `${++sequence}.log`);
  const fd = openSync(log, 'wx');
  // A nested Node observer must run its own tests, outside this runner’s context.
  const result = spawnSync('just', ['check', ...args], { stdio: ['ignore', fd, fd], env: { ...process.env, NODE_TEST_CONTEXT: undefined } });
  closeSync(fd);
  assert.ifError(result.error);
  const output = readFileSync(log, 'utf8');
  console.log(`| just check ${args.join(' ')} | ${label} | ${result.status} | ${log} |`);

  if (expectedFailure) {
    assert.equal(result.status, 1, log);
    assert.match(output, expectedFailure, log);

    // A different failed leaf is an unrelated failure, never proof of rejection.
    const leaves = [...output.matchAll(/^  (.+) \(exit \d+\)$/gm)]
      .flatMap((match) => match[1].startsWith('just ') ? [] : [match[1]]);

    assert.deepEqual([...new Set(leaves)], [label === 'raw padding' ? 'pnpm lint:styles' : 'pnpm tokens:check'], log);
  } else {
    assert.equal(result.status, 0, log);
  }
}

for (const args of [[], ['origin/main']]) {
  test(`u478_raw_values_fail_the_check_gate ${args.join(' ')}`, () => {
    assert.equal(existsSync(probe), false, 'probe path must be free');

    try {
      // This unused fixture is intentionally not imported. No Stylelint exception.
      const prefix = '/* fallow-ignore-file unused-file -- isolated check discovery fixture */\n';
      writeFileSync(probe, prefix + '.probe { padding: 7px }\n', { flag: 'wx' });
      check(args, 'raw padding', /u478-integration-probe\.css[\s\S]*Expected variable or keyword for "7px"[\s\S]*scale-unlimited\/declaration-strict-value/);
      writeFileSync(probe, prefix + '.probe { padding: 0 var(--space-1) }\n');
      check(args, 'Token-backed padding');
    } finally {
      unlinkSync(probe);
    }

    check(args, 'clean App');
  });

  test(`u478_reference_tracks_tokens hook ${args.join(' ')}`, () => {
    assert.equal(existsSync(observer), false, '#1852 observer must not be overwritten');

    try {
      // #1852 owns the real generator, reference and stale-output observer.
      writeFileSync(observer, "import { test } from 'node:test';\ntest('u478 freshness hook', () => { throw new Error('U478 freshness observer reached'); });\n", { flag: 'wx' });
      check(args, 'freshness failure', /U478 freshness observer reached/);
    } finally {
      unlinkSync(observer);
    }
  });
}
