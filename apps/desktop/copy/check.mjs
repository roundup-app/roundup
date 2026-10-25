import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { parse } from '@babel/parser';
import { checkCopy } from './guard.mjs';
import { candidates } from './provenance.mjs';
import { applyBaseline, inventory } from './baseline.mjs';

const files = Object.fromEntries(readdirSync('src', { recursive: true }).filter(file => /\.tsx?$/.test(file)).map(file => [file, readFileSync(`src/${file}`, 'utf8')]));

const glossary = readFileSync('../../GLOSSARY.md', 'utf8');

const diagnostics = checkCopy(files, glossary);

const base = execFileSync('git', ['merge-base', 'origin/main', 'HEAD'], { encoding: 'utf8' }).trim();

const gitRead = file => {
  const names = execFileSync('git', ['-C', '../..', 'ls-tree', '--name-only', base, '--', file], { encoding: 'utf8' }).trim();

  return names ? execFileSync('git', ['-C', '../..', 'show', `${base}:${file}`], { encoding: 'utf8' }) : null;
};

const previousText = gitRead('apps/desktop/copy/baseline.json');

let previous;

if (previousText) previous = JSON.parse(previousText);
else {
  // Introduction may exempt only exact values already on main, including their branches.
  const source = gitRead('apps/desktop/src/copy.ts');

  if (!source) throw new Error('No baseline or original catalogue at merge base');
  const ast = parse(source, { sourceType: 'module', plugins: ['typescript'] });
  const object = ast.program.body.find(node => node.type === 'ExportNamedDeclaration').declaration.declarations[0].init.expression;
  const reads = object.properties.map(property => `copy.${property.key.name}`).join(',');
  previous = inventory(checkCopy({ 'copy.ts': source, 'Main.tsx': `import {copy} from './copy'; const reads = [${reads}];` }, glossary));
}

const failures = applyBaseline(diagnostics, JSON.parse(readFileSync('copy/baseline.json', 'utf8')), previous);

for (const [file, source] of Object.entries(files)) {
  if (/(\.test\.|Fixture|Browser|Harness|^testing\/|^perf\/|\.d\.ts$|(^|\/)copy\.ts$|^sharedCopy\.ts$)/.test(file)) continue;

  for (const candidate of candidates(source)) failures.push({ file, rule: 'catalogue', identity: candidate.line, text: candidate.text });
}

for (const entry of failures) console.error(`${entry.file ?? 'copy/baseline.json'}: ${entry.rule}: ${entry.identity}: ${entry.text}`);

process.exitCode = failures.length ? 1 : 0;
