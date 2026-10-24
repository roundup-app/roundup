// U3523a, U3523f: the vendor listing sidecar. One request per stdin line, one JSON answer per
// stdout line; it ends when stdin closes. Only the Claude Code Adapter spawns it (P4), and only
// for Import work. The SDK reads the vendor storage `CLAUDE_CONFIG_DIR` names; no Model is called.
import { createInterface } from 'node:readline';
import {
  getSessionInfo,
  getSessionMessages,
  listSessions,
} from '@anthropic-ai/claude-agent-sdk';
import { readFileSync } from 'node:fs';

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
async function handle(request) {
  if (request.op === 'list') {
    const since = request.since ?? 0;
    const include = new Set(request.include ?? []);
    const recent = (rows) =>
      rows.filter((row) => row.lastModified >= since || include.has(row.sessionId)).map(brief);
    const scoped = new Map();
    for (const dir of request.dirs) {
      for (const row of recent(await listSessions({ dir, includeWorktrees: true }))) {
        scoped.set(row.sessionId, row);
      }
    }
    // The SDK's directory queries miss subfolder-only and deleted-Worktree sessions.
    const everywhere = recent(await listSessions({}));
    return {
      sdk,
      scoped: [...scoped.values()],
      others: everywhere.filter((row) => !scoped.has(row.sessionId)),
    };
  }
  if (request.op === 'read') {
    const info = await getSessionInfo(request.sessionId);
    if (!info) return { sdk, found: false };
    const messages = await getSessionMessages(request.sessionId, { limit: 1 });
    return { sdk, found: true, info: brief(info), messages: messages.length };
  }
  throw new Error(`unknown op ${request.op}`);
}

for await (const line of createInterface({ input: process.stdin })) {
  if (!line.trim()) continue;
  let answer;
  try {
    answer = await handle(JSON.parse(line));
  } catch (error) {
    answer = { sdk, error: String(error?.message ?? error) };
  }
  process.stdout.write(`${JSON.stringify(answer)}\n`);
}
