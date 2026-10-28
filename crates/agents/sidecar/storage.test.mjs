// Real SDK storage is required: no conversational process or personal vendor profile.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFile, mkdtemp, mkdir, readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { test } from 'node:test';

const id = '11111111-1111-4111-8111-111111111111';

const head = `${JSON.stringify({ type: 'user', sessionId: id, uuid: '22222222-2222-4222-8222-222222222222', cwd: '/moved', message: { role: 'user', content: 'selected work' } })}\n`;

async function storage(run, entry = new URL('./list.mjs', import.meta.url).pathname) {
  const root = await mkdtemp(join(tmpdir(), 'u4251-storage-'));

  const child = spawn(process.execPath, [entry], {
    env: { ...process.env, CLAUDE_CONFIG_DIR: root }, stdio: ['pipe', 'pipe', 'pipe'],
  });

  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  let stderr = '';
  child.stderr.on('data', (part) => { stderr += part; });
  const ended = new Promise((resolve) => child.once('exit', resolve));

  const ask = async (op, args = {}) => {
    child.stdin.write(`${JSON.stringify({ op, ...args })}\n`);
    const answer = await lines.next();
    assert.equal(answer.done, false, stderr);

    return JSON.parse(answer.value);
  };

  try { await run(root, ask); }
  finally {
    child.stdin.end();
    await ended;
    await rm(root, { recursive: true, force: true });
  }
}

async function source(root, bucket, bytes) {
  const dir = join(root, 'projects', bucket);
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${id}.jsonl`);
  await writeFile(path, bytes);

  return path;
}

test('u4251b_raw_storage_preserves_invalid_complete_records_and_omits_partial_tail', { timeout: 5000 }, async () => {
  await storage(async (root, ask) => {
    const original = Buffer.from(`${head}{broken}\n{"type":"custom-title","customTitle":"unfinished"}`);
    const path = await source(root, 'historical-location', original);
    const result = await ask('snapshot', { sessionId: id });
    assert.equal(result.error, undefined);
    assert.deepEqual(Buffer.from(result.records, 'base64'), Buffer.from(`${head}{broken}\n`));
    assert.deepEqual(await readFile(path), original);
    assert.equal(result.path, path);
  });
});

test('u4251b_raw_storage_refuses_duplicate_identity', { timeout: 5000 }, async () => {
  await storage(async (root, ask) => {
    await source(root, 'one', head);
    await source(root, 'two', `${head}{broken}\n`);
    const duplicate = await ask('snapshot', { sessionId: id });
    assert.match(duplicate.error, /duplicate.*identity/i);
  });
});

test('u4251b_raw_storage_revision_distinguishes_equal_replacement', { timeout: 5000 }, async () => {
  await storage(async (root, ask) => {
    const path = await source(root, 'historical', head);
    await utimes(path, 1700000000, 1700000000);
    const before = await ask('snapshot', { sessionId: id });
    const metadata = await stat(path);
    const replacement = `${path}.replacement`;
    await writeFile(replacement, head);
    await utimes(replacement, metadata.atime, metadata.mtime);
    const replacementMetadata = await stat(replacement);
    assert.equal(replacementMetadata.size, metadata.size);
    assert.equal(replacementMetadata.mtimeMs, metadata.mtimeMs);
    assert.notEqual(replacementMetadata.ino, metadata.ino);
    await rename(replacement, path);
    const after = await ask('snapshot', { sessionId: id });
    assert.equal(before.error, undefined);
    assert.equal(after.error, undefined);
    assert.equal(after.records, before.records);
    assert.notEqual(after.revision, before.revision);
    const stale = await ask('snapshot', { sessionId: id, revision: before.revision });
    assert.match(stale.error, /changed.*Refresh/i);
    assert.equal(await readFile(path, 'utf8'), head);
  });
});

test('u4251c_storage_destination_is_sdk_readable_in_long_location_independent_of_cwd', { timeout: 5000 }, async () => {
  await storage(async (root, ask) => {
    const original = await source(root, 'old-location', head);
    // Real existing directory long enough to require the SDK truncated/hash encoder.
    let cwd = root;

    for (let n = 0; n < 5; n++) cwd = join(cwd, 'long-project-location-'.repeat(4));
    await mkdir(cwd, { recursive: true });
    const retainedId = '33333333-3333-4333-8333-333333333333';
    const destination = await ask('destination', { sessionId: retainedId, dir: cwd });
    assert.equal(destination.error, undefined);
    const retained = head.replaceAll(id, retainedId);
    await writeFile(destination.path, retained);
    const copied = await ask('snapshot', { sessionId: retainedId });
    assert.equal(copied.path, destination.path);
    assert.equal(Buffer.from(copied.records, 'base64').toString(), retained);
    const sdkRead = await ask('read', { sessionId: retainedId });
    assert.equal(sdkRead.found, true);
    const collision = await ask('destination', { sessionId: retainedId, dir: cwd });
    assert.match(collision.error, /exist/i);
    const moved = await ask('snapshot', { sessionId: id });
    assert.equal(moved.path, original);
    assert.equal(await readFile(original, 'utf8'), head);
  });
});

test('u4251b_raw_storage_reports_unresolved_identity_with_recovery', { timeout: 5000 }, async () => {
  await storage(async (_root, ask) => {
    const absent = await ask('snapshot', { sessionId: id });
    assert.match(absent.error, /not found.*Refresh/i);
  });
});

// A partial bundle can retain the public SDK API but lose the version-pinned extension.
test('u4251c_missing_storage_extension_reports_reinstall_without_fallback', { timeout: 5000 }, async () => {
  const runtime = await mkdtemp(join(tmpdir(), 'u4251-runtime-'));

  try {
    await copyFile(new URL('./list.mjs', import.meta.url), join(runtime, 'list.mjs'));
    await copyFile(new URL('./package.json', import.meta.url), join(runtime, 'package.json'));
    const shim = join(runtime, 'node_modules', '@anthropic-ai', 'claude-agent-sdk');
    await mkdir(shim, { recursive: true });
    await writeFile(join(shim, 'package.json'), JSON.stringify({ type: 'module', exports: './sdk.mjs' }));
    await writeFile(join(shim, 'sdk.mjs'), `export { getSessionInfo, getSessionMessages, listSessions } from ${JSON.stringify(import.meta.resolve('@anthropic-ai/claude-agent-sdk'))};`);
    await storage(async (root, ask) => {
      const path = await source(root, 'historical', head);
      const result = await ask('snapshot', { sessionId: id });
      assert.match(result.error, /extension unavailable; reinstall the pinned sidecar with pnpm install/i);
      assert.equal(result.records, undefined);
      assert.equal(await readFile(path, 'utf8'), head);
    }, join(runtime, 'list.mjs'));
  } finally {
    await rm(runtime, { recursive: true, force: true });
  }
});
