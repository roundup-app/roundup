import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkCopy } from './guard.mjs';

const root = fileURLToPath(new URL('../src/', import.meta.url));

const files = Object.fromEntries(readdirSync(root, { recursive: true }).filter(file => /\.tsx?$/.test(file) && !/(\.test\.|Fixture|Browser|Harness|^testing\/|^perf\/|\.d\.ts$)/.test(file)).map(file => [file, readFileSync(root + file, 'utf8')]));

const baseline = JSON.parse(readFileSync(new URL('./baseline.json', import.meta.url), 'utf8'));

const base = execFileSync('git', ['merge-base', 'origin/main', 'HEAD'], { encoding: 'utf8' }).trim();

let previous;

try {
  previous = JSON.parse(execFileSync('git', ['show', `${base}:apps/desktop/copy/baseline.json`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
} catch {
  // On introduction, compare against the unchanged merge-base catalogue, not the proposed exemptions.
  const originalFiles = Object.fromEntries(Object.keys(files).flatMap(file => {
    try { return [[file, execFileSync('git', ['show', `${base}:apps/desktop/src/${file}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })]]; }
    catch { return []; }
  }));

  previous = checkCopy(originalFiles, { root, glossary: readFileSync(new URL('../../../GLOSSARY.md', import.meta.url), 'utf8') }).inventory;
}

const result = checkCopy(files, { root, glossary: readFileSync(new URL('../../../GLOSSARY.md', import.meta.url), 'utf8'), baseline, previous });

if (process.argv.includes('--inventory')) process.stdout.write(JSON.stringify(result.inventory) + '\n');
else {
  for (const diagnostic of result.diagnostics) process.stderr.write(diagnostic.message + '\n');
  process.exitCode = result.diagnostics.length ? 1 : 0;
}
