// U3523a, U3523f: the vendor listing sidecar. One request per stdin line, one JSON answer per
// stdout line; it ends when stdin closes. Only the Claude Code Adapter spawns it (P4), and only
// for Import work. The SDK reads the vendor storage `CLAUDE_CONFIG_DIR` names; no Model is called.
import { readFileSync } from 'node:fs';
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

const ops = { list, read };

for await (const line of createInterface({ input: process.stdin })) {
  if (!line.trim()) continue;

  let answer;

  try {
    const request = JSON.parse(line);

    if (!ops[request.op]) throw new Error(`unknown op ${request.op}`);

    answer = await ops[request.op](request);
  } catch (error) {
    answer = { sdk, error: String(error?.message ?? error) };
  }

  process.stdout.write(`${JSON.stringify(answer)}\n`);
}
