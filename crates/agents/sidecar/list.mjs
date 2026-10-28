// U3523a, U3523f: the vendor listing sidecar. One request per stdin line, one JSON answer per
// stdout line; it ends when stdin closes. Only the Claude Code Adapter spawns it (P4), and only
// for Import work. The SDK reads the vendor storage `CLAUDE_CONFIG_DIR` names; no Model is called.
import { readFileSync } from 'node:fs';
import { open, stat, unlink } from 'node:fs/promises';
import * as vendor from '@anthropic-ai/claude-agent-sdk';
import { createInterface } from 'node:readline';
import {
  getSessionInfo,
  getSessionMessages,
  listSessions,
} from '@anthropic-ai/claude-agent-sdk';

// The package pins the SDK exactly, so its dependency is the version that runs.
const sdk = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).dependencies[
  '@anthropic-ai/claude-agent-sdk'
];

const brief = (row) => ({
  sessionId: row.sessionId,
  summary: row.summary,
  customTitle: row.customTitle,
  lastModified: row.lastModified,
  cwd: row.cwd,
});

// SDK warnings go to stderr, where the Adapter keeps them as notices.
async function list(request) {
  const include = new Set(request.include ?? []);

  const recent = (rows) =>
    rows.filter((row) => row.lastModified >= (request.since ?? 0) || include.has(row.sessionId)).map(brief);

  const scoped = new Map();

  for (const dir of request.dirs) {
    const rows = await listSessions({ dir, includeWorktrees: true });

    for (const row of recent(rows)) scoped.set(row.sessionId, row);
  }

  // The SDK's directory queries miss subfolder-only and deleted-Worktree sessions.
  const everywhere = recent(await listSessions({}));

  return {
    sdk,
    scoped: [...scoped.values()],
    others: everywhere.filter((row) => !scoped.has(row.sessionId)),
  };
}

async function read(request) {
  const info = await getSessionInfo(request.sessionId);

  if (!info) return { sdk, found: false };

  const messages = await getSessionMessages(request.sessionId, { limit: 1 });

  return { sdk, found: true, info: brief(info), messages: messages.length };
}

// Opaque approval revision: identity plus exact metadata, including inode replacement.
const revision = (metadata) =>
  [metadata.dev, metadata.ino, metadata.size, metadata.mtimeNs, metadata.ctimeNs].join(':');

function storageCapability(name) {
  const capability = vendor[name];

  if (capability === undefined) {
    throw new Error('SDK raw storage extension unavailable; reinstall the pinned sidecar with pnpm install');
  }

  return capability;
}

async function snapshot(request) {
  const resolve = storageCapability('roundupResolveSession');
  const path = await resolve(request.sessionId);
  const handle = await open(path, 'r');

  try {
    const before = await handle.stat({ bigint: true });
    const current = revision(before);

    if (request.revision !== undefined && request.revision !== current) {
      throw new Error('Saved source changed; Refresh and confirm again');
    }

    // Match the selected-source validator's 512 MiB bound; never parse vendor records.
    if (!before.isFile() || before.size > 512n * 1024n * 1024n) {
      throw new Error('Saved source is not a file or exceeds 512 MiB; select a smaller conversation');
    }

    const bytes = Buffer.alloc(Number(before.size));
    let offset = 0;

    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);

      if (!bytesRead) throw new Error('Saved source truncated; Refresh and confirm again');
      offset += bytesRead;
    }

    // Re-resolve too: a duplicate or replacement arriving during the read invalidates it.
    const afterPath = await resolve(request.sessionId);
    const after = await stat(afterPath, { bigint: true });

    if (path !== afterPath || current !== revision(after) || current !== revision(await handle.stat({ bigint: true }))) {
      throw new Error('Saved source changed while reading; Refresh and confirm again');
    }

    return { sdk, path, revision: current, records: bytes.subarray(0, bytes.lastIndexOf(10) + 1).toString('base64') };
  } finally {
    await handle.close();
  }
}

async function resolve(request) {
  const lookup = storageCapability('roundupResolveSession');

  return { sdk, path: await lookup(request.sessionId) };
}

async function destination(request) {
  const create = storageCapability('roundupCreateDestination');
  const path = await create(request.sessionId, request.dir);

  const current = revision(await stat(path, { bigint: true }));

  // Publication reserves its ownership record before writing any retained bytes. The SDK
  // supplies the destination; release its empty reservation for the existing no-clobber writer.
  if (request.prepare) await unlink(path);

  return { sdk, path, revision: current };
}

const ops = { list, read, snapshot, destination, resolve };

for await (const line of createInterface({ input: process.stdin })) {
  if (!line.trim()) continue;

  let answer;

  try {
    const request = JSON.parse(line);

    if (!ops[request.op]) throw new Error(`unknown op ${request.op}`);

    answer = await ops[request.op](request);
  } catch (error) {
    answer = { sdk, error: `SDK storage unavailable: ${String(error?.message ?? error)}; check vendor storage access and Refresh` };
  }

  process.stdout.write(`${JSON.stringify(answer)}\n`);
}
