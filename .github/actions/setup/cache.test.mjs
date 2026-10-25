import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
  ?? join(dirname(process.env.GITHUB_WORKSPACE), '_actions/Swatinem/rust-cache/v2');
const action = parse(readFileSync(join(actionPath, 'action.yml'), 'utf8'));
const bundle = readdirSync(join(actionPath, 'dist')).find(name => name.startsWith('cleanup-'));
const { C: CacheConfig } = await import(pathToFileURL(join(actionPath, 'dist', bundle)));

function value(input) {
  if (typeof input === 'string') return new data.StringData(input);
  if (typeof input === 'number') return new data.NumberData(input);
  if (typeof input === 'boolean') return new data.BooleanData(input);
  return new data.Dictionary(...Object.entries(input).map(([key, item]) => ({ key, value: value(item) })));
}

function evaluate(input, context) {
  if (typeof input !== 'string') return String(input);
  const source = input.trim().replace(/^\$\{\{\s*|\s*\}\}$/g, '');
  const expression = new Parser(new Lexer(source).lex().tokens, Object.keys(context), []).parse();
  return new Evaluator(expression, value(context)).evaluate().coerceString();
}

function render(input, context) {
  return typeof input === 'string' && input.includes('${{') ? evaluate(input, context) : String(input);
}

async function cacheInputs(title, number = 4018, sha = 'first-head', options = {}) {
  const context = {
    github: { event_name: 'pull_request', ref: 'refs/pull/4018/merge', sha,
      event: { pull_request: { title, number } } },
    runner: { os: 'Linux', environment: 'github-hosted' },
    matrix: { partition: 1 }, steps: {}, ...options,
  };
  context.env = Object.fromEntries(Object.entries(workflow.env).map(([key, item]) => [key, render(item, context)]));
  const call = workflow.jobs.rust.steps.find(step => step.uses === './.github/actions/setup');
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
