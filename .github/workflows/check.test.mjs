import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parse } from 'yaml';

const workflow = parse(readFileSync(new URL('./check.yml', import.meta.url), 'utf8'));
const step = workflow.jobs.check.steps.find(step => step.env?.NEEDS);
const dependencies = ['plan', 'rust', 'mac-clippy', 'mac', 'mac-package', 'web', 'chromium'];
const success = Object.fromEntries(dependencies.map(name => [name, 'success']));
const dispatch = { ...success, 'mac-package': 'skipped' };

function gateRow(scenario, event, results, expected, row) {
  test(`${scenario}: ${event}, ${row}, exit ${expected}`, () => {
    const needs = Object.fromEntries(Object.entries(results).map(([name, result]) => [name, { result }]));
    const actual = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', step.run], {
      env: { ...process.env, NEEDS: JSON.stringify(needs), EVENT: event },
      encoding: 'utf8',
      timeout: 2000,
    });
    assert.equal(actual.status, expected,
      `expected exit ${expected}, actual ${actual.status}; signal=${actual.signal}; error=${actual.error}\nstdout:\n${actual.stdout}\nstderr:\n${actual.stderr}`);
  });
}

gateRow('ci5915a_dispatch_accepts_only_the_packaging_skip', 'workflow_dispatch', dispatch, 0, 'only mac-package skipped');
for (const name of dependencies.filter(name => name !== 'mac-package')) {
  gateRow('ci5915a_dispatch_accepts_only_the_packaging_skip', 'workflow_dispatch',
    { ...dispatch, [name]: 'skipped' }, 1, `${name}=skipped`);
}
