import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { data, Evaluator, Lexer, Parser } from '@actions/expressions';
import { parse } from 'yaml';

const root = resolve(import.meta.dirname, '../../..');

const workflow = parse(readFileSync(join(root, '.github/workflows/check.yml'), 'utf8'));

const setup = parse(readFileSync(join(import.meta.dirname, 'action.yml'), 'utf8'));

// Use the exact action downloaded by Actions, including its defaults and complete key builder.
// Locally: RUST_CACHE_ACTION_PATH=/path/to/Swatinem/rust-cache/v2 node --test .github/actions/setup/cache.test.mjs
const actionPath = process.env.RUST_CACHE_ACTION_PATH
  ?? join(dirname(dirname(process.env.GITHUB_WORKSPACE)), '_actions/Swatinem/rust-cache/v2');

const action = parse(readFileSync(join(actionPath, 'action.yml'), 'utf8'));

const bundle = readdirSync(join(actionPath, 'dist')).find(name => name.startsWith('cleanup-'));

const { C: CacheConfig } = await import(pathToFileURL(join(actionPath, 'dist', bundle)));

function evaluate(input, context) {
  const source = String(input).trim().replace(/^\$\{\{\s*|\s*\}\}$/g, '');
  const expression = new Parser(new Lexer(source).lex().tokens, Object.keys(context), []).parse();

  return new Evaluator(expression, JSON.parse(JSON.stringify(context), data.reviver)).evaluate().coerceString();
}

function render(input, context) {
  return String(input).includes('${{') ? evaluate(input, context) : String(input);
}

async function cacheInputs(title, number = 4018, sha = 'first-head', options = {}) {
  const context = {
    github: { event_name: 'pull_request', ref: 'refs/pull/4018/merge', sha,
      event: { pull_request: { title, number } } },
    runner: { os: 'Linux', environment: 'github-hosted' },
    steps: {}, ...options,
  };

  context.env = Object.fromEntries(Object.entries(workflow.env).map(([key, item]) => [key, render(item, context)]));
  // `cache` is the job that saves the Rust cache (L84); the lanes read their base from `rust`.
  const call = workflow.jobs.cache.steps.find(step => step.uses === './.github/actions/setup');
  context.inputs = Object.fromEntries(Object.entries(setup.inputs).map(([key, item]) => [key, item.default]));
  Object.assign(context.inputs, Object.fromEntries(Object.entries(call.with).map(([key, item]) => [key, render(item, context)])));
  const step = setup.runs.steps.find(item => item.id === 'experiment');

  if (step && evaluate(step.if, context) === 'true') {
    const output = join(process.cwd(), 'output');
    writeFileSync(output, '');
    execFileSync('bash', ['-e', '-o', 'pipefail', '-c', step.run], {
      env: { ...process.env, GITHUB_OUTPUT: output,
        ...Object.fromEntries(Object.entries(step.env).map(([key, item]) => [key, render(item, context)])) },
    });
    context.steps.experiment = { outputs: Object.fromEntries(readFileSync(output, 'utf8').trim().split('\n').map(line => line.split('='))) };
  } else {
    context.steps.experiment = { outputs: { namespace: '' } };
  }

  const cache = setup.runs.steps.find(item => item.uses === 'Swatinem/rust-cache@v2');
  const inputs = Object.fromEntries(Object.entries(action.inputs).map(([key, item]) => [key, item.default ?? '']));
  Object.assign(inputs, Object.fromEntries(Object.entries(cache.with).map(([key, item]) => [key, render(item, context)])));

  return { inputs, enabled: evaluate(cache.if, context), base: render(workflow.jobs.rust.env.BASE, context) };
}

// No Cargo compilation or cache service access: the installed action computes its real keys over this tiny workspace.
test('ci4018_experiment_titles_keep_valid_distinct_cache_keys', async () => {
  const cwd = process.cwd();
  const fixture = mkdtempSync(join(tmpdir(), 'ci4018-'));
  const before = { ...process.env };

  try {
    process.chdir(fixture);
    writeFileSync('Cargo.toml', '[package]\nname = "cache-probe"\nversion = "0.1.0"\nedition = "2024"\n[lib]\npath = "lib.rs"\n');
    writeFileSync('lib.rs', '');

    async function keys(title, number, sha) {
      const { inputs, enabled, base } = await cacheInputs(title, number, sha);
      assert.equal(enabled, 'true');
      assert.equal(base, '');
      assert.equal(inputs['save-if'], 'true');
      assert.ok(inputs['shared-key'].startsWith('ci3781-'));
      assert.ok(!inputs['shared-key'].includes('check-Linux'));

      for (const [key, item] of Object.entries(inputs)) process.env[`INPUT_${key.toUpperCase()}`] = item;
      const config = await CacheConfig.new();
      const result = [config.cacheKey, config.restoreKey];

      for (const key of result) {
        assert.ok(!key.includes(','), `invalid comma in ${key}`);
        assert.ok(key.length <= 512, `key too long: ${key.length}`);
      }

      return result;
    }

    const comma = await keys('CI3781 experiment: a,b', 4018, 'first');
    assert.deepEqual(await keys('CI3781 experiment: a,b', 4018, 'second'), comma);

    const variants = [comma,
      await keys('CI3781 experiment: ab', 4018),
      await keys('CI3781 experiment: a-b', 4018),
      await keys('CI3781 experiment: a,b', 4019),
      await keys(`CI3781 experiment: ${'x,'.repeat(200)}`, 4018)];

    for (const index of [0, 1]) assert.equal(new Set(variants.map(keys => keys[index])).size, variants.length);
  } finally {
    process.chdir(cwd);

    for (const key of Object.keys(process.env)) if (!(key in before)) delete process.env[key];
    Object.assign(process.env, before);
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('ci4018_other_paths_retain_cache_selection_and_save_rules', async () => {
  const ordinary = { event_name: 'pull_request', ref: 'refs/pull/4018/merge', event: { pull_request: { title: 'ordinary change', number: 4018 } } };

  for (const [github, runner, shared, save, enabled, base] of [
    [ordinary, { os: 'Linux', environment: 'github-hosted' }, 'check-Linux', 'false', 'true', 'HEAD^1'],
    [{ event_name: 'push', ref: 'refs/heads/main' }, { os: 'Linux', environment: 'github-hosted' }, 'check-Linux', 'true', 'true', ''],
    [{ event_name: 'workflow_dispatch', ref: 'refs/heads/main' }, { os: 'Linux', environment: 'github-hosted' }, 'check-Linux', 'false', 'true', ''],
    [undefined, { os: 'macOS', environment: 'github-hosted' }, 'check-macOS', 'false', 'true', ''],
    [undefined, { os: 'Linux', environment: 'self-hosted' }, null, null, 'false', ''],
  ]) {
    const actual = await cacheInputs('CI3781 experiment: a,b', 4018, 'head', { ...(github && { github }), runner });
    assert.equal(actual.enabled, enabled);
    assert.equal(actual.base, base);

    if (enabled === 'true') {
      assert.equal(actual.inputs['shared-key'], shared);
      assert.equal(actual.inputs['save-if'], save);
    }
  }
});

test('test_ci7615a_tracer_packages_retry_a_failed_apt_call', async () => {
  const step = parse(readFileSync(new URL('./action.yml', import.meta.url), 'utf8')).runs.steps.find(s => s.name === 'Start tracer packages');
  assert.match(step.run, /Acquire::Retries=3/);
  assert.match(step.run, /for attempt in 1 2 3 4/);
  assert.match(step.run, /timeout 180/);
  assert.match(step.run, /Dir::Cache::archives=\$1/);

  const run = async failures => {
    const dir = mkdtempSync(join(tmpdir(), 'ci7615a-'));
    const bin = join(dir, 'bin');
    execFileSync('mkdir', [bin]);
    writeFileSync(join(bin, 'sudo'), '#!/bin/bash\nexec "$@"\n', { mode: 0o755 });
    writeFileSync(join(bin, 'setsid'), '#!/bin/bash\nexec "$@"\n', { mode: 0o755 });
    writeFileSync(join(bin, 'apt-get'), `#!/bin/bash
[ "$1" = update ] && exit 0
n=$(cat "$RUNNER_TEMP/calls" 2>/dev/null || echo 0); echo $((n+1)) >"$RUNNER_TEMP/calls"
[ "$n" -lt ${failures} ] && { echo "E: 503 Service Unavailable" >&2; exit 100; }
exit 0
`, { mode: 0o755 });
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, HOME: dir, RUNNER_TEMP: dir };

    try {
      execFileSync('bash', ['-c', step.run], { env });
      const status = join(dir, 'tracer.status');

      for (let i = 0; i < 100 && !(existsSync(status) && readFileSync(status, 'utf8').trim()); i++) await new Promise(r => setTimeout(r, 50));

      return [readFileSync(status, 'utf8').trim(), readFileSync(join(dir, 'calls'), 'utf8').trim(), readFileSync(join(dir, 'tracer.log'), 'utf8')];
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  assert.deepEqual((await run(1)).slice(0, 2), ['0', '2']);
  const [status, calls, log] = await run(99);
  assert.notEqual(status, '0');
  assert.equal(calls, '4');
  assert.match(log, /503/);
});

test('test_ci7615b_apt_steps_read_no_microsoft_source', async () => {
  const steps = parse(readFileSync(new URL('./action.yml', import.meta.url), 'utf8')).runs.steps;

  for (const name of ['Start tracer packages', 'Start Tauri packages']) {
    const dir = mkdtempSync(join(tmpdir(), 'ci7615b-'));
    const apt = join(dir, 'apt');
    const bin = join(dir, 'bin');
    execFileSync('mkdir', ['-p', bin, join(apt, 'sources.list.d')]);
    writeFileSync(join(bin, 'sudo'), '#!/bin/bash\nexec "$@"\n', { mode: 0o755 });
    writeFileSync(join(bin, 'setsid'), '#!/bin/bash\nexec "$@"\n', { mode: 0o755 });
    writeFileSync(join(bin, 'apt-get'), `#!/bin/bash
if [ "$1" = update ]; then cat "$APT_ETC"/sources.list "$APT_ETC"/sources.list.d/* >"$RUNNER_TEMP/seen"; fi
exit 0
`, { mode: 0o755 });
    const ubuntu = 'deb http://archive.ubuntu.com/ubuntu noble main\n';
    writeFileSync(join(apt, 'sources.list'), `${ubuntu}deb [arch=amd64] https://packages.microsoft.com/ubuntu/24.04/prod noble main\n`);
    writeFileSync(join(apt, 'sources.list.d', 'ubuntu.sources'), 'Types: deb\nURIs: http://azure.archive.ubuntu.com/ubuntu\nSuites: noble\n');
    writeFileSync(join(apt, 'sources.list.d', 'any-name.list'), 'deb https://packages.microsoft.com/repos/azure-cli noble main\n');
    writeFileSync(join(apt, 'sources.list.d', 'ms.sources'), 'Types: deb\nURIs: https://packages.microsoft.com/ubuntu/24.04/prod\nSuites: noble\n\nTypes: deb\nURIs: http://archive.ubuntu.com/mixed\nSuites: noble\n');
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, HOME: dir, RUNNER_TEMP: dir, APT_ETC: apt };

    try {
      execFileSync('bash', ['-c', steps.find(s => s.name === name).run], { env });
      const status = join(dir, name.includes('tracer') ? 'tracer.status' : 'apt.status');

      for (let i = 0; i < 100 && !(existsSync(status) && readFileSync(status, 'utf8').trim()); i++) await new Promise(r => setTimeout(r, 50));

      const seen = readFileSync(join(dir, 'seen'), 'utf8');
      assert.doesNotMatch(seen, /packages\.microsoft\.com/, name);
      assert.match(seen, /archive\.ubuntu\.com\/ubuntu noble main/, name);
      assert.match(seen, /azure\.archive\.ubuntu\.com/, name);
      assert.match(seen, /archive\.ubuntu\.com\/mixed/, name);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});
