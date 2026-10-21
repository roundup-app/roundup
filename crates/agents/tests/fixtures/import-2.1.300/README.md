# Import source observations

U2875a's pre-discovery observation, on `36b79bb2c`, 2026-10-19. The installed
`@anthropic-ai/claude-code` binary reported `2.1.300 (Claude Code)`;
`@copilotkit/aimock` was 1.45.1. Progress belongs on [#2875](https://github.com/saadshahd/roundup/issues/2875).
These fixtures establish observed record forms, not import acceptance.

The observer created disposable HOME, CLAUDE_CONFIG_DIR and Project directories,
removed inherited ANTHROPIC_/CLAUDE_ variables, and supplied only a dummy key and
loopback ANTHROPIC_BASE_URL. It disabled updates, official marketplace auto-install
and nonessential traffic. The isolated settings used `permissions.defaultMode:
"default"`; `--allowedTools Agent` permitted the one native child call. No
personal configuration or subscription credential was used. Non-loopback egress
was not independently traced, so this is not E12's egress observer.

`model.json` is the strict aimock fixture used by the successful print-mode run:

```text
claude -p observe-import-parent-2875 --allowedTools Agent --output-format json
  → native Agent(prompt=observe-import-child-2875)
  → child answer + parent answer + completion notification
```

Claude exited 0. Aimock's journal contained four requests, all matched with
status 200: parent tool call, child answer, parent tool-result answer and
completion-notification answer. Replies were fixture-authored; no real-model
reasoning, import, Worktree continuation or Resume acknowledgement is proved.

An isolated PTY then resumed the same conversation and accepted
`/rename Observed import name`, followed by `/exit`. Its configuration seeded
E12's onboarding/trust fields. Model traffic during this local-command observation was not journaled.
The fixture includes both the command records and the resulting `custom-title`
and `agent-name` records. Neither name record has a timestamp; the command and
its metadata user record do. No `ai-title` record was observed.

## Layout and projection

```text
<CLAUDE_CONFIG_DIR>/projects/<encoded canonical cwd>/
  <conversation UUID>.jsonl                         → top-level.jsonl
  <conversation UUID>/subagents/agent-<agentId>.jsonl → subagent.jsonl
```

The top-level user/assistant records carry `isSidechain: false`, canonical `cwd`,
`sessionId`, ISO-8601 `timestamp`, `version`, `uuid` and linked `parentUuid`.
The child shares the parent's cwd and sessionId, but carries `isSidechain: true`
and `agentId`. Queue records have identity/activity without cwd. Attachments,
API diagnostics and other metadata coexist with conversation records. A bucket's
encoding alone does not prove membership, and sessionId alone does not prove a
top-level conversation.

These are **metadata projections**, not complete resumable snapshots. Record
order and all record types are retained. Each record keeps only these observed
fields when present:

```text
type subtype operation parentUuid uuid promptId isSidechain agentId cwd
sessionId timestamp version customTitle agentName permissionMode mode isMeta
entrypoint userType message content commandRun
```

Nested values of retained fields are unchanged except sanitation. Omitted fields
include attachment payloads, encoded request bodies, request-shape diagnostics,
top-level accounting metadata and tool-result metadata outside `message`.
The `content` field of `api-request-blob` is omitted as an encoded request body.
Their omission
must not be copied into import's retention algorithm: U2875b requires all complete
source records. Historical tool instructions remain inert fixture data.

Sanitation replaces temporary paths, encoded bucket names, UUIDs and the native
child id consistently across both files. Timestamps and record forms are observed,
not invented. The resulting fixture cwd is `/fixture/project`; tests must map it
to an isolated real directory rather than trusting this literal path.

| File | Records | SHA-256 of original, before projection/sanitation |
| --- | ---: | --- |
| top-level.jsonl | 45 | `58caf6d0cbf422977241acfd539e74fef6fb2beb07a6fc6c4904adb8c66c5915` |
| subagent.jsonl | 14 | `cf9d3419e9e8289911d74ae588cb1c62873eac6db37173646fdbb13f1bd3c61b` |

## Bucket encoding observer (U3037a)

On 2026-10-20, the pinned `2.1.300` binary was run in disposable HOME and
CLAUDE_CONFIG_DIR folders, with a dummy key, loopback port 9 as its model endpoint,
updates and nonessential traffic disabled. Print-mode requests were stopped after
8–12 seconds; no successful model response or continuation is claimed. The local
JSONL bucket entries and their recorded cwd were inspected.

| cwd suffix | observed bucket suffix |
| --- | --- |
| `a.b_c-d/nested 名` | `a-b-c-d-nested--` |
| `punct.a_b-c/nested 🦊` | `punct-a-b-c-nested---` |

The absolute path is encoded by replacing each non-ASCII-alphanumeric UTF-16 unit
with `-`, including `/`, punctuation and each half of a supplementary character.
Launching through a directory symlink recorded and encoded its canonical target,
not the alias. A canonical path over 200 encoded units produced a 200-unit prefix
plus `-` and a hash suffix. Discovery therefore keeps long Project prefixes
conservatively for record validation; it does not guess that hash or infer
membership from an encoding collision. Continuation copies share the same
UTF-16 encoding helper for ordinary-length paths.
