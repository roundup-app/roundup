import { readFileSync, lstatSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { JSDOM } from 'jsdom';
import * as v from 'valibot';

/** R3800: inspect emitted bytes and Vite's graph, never parse compiled JavaScript. */
export function checkStartup(directory, configPath) {
  try {
    const root = resolve(directory);
    const fail = message => { throw new Error(message); };

    const json = (path, schema) => {
      try { return v.parse(schema, JSON.parse(readFileSync(path, 'utf8'))); }
      catch (error) {
        const cause = v.isValiError(error)
          ? error.issues.map(issue => `${v.getDotPath(issue) ?? '<root>'}: ${issue.message}`).join('; ')
          : error.message;

        return fail(`${path}: ${cause}`);
      }
    };

    const config = json(configPath, v.object({ entryGzipBytes: v.pipe(v.number(), v.safeInteger(), v.minValue(1)) }));

    const read = file => {
      if (!file || isAbsolute(file) || relative(root, resolve(root, file)).startsWith('..')) fail(`invalid artifact path: ${file}`);
      const path = resolve(root, file);

      // A production artifact is a regular file; no link can borrow bytes outside this build.
      for (let parent = path; parent !== root; parent = resolve(parent, '..')) {
        if (lstatSync(parent).isSymbolicLink()) fail(`${path}: symlink`);
      }

      if (!lstatSync(path).isFile()) fail(`${path}: not a regular file`);

      return readFileSync(path);
    };

    const manifestPath = '.vite/manifest.json';
    const metadataPath = '.vite/modules.json';
    const nonempty = v.pipe(v.string(), v.nonEmpty());

    const manifest = json(resolve(root, manifestPath), v.record(nonempty, v.object({
      file: nonempty, isEntry: v.optional(v.boolean()), imports: v.optional(v.array(nonempty)), dynamicImports: v.optional(v.array(nonempty)),
    })));

    const metadata = json(resolve(root, metadataPath), v.object({
      files: v.record(nonempty, v.pipe(v.string(), v.regex(/^[a-f0-9]{64}$/))),
      chunks: v.record(nonempty, v.array(nonempty)),
    }));

    if (Object.keys(manifest).length === 0) fail(`${manifestPath}: invalid manifest`);
    const verified = new Map();

    const verify = file => {
      if (verified.has(file)) return verified.get(file);
      const expected = metadata.files[file];

      if (!expected) fail(`${metadataPath}: invalid hash for ${file}`);
      const bytes = read(file);

      if (createHash('sha256').update(bytes).digest('hex') !== expected) fail(`${file}: build/metadata mismatch`);
      verified.set(file, bytes);

      return bytes;
    };

    verify(manifestPath);
    const document = new JSDOM(verify('index.html').toString()).window;
    const scripts = [...document.document.querySelectorAll('script[type="module"][src]')].map(script => script.getAttribute('src'));
    document.close();

    if (scripts.length !== 1) fail('index.html: expected one App module entry');
    const entry = scripts[0].replace(/^\//, '');
    const entries = Object.entries(manifest).filter(([, chunk]) => chunk.isEntry === true && chunk.file === entry);

    if (entries.length !== 1) fail(`index.html: unresolved entry ${entry}`);

    // Validate every graph record, including dynamic-only chunks, so incomplete metadata cannot pass.
    for (const [key, chunk] of Object.entries(manifest)) {
      for (const field of ['imports', 'dynamicImports']) {
        const edges = chunk[field] ?? [];

        if (edges.some(edge => !Object.hasOwn(manifest, edge))) fail(`${manifestPath}: invalid ${field} edge in ${key}`);
      }

      if (!chunk.file.endsWith('.js')) continue;
      verify(chunk.file);
      const modules = metadata.chunks[chunk.file];

      if (!modules) fail(`${metadataPath}: invalid module record for ${chunk.file}`);
    }

    const keys = new Set();
    const files = new Set();

    const visit = key => {
      if (keys.has(key)) return;
      keys.add(key);
      const chunk = manifest[key];

      if (!chunk.file.endsWith('.js')) fail(`${manifestPath}: non-JS static edge ${key}`);
      files.add(chunk.file);

      for (const imported of chunk.imports ?? []) visit(imported);
    };

    visit(entries[0][0]);
    let raw = 0;
    let gzip = 0;
    const violations = [];

    for (const file of files) {
      const bytes = verify(file);
      raw += bytes.length;
      gzip += gzipSync(bytes, { level: 9 }).length;

      for (const id of metadata.chunks[file]) {
        const normalized = id.replaceAll('\\', '/');

        if (normalized.includes('/node_modules/@xterm/')) violations.push(`${file}: eager runtime module ${id}`);
      }
    }

    const ceiling = config.entryGzipBytes;

    if (gzip >= ceiling) violations.push(`${gzip} gzip bytes is at or above ${ceiling}`);

    return { exit: violations.length ? 1 : 0, entry, files: [...files], raw, gzip, ceiling, diagnostic: violations.join('\n') };
  } catch (error) {
    return { exit: 2, diagnostic: error.message };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = checkStartup(process.argv[2] ?? 'dist', process.argv[3] ?? new URL('./startup.json', import.meta.url));
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.exit;
}
