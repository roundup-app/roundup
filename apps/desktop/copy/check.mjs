import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkCopy } from './guard.mjs';

const root = fileURLToPath(new URL('../src/', import.meta.url));

const sourceFiles = readdirSync(root, { recursive: true }).filter(file => /\.tsx?$/.test(file));

const files = Object.fromEntries(sourceFiles.map(file => [file, readFileSync(root + file, 'utf8')]));

const glossary = readFileSync(new URL('../../../GLOSSARY.md', import.meta.url), 'utf8');

const git = args => execFileSync('git', args, { cwd: fileURLToPath(new URL('../../../', import.meta.url)), encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });

const base = git(['merge-base', 'origin/main', 'HEAD']).trim();

const paths = git(['ls-tree', '-r', '--name-only', base]).trim().split('\n');

const baselinePath = 'apps/desktop/copy/baseline.json';

const previous = paths.includes(baselinePath)
  ? JSON.parse(git(['show', `${base}:${baselinePath}`]))
  : checkCopy(Object.fromEntries(paths.filter(file => file.startsWith('apps/desktop/src/') && /\.tsx?$/.test(file)).map(file => [file.slice('apps/desktop/src/'.length), git(['show', `${base}:${file}`])])), { root, glossary: git(['show', `${base}:GLOSSARY.md`]) }).inventory;

if (process.argv.includes('--inventory')) {
  process.stdout.write(JSON.stringify(checkCopy(files, { root, glossary, previous }).inventory) + '\n');
} else {
  const baseline = JSON.parse(readFileSync(new URL('./baseline.json', import.meta.url), 'utf8'));
  const result = checkCopy(files, { root, glossary, baseline, previous });

  for (const diagnostic of result.diagnostics) process.stderr.write(diagnostic.message + '\n');
  process.exitCode = result.diagnostics.length ? 1 : 0;
}
