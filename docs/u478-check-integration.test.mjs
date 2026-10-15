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
  const result = spawnSync('just', args, { stdio: ['ignore', fd, fd], env: { ...process.env, NODE_TEST_CONTEXT: undefined } });
  closeSync(fd);
  assert.ifError(result.error);
  const output = readFileSync(log, 'utf8');
  console.log(`| just ${args.join(' ')} | ${label} | ${result.status} | ${log} |`);

  if (expectedFailure) {
    assert.equal(result.status, 1, log);
    assert.match(output, expectedFailure, log);

    // A different failed leaf is an unrelated failure, never proof of rejection.
    const aggregates = ['just lint-web', `just check-web '${args[1] ?? ''}'`];

    const leaves = [...output.matchAll(/^  (.+) \(exit \d+\)$/gm)]
      .flatMap((match) => aggregates.includes(match[1]) ? [] : [match[1]]);

    assert.deepEqual([...new Set(leaves)], [label === 'raw padding' ? 'pnpm lint:styles' : 'pnpm tokens:check'], log);
  } else {
    assert.equal(result.status, 0, log);
  }
}

const prefix = '/* fallow-ignore-file unused-file -- isolated check discovery fixture */\n';

for (const base of [[], ['origin/main']]) {
  test(`u478_raw_values_fail_the_check_gate ${base.join(' ')}`, () => {
    assert.equal(existsSync(probe), false, 'probe path must be free');

    try {
      // This unused fixture is intentionally not imported. No Stylelint exception.
      writeFileSync(probe, prefix + '.probe { padding: 7px }\n', { flag: 'wx' });
      check(['check', ...base], 'raw padding', /u478-integration-probe\.css[\s\S]*Expected variable or keyword for "7px"[\s\S]*scale-unlimited\/declaration-strict-value/);
    } finally {
      unlinkSync(probe);
    }
  });
}

test('u478_token_backed_padding_passes_the_shared_lint_boundary', () => {
  assert.equal(existsSync(probe), false, 'probe path must be free');

  try {
    writeFileSync(probe, prefix + '.probe { padding: 0 var(--space-1) }\n', { flag: 'wx' });
    check(['lint-web'], 'Token-backed padding');
  } finally {
    unlinkSync(probe);
  }
});

test('u478_reference_tracks_tokens hook', () => {
  assert.equal(existsSync(observer), false, '#1852 observer must not be overwritten');

  try {
    // #1852 owns the real generator, reference and stale-output observer.
    writeFileSync(observer, "import { test } from 'node:test';\n\ntest('u478 freshness hook', () => { throw new Error('U478 freshness observer reached'); });\n", { flag: 'wx' });
    check(['lint-web'], 'freshness failure', /U478 freshness observer reached/);
  } finally {
    unlinkSync(observer);
  }
});

test('u478_clean_app_passes_check_origin_main', () => {
  check(['check', 'origin/main'], 'clean App');
});
