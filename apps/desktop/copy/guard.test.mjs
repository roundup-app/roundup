import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkCopy } from './guard.mjs';

const fixture = (copy, caller = 'copy.open') => ({
  'app/copy.ts': `export const copy = {${copy}};`,
  'app/View.tsx': `import { copy } from './copy'; const view = <button>{${caller}}</button>;`,
});

test('u471_copy_modules_belong_to_their_surfaces', () => {
  assert.deepEqual(checkCopy(fixture('open: "Open"')), []);
  assert.ok(checkCopy({ ...fixture('open: "Open"'), 'rail/View.tsx': `import {copy} from '../app/copy'; const v = <button>{copy.open}</button>;` }).some(d => d.rule === 'ownership'));
  assert.ok(checkCopy({ ...fixture('open: "Open"'), 'copy.ts': 'export const copy = {};' }).some(d => d.rule === 'ownership'));
});

test('u471_copy_guard_rejects_unused_and_duplicate_values', () => {
  assert.ok(checkCopy(fixture('open: "Open", unused: "Unused"')).some(d => d.rule === 'unused'));
  assert.ok(checkCopy(fixture('open: "Open", again: "Open"', 'copy.open + copy.again')).some(d => d.rule === 'duplicate'));

  for (const use of ['copy["open"]', '(() => { const alias = copy; return alias.open; })()', '(() => { const {open} = copy; return open; })()']) assert.deepEqual(checkCopy(fixture('open: "Open"', use)), []);
  assert.ok(checkCopy(fixture('open: "Open"', 'copy[unknown]')).some(d => d.rule === 'dynamic'));
});

test('u471_copy_guard_rejects_long_labels_sentences_and_fragments', () => {
  for (const text of ['Open this selected Agent', 'This sentence has thirteen separate words and must fail the copy length check.', 'Storage unavailable.']) assert.ok(checkCopy(fixture(`open: ${JSON.stringify(text)}`)).some(d => ['length', 'fragment'].includes(d.rule)), text);

  for (const text of ['Storage', 'Storage is unavailable.', 'Try again.']) assert.deepEqual(checkCopy(fixture(`open: ${JSON.stringify(text)}`)), [], text);
});

test('u471_copy_guard_rejects_internal_vocabulary', () => {
  for (const text of ['Daemon', 'MCP', 'session', 'revision', 'retained', 'acceptance', 'Tasks', 'PARENT AGENTS']) assert.ok(checkCopy(fixture(`open: ${JSON.stringify(text)}`), '_Avoid_: task, parent agent').some(d => d.rule === 'vocabulary'), text);
  assert.deepEqual(checkCopy(fixture('open: (name: string) => `Open ${name}`', 'copy.open("Daemon task")'), '_Avoid_: task'), []);
  assert.deepEqual(checkCopy(fixture('open: "Multitasking"'), '_Avoid_: task'), []);
});

test('u471_copy_guard_uses_one_recovery_name', () => {
  for (const text of ['Drafts', 'Retained work', 'Revision', 'Unfinished rail work']) assert.ok(checkCopy(fixture(`open: ${JSON.stringify(text)}`)).some(d => d.rule === 'recovery'), text);
  assert.deepEqual(checkCopy(fixture('open: "Unfinished work"')), []);
});

test('u471_copy_allowlist_only_shrinks', async () => {
  const { applyBaseline, inventory } = await import('./baseline.mjs');
  const current = checkCopy(fixture('open: "Draft"'));
  const baseline = inventory(current);
  assert.deepEqual(applyBaseline(current, baseline, baseline), []);
  assert.deepEqual(applyBaseline(current.map(row => ({ ...row, file: 'moved/copy.ts' })), baseline, baseline), []);
  assert.ok(applyBaseline(checkCopy(fixture('open: "New drafts"')), baseline, baseline).length);
  assert.ok(applyBaseline(checkCopy(fixture('open: "Draft", again: "New drafts"', 'copy.open + copy.again')), baseline, baseline).length);
  assert.ok(applyBaseline([], baseline, baseline).some(row => row.rule === 'baseline'));
  const expanded = inventory(checkCopy(fixture('open: "New drafts"')));
  assert.ok(applyBaseline(checkCopy(fixture('open: "New drafts"')), expanded, baseline).some(row => row.rule === 'baseline'));
  assert.ok(applyBaseline(current, [{ rule: 'recovery', identity: '*', branch: 0, fingerprint: '*' }], baseline).some(row => row.rule === 'baseline'));
});

test('u471_copy_guard_rejects_unused_and_duplicate_values_nested', () => {
  assert.ok(checkCopy(fixture('open: { yes: "Open", unused: "Unused" }', 'copy.open.yes')).some(d => d.rule === 'unused' && d.identity.endsWith('.unused')));
  assert.ok(checkCopy({ ...fixture('open: "Open"'), 'app/Unused.test.ts': `import {copy} from './copy'; copy.open;`, 'app/View.tsx': '' }).some(d => d.rule === 'unused'));
});

test('u471_copy_guard_rejects_unused_and_duplicate_values_shared_references', () => {
  const files = { ...fixture('open: shared.open'), 'sharedCopy.ts': 'export const copy = {open: "Open"};', 'rail/copy.ts': `import {copy as shared} from '../sharedCopy'; export const copy = {open: shared.open};`, 'rail/View.tsx': `import {copy} from './copy'; const v = <button>{copy.open}</button>;` };
  files['app/copy.ts'] = `import {copy as shared} from '../sharedCopy'; ${files['app/copy.ts']}`;
  assert.deepEqual(checkCopy(files), []);
  files['app/copy.ts'] += 'const dead = shared.open;';
  files['app/View.tsx'] = '';
  files['rail/View.tsx'] = '';
  assert.ok(checkCopy(files).some(d => d.rule === 'unused' && d.identity === 'sharedCopy.ts:copy.open'));
});

test('u471_copy_guard_rejects_internal_vocabulary_in_helpers_and_branches', () => {
  const files = fixture('open: (value: boolean) => helper(value)');
  files['app/copy.ts'] = `const helper = (value: boolean) => value ? "Daemon" : "Revisions"; ${files['app/copy.ts']}`;
  assert.deepEqual(new Set(checkCopy(files).filter(d => d.rule === 'vocabulary').map(d => d.text)), new Set(['Daemon', 'revision']));
});

test('u471_copy_guard_rejects_internal_vocabulary_from_the_glossary', async () => {
  const { readFileSync } = await import('node:fs');
  const glossary = readFileSync(new URL('../../../GLOSSARY.md', import.meta.url), 'utf8');

  for (const word of ['bot', 'worker', 'process', 'console', 'shell integration', 'overlay', 'popup', 'summon', 'fling', 'room', 'folder', 'meta-agent', 'parent agent', 'lead', 'child agent', 'sub-agent', 'roll back', 'task', 'ticket', 'assignee', 'scratchpad', 'upload', 'temp image', 'notification', 'inject', 'nudge', 'cancel', 'abort', 'chat', 'main agent', 'processes', 'tickets']) {
    assert.ok(checkCopy(fixture(`open: ${JSON.stringify(word)}`), glossary).some(row => row.rule === 'vocabulary'), word);
  }
});
