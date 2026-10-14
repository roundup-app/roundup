# Spike: the real Claude Code against a fake Messages API

Claude Code 2.1.300 on macOS, run against `spike/mock.py`, a local fake of
`POST /v1/messages`. Every run used a fresh `CLAUDE_CONFIG_DIR` under
`spike/cfg/`, a clean environment (`env -i`) and a refusing proxy that logs
any connection not to the mock. No run reached Anthropic: every answer came
from the mock, the mock saw only fake keys, and the proxy refused the few
connections that tried to leave (checks 10 and 12).

Re-run: `bash /tmp/fake-claude-research/spike/run.sh` (all but `c5slow`,
about 70 s), or name checks: `c1 c23 c4 c5 c5slow c8 c67 c9 c10 c11 c12`.
Logs land in `spike/logs/<check>/` (`requests.jsonl`, `hooks.jsonl`,
`mcp.jsonl`, `proxy.jsonl`); `python3 spike/show.py <log dir>` prints one
timeline. The last full run's output is `spike/logs/final.out`.

| # | claim | result | evidence |
|---|---|---|---|
| 1 | `claude -p` returns the mock's text | yes | `spike/logs/c1/`: prints `MOCK-7f3a`; one `POST /v1/messages?beta=true`, model `claude-opus-5-5` |
| 2 | every registered hook fires with its payload | yes | `spike/logs/c23/`, `c4-*/`, `c5-*/`: all seven asked-for events fired; order below |
| 3 | the model calls a tool on a `--mcp-config` stdio server | yes | `spike/logs/c23/mcp.jsonl`: `tools/call ping`; the mock's next request holds `PONG-91c2 hello` |
| 4 | PermissionRequest fires and its hook decides | yes | `spike/logs/c4-allow/`, `c4-deny/`, `c4-none/`: allow → file made; deny → `spike says no`; needs `defaultMode: default` |
| 5 | StopFailure fires on an API error | partial | `spike/logs/c5-*/`: TUI 11 of 11 runs; `spike/logs/c12-race-*/`: `-p` rarely, claude exits first |
| 6 | interactive TUI in tmux: typed prompt, paste, permission | yes | `spike/logs/c67/`: reply on screen; paste → one UserPromptSubmit holding `\n`; dialog answered by key `1` |
| 7 | `--resume <id>` resumes and sends prior turns | yes | `spike/logs/c67/`: SessionStart `source: resume`, same id; next request holds all 7 earlier user turns |
| 8 | `CLAUDE_CONFIG_DIR/settings.json` `env` routes claude with no `ANTHROPIC_*` in the process | yes | `spike/logs/c8-key/`, `c8-token/`, `c8-helper/`: each reached the mock; MCP call worked |
| 9 | cost of the real claude, measured | yes | `spike/logs/c9/`, `c67/`: `-p` exits in 0.8–2.1 s, 220–233 MB; TUI 262–306 MB; fake 0.06–0.14 s, 18 MB |
| 10 | no traffic beyond the mock | yes | `spike/logs/c10-*/`, `c12-marketplace-*/`: none with three switches; without, `api.anthropic.com` and `downloads.claude.ai` |
| 11 | extra: roundup's argv (`--model`, `--effort`, `--append-system-prompt-file`, `--tools`) | yes | `spike/logs/c11/`: `model`, `output_config.effort`, brief in `system`, tools cut to `Glob, Grep, Read, ToolSearch` |

## What claude sends to the API

- One endpoint: `POST /v1/messages?beta=true`, `stream: true` for the agent
  loop. It never asked for `count_tokens`, models or any other path.
- The agent loop uses the main model: `claude-opus-5-5` by default, else the
  `--model` value. `--effort low` arrives as `output_config: {effort: low}`.
- The TUI adds one call per prompt: a session title, on the main model, with
  no tools and one message (`<session>…</session> Write the title…`). `-p`
  skips it, and so did the resumed session.
- In `auto` permission mode, a tool call that no rule allows goes to a
  classifier: ten non-streaming calls to `claude-sonnet-5`, no tools (c12).
  The mock's text is no verdict, so claude blocks the tool ("Auto mode could
  not evaluate this action") and fires no PermissionRequest.
- Credentials: `x-api-key` for an API key, `Authorization` for an auth token,
  both headers for `apiKeyHelper`. User agent
  `claude-cli/2.1.300 (external, cli)`, plus an `anthropic-beta` list.
- The mock picks a reply by matching the last user turn. A request with no
  tools (title, classifier) gets a default text, so side calls never use up a
  scripted reply.
- With `ENABLE_TOOL_SEARCH`, MCP tools are left out of the request's tool
  list, yet a `tool_use` naming one still runs (c8, c67).

## Hook payloads seen

Every payload holds `session_id`, `transcript_path`, `cwd`, `hook_event_name`.

| event | extra keys |
|---|---|
| SessionStart | `source` (`startup`, `resume`); `model` in the TUI; on resume also `context_tokens`, `estimated_cache_write_usd`, `prompt_cache_likely_expired`, `seconds_since_last_response` |
| UserPromptSubmit | `prompt`, `prompt_id`, `permission_mode` |
| PreToolUse | `tool_name`, `tool_input`, `tool_use_id`, `prompt_id`, `permission_mode`, `effort`; `mcp_server` for MCP tools |
| PermissionRequest | `tool_name`, `tool_input`, `permission_suggestions`, `prompt_id`, `permission_mode`, `effort`; no `tool_use_id` |
| PostToolUse | PreToolUse's keys plus `tool_response`, `duration_ms` |
| Stop | `last_assistant_message`, `stop_hook_active`, `background_tasks`, `session_crons`, `prompt_id`, `permission_mode`, `effort` |
| StopFailure | `error` (`server_error` for both 500 and 529), `last_assistant_message`, `prompt_id`, `effort` |
| SessionEnd | `reason`: `other` after `-p`, `prompt_input_exit` after two Ctrl-C |

Notification, SubagentStop and PreCompact were registered but never fired;
no check caused them.

## Config and environment a test needs

The process environment holds only `HOME`, `PATH`, `TERM`, the locale and
`CLAUDE_CONFIG_DIR`, as roundup passes it. Everything else lives in the
config dir.

`$CLAUDE_CONFIG_DIR/settings.json`:

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://127.0.0.1:<port>",
    "ANTHROPIC_API_KEY": "sk-mock-key-000000000000000000000001",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
    "DISABLE_AUTOUPDATER": "1",
    "CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL": "1",
    "CLAUDE_CODE_MAX_RETRIES": "0"
  },
  "permissions": { "defaultMode": "default" }
}
```

- `ANTHROPIC_AUTH_TOKEN` in place of the key works, and so does
  `"apiKeyHelper": "echo <key>"` with only the base URL in `env` (c8).
- `defaultMode: default` keeps claude out of `auto` mode, its default for a
  fresh config. Then PermissionRequest fires instead of the classifier calls.
- `CLAUDE_CODE_MAX_RETRIES: 0`: one request, then StopFailure about 0.1 s
  after UserPromptSubmit. Default retries: a 500 takes 11 requests and
  180 s; a 529 gives up after 3 requests and 2–3 s (c5, c5slow).
- This `env` merges with the `env` of roundup's own `--settings` file: the
  MCP server saw values from both, including the key (c8).

`$CLAUDE_CONFIG_DIR/.claude.json`, for the TUI only:

| key | why |
|---|---|
| `hasCompletedOnboarding: true`, `theme`, `lastOnboardingVersion` | skips onboarding |
| `customApiKeyResponses.approved: [<last 20 chars of key>]` | skips "use this API key?" |
| `projects.<cwd>.hasTrustDialogAccepted: true` | skips the trust dialog; roundup already writes it |
| `lastReleaseNotesSeen: <version>` | skips release notes |
| `hasSeenAutoDefaultNudge`, `hasResetAutoModeOptInForDefaultOffer`, `hasSeenAutoModeEntryWarning: true` | else an auto-mode offer eats the first Enter and rewrites `settings.json` |

I found the dialog keys while building the checks; `run.sh` seeds them all
but does not test each one alone.

Keys sent right after SessionStart are lost: the input box is drawn a moment
later. The checks wait 1.5 s; a test should wait for the box on screen.

Each `-p` run prints a notice about auto mode first ("We're changing auto
mode…"), because the base URL is not Anthropic's.

## Cost

The machine ran other agents, so times vary; ranges cover all runs.

| run | to SessionStart | to Stop / exit | RSS |
|---|---|---|---|
| real, `-p`, one MCP round trip (6 runs) | 0.27–0.93 s | exit 0.81–2.08 s | peak 220–233 MB |
| real, TUI | 0.31–1.19 s | Enter → Stop with MCP call 0.40–1.54 s | idle 262–267 MB, peak 296–306 MB |
| `fake_claude.py` (6 runs) | 0.06–0.14 s | — | 18 MB |

Ten real Agents hold about 2.6 GB, against about 180 MB for ten fakes.

## Traffic

- With `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` and `DISABLE_AUTOUPDATER`
  set only in `settings.json` `env`, a `-p` run made no connection but to the
  mock: the proxy caught nothing, and the socket sampler saw only the mock.
- With neither set: `CONNECT api.anthropic.com:443` (refused by the proxy).
- The TUI connects to `downloads.claude.ai:443` (the official plugin
  marketplace) unless `CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL=1`
  is set. The `.claude.json` key `officialMarketplaceAutoInstallAttempted`
  does not stop it (c12).
- Limits of the observers: the proxy sees only clients that honour
  `HTTPS_PROXY`. The socket sampler (`lsof`, back to back, about 0.15 s each)
  can miss a shorter connection. The mock answered after 1.5 s in c10, and
  the sampler saw those sockets in every run, so it works.

## What failed, or was not tested

- StopFailure under `-p` races claude's exit: its hook ran in 4 of 23 runs before the last
  suite, and in 0 of that suite's 5.
  In the TUI, which roundup runs, it ran 11 of 11 times.
- `auto` mode, claude's default, blocks unallowed tools through classifier
  calls the mock cannot answer, and skips PermissionRequest. A test must set
  `defaultMode` or allow the tool.
- Not run on Linux or in GitHub Actions. Claude's install and credential
  storage there are untested.
- Not tested: Notification, SubagentStop, PreCompact; a prompt typed while a
  turn runs; a mock that drops the stream mid-reply.
- A claude upgrade can add a first-run dialog, a side call or a new default.
  A suite must pin the claude version, and the mock should fail loud on a
  request no script entry expects.
- `fake_claude.py` knobs with no direct match: `FAKE_CLAUDE_SHIM_DELAY_MS`
  (claude starts the MCP server itself), and processes under claude
  (`FAKE_CLAUDE_CHILD_PROCESS`, `FAKE_CLAUDE_STRAY`). A scripted Bash
  `tool_use` could start them; I did not try.
- The MCP server and hooks inherit the settings `env`, the fake API key
  included. That matches the product, where the user's own settings reach
  them too; check A30 against it.
