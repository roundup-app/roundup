import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { checkStartup } from './startup.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fixture = (t, modules = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'r3800-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, '.vite'));
  const files = { 'index.html': '<script type="module" src="/entry.js"></script>', 'entry.js': 'export default 1;', 'shared.js': 'export default 2;', 'lazy.js': 'export default 3;' };
  const manifest = {
    'index.html': { file: 'entry.js', isEntry: true, imports: ['shared'], dynamicImports: ['lazy'] },
    shared: { file: 'shared.js', imports: ['index.html'] }, lazy: { file: 'lazy.js' },
  };
  files['.vite/manifest.json'] = JSON.stringify(manifest);
  for (const [file, bytes] of Object.entries(files)) writeFileSync(join(dir, file), bytes);
  const metadata = { files: Object.fromEntries(Object.entries(files).map(([file, bytes]) => [file, hash(bytes)])), chunks: Object.fromEntries(['entry.js', 'shared.js', 'lazy.js'].map(file => [file, modules[file] ?? ['/src/main.tsx']])) };
  const save = () => writeFileSync(join(dir, '.vite/modules.json'), JSON.stringify(metadata));
  save();
  const size = gzipSync(files['entry.js'], { level: 9 }).length + gzipSync(files['shared.js'], { level: 9 }).length;
  const config = join(dir, 'budget.json');
  const budget = ceiling => writeFileSync(config, JSON.stringify({ entryGzipBytes: ceiling }));
  budget(size + 1);
  return { dir, config, size, metadata, save, budget, run: () => checkStartup(dir, config) };
};

test('r3800_entry_budget_counts_static_closure', t => {
  const f = fixture(t);
  assert.equal(f.run().exit, 0);
  assert.equal(f.run().gzip, f.size);
  assert.deepEqual(f.run().files, ['entry.js', 'shared.js']);
  f.budget(f.size);
  assert.equal(f.run().exit, 1);
  f.budget(f.size - 1);
  assert.equal(f.run().exit, 1);
});

test('r3800_entry_budget_rejects_eager_modules', t => {
  for (const family of ['@xterm/xterm', '@xterm/addon-fit', '@dnd-kit/dom']) {
    const f = fixture(t, { 'shared.js': [`/node_modules/${family}/index.js`] });
    const result = f.run();
    assert.equal(result.exit, 1);
    assert.ok(result.diagnostic.includes(family));
    assert.ok(result.diagnostic.includes('shared.js'));
  }
  assert.equal(fixture(t, { 'lazy.js': ['/node_modules/@xterm/xterm/index.js'] }).run().exit, 0);
});

test('r3800_entry_budget_invalid_input_is_an_error', t => {
  const changes = [
    f => rmSync(f.config),
    f => writeFileSync(f.config, '{}'),
    f => writeFileSync(f.config, '{'),
    f => rmSync(join(f.dir, 'index.html')),
    f => { writeFileSync(join(f.dir, 'index.html'), '<script src="unknown.js" type="module"></script>'); f.metadata.files['index.html'] = hash(readFileSync(join(f.dir, 'index.html'))); f.save(); },
    f => rmSync(join(f.dir, '.vite/manifest.json')),
    f => writeFileSync(join(f.dir, '.vite/manifest.json'), '{}'),
    f => rmSync(join(f.dir, '.vite/modules.json')),
    f => { f.metadata.chunks['entry.js'] = []; f.save(); },
    f => { delete f.metadata.chunks['shared.js']; f.save(); },
    f => rmSync(join(f.dir, 'shared.js')),
    f => writeFileSync(join(f.dir, 'shared.js'), 'different build'),
    f => writeFileSync(join(f.dir, '.vite/manifest.json'), '{'),
    f => { f.metadata.files['index.html'] = 'invalid'; f.save(); },
  ];
  for (const change of changes) {
    const f = fixture(t);
    change(f);
    const result = f.run();
    assert.equal(result.exit, 2, result.diagnostic);
    assert.ok(result.diagnostic.length > 0);
  }
});
