# How coding-agent apps test their agent loop without paying for model calls

Read on 2026-10-14 from shallow clones. Every link is pinned to the commit read.
Nothing was installed or run.

Bottom line: no repo here runs a real model on every PR with an API-key secret.
The strongest free pattern for us is in claude-agent-acp: the real `claude`
binary talks to a local stub of the Messages API. codex shows how to build that
stub in Rust with wiremock.

## Summary table

| repo @ commit | seam faked | tool or library | real model in CI? |
|---|---|---|---|
| [anomalyco/opencode @ 13afea6](https://github.com/anomalyco/opencode/tree/13afea6a1a76360936bbaa7677cff600ad52d452) (sst/opencode redirects here) | own LLM client object; HTTP client; loopback HTTP; recorded HTTP cassettes; whole network in "simulation" | in-house `TestLLM`, `@opencode/http-recorder` (VCR), `Bun.serve` | No. Bots use `secrets.OPENCODE_API_KEY`; test jobs do not |
| [openai/codex @ 8094365](https://github.com/openai/codex/tree/8094365e6a2da38be1cd37d58f308c496e3f7ac9) | Responses API over HTTP (SSE) | `wiremock` 0.6, hand-built SSE helpers, a raw TCP SSE server | No. Live tests are `#[ignore]` |
| [agentclientprotocol/claude-agent-acp @ ba3c7be](https://github.com/agentclientprotocol/claude-agent-acp/tree/ba3c7be05e9af297fe95b0ac647da2340dd9e15b) (successor of zed-industries/claude-code-acp) | (1) SDK `query()`; (2) Messages API over HTTP under the real `claude` binary | `vi.mock`, `.jsonl` golden scenarios, `node:http` SSE stub | No. Real-model tests need `RUN_INTEGRATION_TESTS`, which CI never sets |
| [anthropics/claude-agent-sdk-python @ c10b52c](https://github.com/anthropics/claude-agent-sdk-python/tree/c10b52c674e5c709c7263544b38e8a5dad10e01d) | the `claude` binary (stub script); transport class; `anyio.open_process` | Python stub CLI via `cli_path`, `unittest.mock.patch` | Yes. e2e on every same-repo PR and push, via OIDC workload identity, no key secret |
| [anthropics/claude-agent-sdk-typescript @ fbc5294](https://github.com/anthropics/claude-agent-sdk-typescript/tree/fbc529490ca0fb07b486c6f9c8e553d3fb7c690d) | none (SDK source and tests are not public) | — | No tests run |
| [anthropics/claude-code-action @ a26b07d](https://github.com/anthropics/claude-code-action/tree/a26b07d8c778b0c43f64618e5fd29fd0f8af72e8) | SDK `query()`; recorded SDK messages with golden output | `bun` `mock.module`, JSON fixture | Yes. Several workflows run the real CLI and model via OIDC, including a stdio MCP test |
| [coder/agentapi @ 7c468d5](https://github.com/coder/agentapi/tree/7c468d5b25ec9d3d76c41313cf4e08904ff5968d) | the terminal screen (saved Claude screens); the agent process (echo agent) | Go `embed` golden files, `echo.go` | No |
| [BloopAI/vibe-kanban @ d5cbb53](https://github.com/BloopAI/vibe-kanban/tree/d5cbb5380fa0b32e98ef9b8d987f63decce4be3a) | stream-json lines (inline strings); optional `sh` mock executor | Rust unit tests, `qa-mode` feature | No |
| [smtg-ai/claude-squad @ ce1ffb4](https://github.com/smtg-ai/claude-squad/tree/ce1ffb4392b01f38e2c4599c7c84d2a93973b138) | PTY factory and command runner; a stub `claude` on PATH for lookup only | Go interfaces | No |
| [stravu/crystal @ 1e18e0b](https://github.com/stravu/crystal/tree/1e18e0bc981225f75b5226f82a300fa741970c6f) | nothing for Claude; CI runs an app-boot smoke test | Playwright | No |
| [slopus/happy @ b0fc933](https://github.com/slopus/happy/tree/b0fc933dd423ee562207d1788c65b4b9cc4960d1) | `cross-spawn`; SDK `query()`; recorded session `.jsonl` | `vi.mock`, transcript fixtures | No. Real-model tests exist but no workflow runs them |
| [sugyan/claude-code-webui @ 9109263](https://github.com/sugyan/claude-code-webui/tree/9109263873cfc2a6eb0a160396fdfd60c2d6a37f) | SDK `query()`; a scripted demo mode in the UI | `vi.mock`, Playwright (not run) | No |
| [siteboon/claudecodeui @ 7c3049f](https://github.com/siteboon/claudecodeui/tree/7c3049fe8e157f12b7add3e496d8d2fe6fa5c014) | injected SDK `createQuery`; injected fake PTY | dependency injection, `node --test` | No. No workflow runs tests at all |
| [zed-industries/zed @ 3e14506](https://github.com/zed-industries/zed/tree/3e145061d861ed32bb6a08dad7b03f2b5e455ad8) | language model object for its own agent | `FakeLanguageModelProvider` | Agent-server e2e tests are behind a cargo `e2e` feature; ignored otherwise |
| [winfunc/opcode @ d1ca30a](https://github.com/winfunc/opcode/tree/d1ca30a3c0c39fff01fde2f86c2d5af6a1db658b) (Rust/Tauri, launches `claude`) | nothing; two path-helper unit tests | — | No |

## Per-repo notes

### 1. opencode

opencode does not use the Vercel AI SDK's `MockLanguageModelV*` or
`simulateReadableStream` (zero hits). It routes model calls through its own
Effect-based client and fakes it at five depths.

**a. `TestLLM`, a scripted fake of the LLM client object.** Tests push typed
events; no wire format runs. An unscripted request fails loudly.
[packages/ai/src/testing.ts#L35-L46](https://github.com/anomalyco/opencode/blob/13afea6a1a76360936bbaa7677cff600ad52d452/packages/ai/src/testing.ts#L35-L46),
[#L128-L136](https://github.com/anomalyco/opencode/blob/13afea6a1a76360936bbaa7677cff600ad52d452/packages/ai/src/testing.ts#L128-L136)

```ts
readonly push: (...responses: readonly Response[]) => Effect.Effect<void>
readonly serve: (responder: Responder) => Effect.Effect<void>
readonly wait: (count: number) => Effect.Effect<void>
readonly gate: () => Effect.Effect<Gate, never, Scope.Scope>
...
if (!response) return Effect.die(new Error(`TestLLM has no response for request ${count}`))
```

The real session runner uses it in place of the client:
[packages/core/test/session-runner.test.ts#L416](https://github.com/anomalyco/opencode/blob/13afea6a1a76360936bbaa7677cff600ad52d452/packages/core/test/session-runner.test.ts#L416).
Catches: tool dispatch, multi-step loops, interrupts, the request sent.
Misses: encoding, SSE parsing, provider errors.

**b. A hand-written AI SDK `LanguageModelV3`.** `doStream` yields fixed parts;
any HTTP request dies.
[packages/core/test/aisdk.test.ts#L43-L71](https://github.com/anomalyco/opencode/blob/13afea6a1a76360936bbaa7677cff600ad52d452/packages/core/test/aisdk.test.ts#L43-L71).
Catches: the adapter from AI SDK parts to opencode events. Misses: provider packages.

**c. A fake Effect `HttpClient` under the real protocol code.** Helpers include
a truncated SSE stream and scripted multi-request tool loops.
[packages/ai/test/lib/http.ts#L48-L135](https://github.com/anomalyco/opencode/blob/13afea6a1a76360936bbaa7677cff600ad52d452/packages/ai/test/lib/http.ts#L48-L135).
Catches: request encoding and SSE parsing. Misses: drift from what providers send today.

**d. Loopback fake servers with `Bun.serve`.** The real `opencode acp` CLI runs
as a subprocess against a fake `/v1/chat/completions`, wired through config
`baseURL`.
[packages/cli/test/acp/subprocess.ts#L55-L62](https://github.com/anomalyco/opencode/blob/13afea6a1a76360936bbaa7677cff600ad52d452/packages/cli/test/acp/subprocess.ts#L55-L62),
[#L186-L190](https://github.com/anomalyco/opencode/blob/13afea6a1a76360936bbaa7677cff600ad52d452/packages/cli/test/acp/subprocess.ts#L186-L190)

```ts
const llm = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    if (request.method !== "POST" || new URL(request.url).pathname !== "/v1/chat/completions") {
      return new Response("Not found", { status: 404 })
...
const child = Bun.spawn([process.execPath, "run", "src/index.ts", "acp"], {
```

Another one fakes 429s and overflow for compaction:
[packages/core/test/session-native-compaction.test.ts#L65-L89](https://github.com/anomalyco/opencode/blob/13afea6a1a76360936bbaa7677cff600ad52d452/packages/core/test/session-native-compaction.test.ts#L65-L89).
Catches: real transport, retries, process wiring. Misses: real model behaviour.

**e. `@opencode/http-recorder`, record once and replay JSON cassettes.** CI
forces replay. Matching is strict on method, URL, headers and canonical body.
Secrets are redacted.
[packages/http-recorder/src/replay/state.ts#L5-L17](https://github.com/anomalyco/opencode/blob/13afea6a1a76360936bbaa7677cff600ad52d452/packages/http-recorder/src/replay/state.ts#L5-L17),
[src/http/matching.ts#L8-L16](https://github.com/anomalyco/opencode/blob/13afea6a1a76360936bbaa7677cff600ad52d452/packages/http-recorder/src/http/matching.ts#L8-L16)

```ts
export const resolveAutoMode = (...) =>
  Effect.gen(function* () {
    if (isCI()) return "replay"
    return (yield* cassette.exists(name)) ? "replay" : "record"
  })
```

Policy:
[packages/ai/AGENTS.md#L19-L20](https://github.com/anomalyco/opencode/blob/13afea6a1a76360936bbaa7677cff600ad52d452/packages/ai/AGENTS.md#L19-L20):
"Replay is the default and needs no API keys." "To record, unset `CI` and run
with `RECORD=true` plus the provider's API key." About 274 cassettes cover about
75 provider routes under `packages/ai/test/fixtures/recordings/`. The agent loop
also runs on a cassette:
[packages/core/test/session-runner-recorded.test.ts#L50-L58](https://github.com/anomalyco/opencode/blob/13afea6a1a76360936bbaa7677cff600ad52d452/packages/core/test/session-runner-recorded.test.ts#L50-L58).
Catches: request-shape drift and real stream parsing. Misses: provider changes
after the recording date.

**f. Simulation mode.** It replaces the platform HTTP client; unknown hosts fail.
An outside driver, `opencode-drive`, scripts model replies while the real server
and TUI run.
[packages/simulation/src/backend/network.ts#L7-L14](https://github.com/anomalyco/opencode/blob/13afea6a1a76360936bbaa7677cff600ad52d452/packages/simulation/src/backend/network.ts#L7-L14),
[script/drive/subagent-eviction.md#L7-L8](https://github.com/anomalyco/opencode/blob/13afea6a1a76360936bbaa7677cff600ad52d452/script/drive/subagent-eviction.md#L7-L8):
"Only the LLM responses and a `fixture_hold` tool are simulated." No workflow runs it.

**TUI.** OpenTUI's `createTestRenderer` renders headless. The TUI talks to a
`Bun.serve` fake of opencode's own backend, which throws on unknown paths.
Tests press keys and read a character frame; one test stores a text snapshot.
[packages/tui/test/fixture/app.ts#L22-L36](https://github.com/anomalyco/opencode/blob/13afea6a1a76360936bbaa7677cff600ad52d452/packages/tui/test/fixture/app.ts#L22-L36),
[packages/tui/test/fixture/tui-client.ts#L166-L170](https://github.com/anomalyco/opencode/blob/13afea6a1a76360936bbaa7677cff600ad52d452/packages/tui/test/fixture/tui-client.ts#L166-L170).
No model is involved.

**Web e2e.** Playwright stubs the whole `/api/**` in the browser. An unmocked
route fails the test.
[packages/app/e2e/utils/mock-server.ts#L358-L410](https://github.com/anomalyco/opencode/blob/13afea6a1a76360936bbaa7677cff600ad52d452/packages/app/e2e/utils/mock-server.ts#L358-L410).

**CI.** `test.yml` runs `bun turbo test` and Playwright; its only secret is
`GITHUB_TOKEN`.
[.github/workflows/test.yml#L110-L113](https://github.com/anomalyco/opencode/blob/13afea6a1a76360936bbaa7677cff600ad52d452/.github/workflows/test.yml#L110-L113).
Real models appear only in bots (triage, review, docs) on `secrets.OPENCODE_API_KEY`
and opencode's own gateway, e.g.
[.github/workflows/review.yml#L48-L54](https://github.com/anomalyco/opencode/blob/13afea6a1a76360936bbaa7677cff600ad52d452/.github/workflows/review.yml#L48-L54).
The core test runner strips provider keys from the environment:
[packages/core/script/test.ts#L10-L22](https://github.com/anomalyco/opencode/blob/13afea6a1a76360936bbaa7677cff600ad52d452/packages/core/script/test.ts#L10-L22).

### 2. Apps that launch Claude Code

#### claude-agent-acp (the closest match to what we want)

Four layers.

1. Every test gets `/usr/bin/false` as the CLI and a stubbed `fetch`, unless it
   opts in.
   [vitest.config.ts#L3-L18](https://github.com/agentclientprotocol/claude-agent-acp/blob/ba3c7be05e9af297fe95b0ac647da2340dd9e15b/vitest.config.ts#L3-L18)

   ```ts
   env: usesRealCli ? {} : { CLAUDE_CODE_EXECUTABLE: "/usr/bin/false" },
   setupFiles: usesRealCli ? [] : ["src/tests/setup-no-network.ts"],
   ```

2. A scripted SDK `query()` drives the real adapter, and about 40 scenarios are
   stored as `.jsonl` goldens.
   [src/tests/acp-scenarios/harness.ts#L1-L10](https://github.com/agentclientprotocol/claude-agent-acp/blob/ba3c7be05e9af297fe95b0ac647da2340dd9e15b/src/tests/acp-scenarios/harness.ts#L1-L10):
   "A scripted SDK query replaces the Claude Code process: it yields SDK messages
   and stream events, and it calls the `canUseTool` callback and the hooks".

3. **The real `claude` binary against a local stub of the Messages API.** It
   runs in plain `npm run test:run` on every PR, with no key. The file header
   gives the reason a mock cannot replace it.
   [src/tests/session-hooks.test.ts#L1-L5](https://github.com/agentclientprotocol/claude-agent-acp/blob/ba3c7be05e9af297fe95b0ac647da2340dd9e15b/src/tests/session-hooks.test.ts#L1-L5)

   ```ts
    * Session hooks against the real Claude Code binary. A local stub of the
    * Messages API answers every turn, so the test needs no network or account.
    * The CLI merges the settings tiers, so a mock SDK cannot show that the user
    * and project hooks still run next to the hooks of `_meta.claudeCode.options`.
   ```

   The stub: [#L16-L40](https://github.com/agentclientprotocol/claude-agent-acp/blob/ba3c7be05e9af297fe95b0ac647da2340dd9e15b/src/tests/session-hooks.test.ts#L16-L40),
   [#L113-L137](https://github.com/agentclientprotocol/claude-agent-acp/blob/ba3c7be05e9af297fe95b0ac647da2340dd9e15b/src/tests/session-hooks.test.ts#L113-L137)

   ```ts
   if (req.url?.startsWith("/v1/messages/count_tokens")) {
     res.writeHead(200, { "content-type": "application/json" });
     res.end(JSON.stringify({ input_tokens: 1 }));
   } else if (req.url?.startsWith("/v1/messages")) {
     res.writeHead(200, { "content-type": "text/event-stream" });
     res.end(REPLY);
   } else {
     res.writeHead(200);
     res.end();
   }
   ...
   HOME: home,
   CLAUDE_CONFIG_DIR: path.join(home, ".claude"),
   ANTHROPIC_API_KEY: "sk-ant-test",
   ANTHROPIC_BASE_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
   CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
   ```

   `REPLY` is one fixed SSE answer: `message_start`, one `text_delta` of `"ok"`,
   `message_stop`. Hooks are `SessionStart` commands that append a tag to a log.
   The tests assert the tags, then repeat across `session/load` (resume):
   [#L169-L196](https://github.com/agentclientprotocol/claude-agent-acp/blob/ba3c7be05e9af297fe95b0ac647da2340dd9e15b/src/tests/session-hooks.test.ts#L169-L196).
   The binary comes from the SDK's pinned npm package (`0.3.296`), so `npm ci`
   provides it.
   Catches: settings merge, hook firing, transcript writes, resume, all in the
   real CLI. Misses: tool use, since the stub never returns `tool_use`. It runs
   headless through the SDK, not the interactive TUI.

4. Real-model tests are opt-in with `RUN_INTEGRATION_TESTS`, e.g.
   [src/tests/acp-agent.test.ts#L389](https://github.com/agentclientprotocol/claude-agent-acp/blob/ba3c7be05e9af297fe95b0ac647da2340dd9e15b/src/tests/acp-agent.test.ts#L389).
   CI never sets it:
   [.github/workflows/ci.yml#L44-L45](https://github.com/agentclientprotocol/claude-agent-acp/blob/ba3c7be05e9af297fe95b0ac647da2340dd9e15b/.github/workflows/ci.yml#L44-L45).

#### claude-agent-sdk-python

Unit tests use a stub CLI script passed as `cli_path`, like our fake `claude`.
The stub speaks the CLI side of stream-json and the control protocol.
[tests/test_run_end_subprocess.py#L1-L50](https://github.com/anthropics/claude-agent-sdk-python/blob/c10b52c674e5c709c7263544b38e8a5dad10e01d/tests/test_run_end_subprocess.py#L1-L50)

```python
FAKE_CLI = textwrap.dedent(
    """
    #!/usr/bin/env python3
    import json, os, sys

    if "-v" in sys.argv or "--version" in sys.argv:
        print("2.1.999 (Claude Code)")
        sys.exit(0)
```

Other unit tests patch `SubprocessCLITransport` or `anyio.open_process`. No fake
HTTP API exists.

e2e runs the real CLI and a real model on every push and same-repo PR. Auth is
GitHub OIDC exchanged with Anthropic (workload identity federation). Repo
*variables* hold the IDs; no key secret exists.
[.github/workflows/test.yml#L81-L90](https://github.com/anthropics/claude-agent-sdk-python/blob/c10b52c674e5c709c7263544b38e8a5dad10e01d/.github/workflows/test.yml#L81-L90),
[#L148-L161](https://github.com/anthropics/claude-agent-sdk-python/blob/c10b52c674e5c709c7263544b38e8a5dad10e01d/.github/workflows/test.yml#L148-L161)

```yaml
- name: Run end-to-end tests with real API
  if: runner.os == 'Linux'
  env:
    ANTHROPIC_FEDERATION_RULE_ID: ${{ vars.ANTHROPIC_FEDERATION_RULE_ID }}
    ANTHROPIC_ORGANIZATION_ID: ${{ vars.ANTHROPIC_ORGANIZATION_ID }}
    ANTHROPIC_SERVICE_ACCOUNT_ID: ${{ vars.ANTHROPIC_SERVICE_ACCOUNT_ID }}
```

Useful for us: CI pre-trusts the workspace by writing
`projects[<root>].hasTrustDialogAccepted: true` into
`$CLAUDE_CONFIG_DIR/.claude.json`, so Claude Code honours project settings.
[scripts/trust_workspace.py#L1-L25](https://github.com/anthropics/claude-agent-sdk-python/blob/c10b52c674e5c709c7263544b38e8a5dad10e01d/scripts/trust_workspace.py#L1-L25),
[#L60](https://github.com/anthropics/claude-agent-sdk-python/blob/c10b52c674e5c709c7263544b38e8a5dad10e01d/scripts/trust_workspace.py#L60).
The model is pinned:
[e2e-tests/conftest.py#L16](https://github.com/anthropics/claude-agent-sdk-python/blob/c10b52c674e5c709c7263544b38e8a5dad10e01d/e2e-tests/conftest.py#L16).

#### claude-agent-sdk-typescript

The repo holds only examples, a changelog and session-store samples. Its tests
gate on a database URL, not on Claude. Nothing to learn.

#### claude-code-action

Unit tests mock the SDK's `query()`:
[base-action/test/run-claude-sdk.test.ts#L39-L44](https://github.com/anthropics/claude-code-action/blob/a26b07d8c778b0c43f64618e5fd29fd0f8af72e8/base-action/test/run-claude-sdk.test.ts#L39-L44).
A recorded message list renders against a golden markdown file:
[test/format-turns.test.ts#L457-L473](https://github.com/anthropics/claude-code-action/blob/a26b07d8c778b0c43f64618e5fd29fd0f8af72e8/test/format-turns.test.ts#L457-L473).

Integration workflows run the real CLI and model through OIDC on same-repo PRs.
One starts a real stdio MCP server and asks the model to call its tool.
[.github/workflows/test-mcp-servers.yml#L38-L49](https://github.com/anthropics/claude-code-action/blob/a26b07d8c778b0c43f64618e5fd29fd0f8af72e8/.github/workflows/test-mcp-servers.yml#L38-L49),
[base-action/test/mcp-test/.mcp.json](https://github.com/anthropics/claude-code-action/blob/a26b07d8c778b0c43f64618e5fd29fd0f8af72e8/base-action/test/mcp-test/.mcp.json)

```yaml
prompt: "Call the test_tool tool and report its response."
...
claude_args: --allowedTools mcp__test-server__test_tool --permission-mode auto
```

Assertions are loose: `jq` or `grep` on the output file. The model is pinned:
[test-base-action.yml#L23](https://github.com/anthropics/claude-code-action/blob/a26b07d8c778b0c43f64618e5fd29fd0f8af72e8/.github/workflows/test-base-action.yml#L23).

#### agentapi (drives Claude Code's TUI in a PTY, like us)

It tests screen parsing on saved Claude screens as golden files
(`msg.txt`, `user.txt`, `expected.txt`).
[lib/msgfmt/msgfmt_test.go#L219-L238](https://github.com/coder/agentapi/blob/7c468d5b25ec9d3d76c41313cf4e08904ff5968d/lib/msgfmt/msgfmt_test.go#L219-L238),
[testdata/format/claude/first_message/msg.txt](https://github.com/coder/agentapi/blob/7c468d5b25ec9d3d76c41313cf4e08904ff5968d/lib/msgfmt/testdata/format/claude/first_message/msg.txt).
Its "e2e" runs the real server against an echo agent that plays a JSON script:
[e2e/README.md#L13-L18](https://github.com/coder/agentapi/blob/7c468d5b25ec9d3d76c41313cf4e08904ff5968d/e2e/README.md#L13-L18).
No test runs real `claude`. The saved screens still show the old "research
preview" welcome box, so they go stale silently.

#### vibe-kanban (Rust)

Claude tests parse inline stream-json strings and feed an in-memory store.
[crates/executors/src/executors/claude.rs#L2781-L2784](https://github.com/BloopAI/vibe-kanban/blob/d5cbb5380fa0b32e98ef9b8d987f63decce4be3a/crates/executors/src/executors/claude.rs#L2781-L2784).
A `qa-mode` mock executor runs `sh` to print scripted lines, but CI does not
build that feature.
[crates/executors/src/executors/qa_mock.rs#L1-L6](https://github.com/BloopAI/vibe-kanban/blob/d5cbb5380fa0b32e98ef9b8d987f63decce4be3a/crates/executors/src/executors/qa_mock.rs#L1-L6),
[.github/workflows/test.yml#L316-L317](https://github.com/BloopAI/vibe-kanban/blob/d5cbb5380fa0b32e98ef9b8d987f63decce4be3a/.github/workflows/test.yml#L316-L317).
The hook control protocol has no test.

#### claude-squad (Go, tmux)

A fake PTY factory and command runner let tests assert the tmux command line.
[session/tmux/tmux_test.go#L70-L74](https://github.com/smtg-ai/claude-squad/blob/ce1ffb4392b01f38e2c4599c7c84d2a93973b138/session/tmux/tmux_test.go#L70-L74).
A stub `claude` on PATH tests only binary lookup:
[config/config_test.go#L34-L46](https://github.com/smtg-ai/claude-squad/blob/ce1ffb4392b01f38e2c4599c7c84d2a93973b138/config/config_test.go#L34-L46).
It detects prompts by scraping screen strings, and no test covers that scraping:
[session/tmux/tmux.go#L254-L255](https://github.com/smtg-ai/claude-squad/blob/ce1ffb4392b01f38e2c4599c7c84d2a93973b138/session/tmux/tmux.go#L254-L255).

#### crystal

No test touches the Claude manager. CI runs only a boot smoke test:
[playwright.ci.minimal.config.ts#L5-L6](https://github.com/stravu/crystal/blob/1e18e0bc981225f75b5226f82a300fa741970c6f/playwright.ci.minimal.config.ts#L5-L6).
Its permission test admits the gap:
[tests/permissions.spec.ts#L118-L120](https://github.com/stravu/crystal/blob/1e18e0bc981225f75b5226f82a300fa741970c6f/tests/permissions.spec.ts#L118-L120)
("This test would require mocking the Claude process").

#### happy (happy-cli; local mode uses `--settings` hooks like us)

Its design: Claude runs a `SessionStart` hook from a `--settings` file, and the
hook command POSTs to a local server.
[src/claude/utils/startHookServer.ts#L27-L37](https://github.com/slopus/happy/blob/b0fc933dd423ee562207d1788c65b4b9cc4960d1/packages/happy-cli/src/claude/utils/startHookServer.ts#L27-L37).
Tests mock both the hook server and the settings writer, so the round trip is
never exercised:
[src/claude/runClaude.test.ts#L53-L60](https://github.com/slopus/happy/blob/b0fc933dd423ee562207d1788c65b4b9cc4960d1/packages/happy-cli/src/claude/runClaude.test.ts#L53-L60).
`claudeLocal` tests mock `cross-spawn` and check argv only:
[src/claude/claudeLocal.test.ts#L19-L21](https://github.com/slopus/happy/blob/b0fc933dd423ee562207d1788c65b4b9cc4960d1/packages/happy-cli/src/claude/claudeLocal.test.ts#L19-L21).
Note: local mode inherits the terminal's stdio rather than a PTY
([claudeLocal.ts#L312-L316](https://github.com/slopus/happy/blob/b0fc933dd423ee562207d1788c65b4b9cc4960d1/packages/happy-cli/src/claude/claudeLocal.ts#L312-L316)).

Its best idea: recorded Claude session `.jsonl` files are written line by line
into a temp `CLAUDE_CONFIG_DIR`, and the real session scanner tails them,
including a new session id on resume.
[src/claude/utils/sessionScanner.test.ts#L25-L28](https://github.com/slopus/happy/blob/b0fc933dd423ee562207d1788c65b4b9cc4960d1/packages/happy-cli/src/claude/utils/sessionScanner.test.ts#L25-L28),
[#L75-L83](https://github.com/slopus/happy/blob/b0fc933dd423ee562207d1788c65b4b9cc4960d1/packages/happy-cli/src/claude/utils/sessionScanner.test.ts#L75-L83).
Real-model tests probe the API and skip when it fails; no workflow runs them:
[src/claude/claude.integration.test.ts#L255](https://github.com/slopus/happy/blob/b0fc933dd423ee562207d1788c65b4b9cc4960d1/packages/happy-cli/src/claude/claude.integration.test.ts#L255).

#### claude-code-webui

The backend mocks the SDK and asserts the options it passes:
[backend/handlers/chat.test.ts#L11-L16](https://github.com/sugyan/claude-code-webui/blob/9109263873cfc2a6eb0a160396fdfd60c2d6a37f/backend/handlers/chat.test.ts#L11-L16).
Demo mode plays scripted SDK messages, but through its own converter, not the
production parser. Its Playwright spec is excluded and never runs:
[frontend/vite.config.ts#L43](https://github.com/sugyan/claude-code-webui/blob/9109263873cfc2a6eb0a160396fdfd60c2d6a37f/frontend/vite.config.ts#L43).
`demo-comparison.yml` compares demo videos with ffmpeg; it does not test Claude.

#### claudecodeui

Production code takes an injectable `createQuery`, so tests script the SDK
stream:
[claude-runtime.provider.js#L1108-L1110](https://github.com/siteboon/claudecodeui/blob/7c3049fe8e157f12b7add3e496d8d2fe6fa5c014/server/modules/providers/list/claude/claude-runtime.provider.js#L1108-L1110).
A fake PTY checks the interactive `claude` command line, including the
`--resume` fallback:
[shell-websocket.service.test.ts#L159-L162](https://github.com/siteboon/claudecodeui/blob/7c3049fe8e157f12b7add3e496d8d2fe6fa5c014/server/modules/websocket/tests/shell-websocket.service.test.ts#L159-L162).
No workflow runs these tests.

#### Zed and opcode (extra)

Zed fakes the model object for its own agent with `FakeLanguageModelProvider`
(`send_text`, `send_error`, `pending_completions`):
[crates/language_model/src/fake_provider.rs#L18](https://github.com/zed-industries/zed/blob/3e145061d861ed32bb6a08dad7b03f2b5e455ad8/crates/language_model/src/fake_provider.rs#L18).
Its agent-server e2e tests are ignored unless the `e2e` cargo feature is on:
[crates/agent_servers/src/e2e_tests.rs#L334-L337](https://github.com/zed-industries/zed/blob/3e145061d861ed32bb6a08dad7b03f2b5e455ad8/crates/agent_servers/src/e2e_tests.rs#L334-L337).
opcode (Rust/Tauri, launches `claude`) has two path-helper tests and nothing on
the Claude process:
[src-tauri/src/commands/claude.rs#L2191](https://github.com/winfunc/opcode/blob/d1ca30a3c0c39fff01fde2f86c2d5af6a1db658b/src-tauri/src/commands/claude.rs#L2191).

### 3. codex (Rust)

**The mock server.** Tests start a wiremock `MockServer` and mount hand-built
Responses SSE bodies. No SSE files exist on disk; helpers build every event.
[codex-rs/core/tests/common/responses.rs#L752-L766](https://github.com/openai/codex/blob/8094365e6a2da38be1cd37d58f308c496e3f7ac9/codex-rs/core/tests/common/responses.rs#L752-L766),
[#L1117-L1153](https://github.com/openai/codex/blob/8094365e6a2da38be1cd37d58f308c496e3f7ac9/codex-rs/core/tests/common/responses.rs#L1117-L1153),
[#L1205-L1215](https://github.com/openai/codex/blob/8094365e6a2da38be1cd37d58f308c496e3f7ac9/codex-rs/core/tests/common/responses.rs#L1205-L1215)

```rust
pub fn sse(events: Vec<Value>) -> String {
    ...
        writeln!(&mut out, "event: {kind}").unwrap();
        ...
            write!(&mut out, "data: {ev}\n\n").unwrap();
...
pub async fn mount_sse_once(server: &MockServer, body: String) -> ResponseMock {
    let (mock, response_mock) = base_mock();
    mock.respond_with(sse_response(body))
        .up_to_n_times(1)
        .mount(server)
        .await;
    response_mock
}
```

Event builders include `ev_assistant_message`, `ev_function_call`,
`ev_completed`, `ev_output_text_delta` and about 15 more in the same file.

**Recording and invariants.** `ResponseMock` is a wiremock `Match` that records
every request and panics on an orphan tool call or tool output.
[responses.rs#L738-L749](https://github.com/openai/codex/blob/8094365e6a2da38be1cd37d58f308c496e3f7ac9/codex-rs/core/tests/common/responses.rs#L738-L749)

```rust
impl Match for ResponseMock {
    fn matches(&self, request: &wiremock::Request) -> bool {
        self.requests.lock().unwrap().push(ResponsesRequest(request.clone()));
        // Enforce invariant checks on every request body captured by the mock.
        // Panic on orphan tool outputs or calls to catch regressions early.
        validate_request_body_invariants(request);
        true
    }
}
```

Tests then assert on what the agent sent, e.g. the instructions text or the
tool output of turn 1 inside the request of turn 2:
[core/tests/suite/client.rs#L1826-L1860](https://github.com/openai/codex/blob/8094365e6a2da38be1cd37d58f308c496e3f7ac9/codex-rs/core/tests/suite/client.rs#L1826-L1860),
[core/tests/suite/tool_harness.rs#L84-L133](https://github.com/openai/codex/blob/8094365e6a2da38be1cd37d58f308c496e3f7ac9/codex-rs/core/tests/suite/tool_harness.rs#L84-L133).
Insta snapshots store the model-visible context (98 files in
`core/tests/suite/snapshots`).

**The real binary against the mock.** `codex exec` runs as a subprocess with a
temp `CODEX_HOME`, a dummy key, and a `-c` override for the base URL.
[core/tests/suite/cli_stream.rs#L212-L256](https://github.com/openai/codex/blob/8094365e6a2da38be1cd37d58f308c496e3f7ac9/codex-rs/core/tests/suite/cli_stream.rs#L212-L256)

```rust
let provider_override = format!(
    "model_providers.mock={{ name = \"mock\", base_url = \"{}/v1\", env_key = \"PATH\", wire_api = \"responses\" }}",
    server.uri()
);
let bin = codex_utils_cargo_bin::cargo_bin("codex").unwrap();
...
cmd.env("CODEX_HOME", home.path())
    .env("OPENAI_API_KEY", "dummy");
```

**The real TUI in a terminal against the mock.** One test launches the real
TUI in tmux, sends keys and reads `capture-pane`. It is `#[ignore]` by default.
[tui/tests/suite/resize_reflow.rs#L17-L66](https://github.com/openai/codex/blob/8094365e6a2da38be1cd37d58f308c496e3f7ac9/codex-rs/tui/tests/suite/resize_reflow.rs#L17-L66)

```rust
#[ignore = "requires tmux and a locally built codex binary; run with --ignored for manual resize smoke"]
...
let server = MockServer::start().await;
let _response_mock = mount_resize_response(&server).await;
write_config(codex_home.path(), &repo_root, &server.uri())?;
write_auth(codex_home.path())?;
```

Its comment at
[#L624](https://github.com/openai/codex/blob/8094365e6a2da38be1cd37d58f308c496e3f7ac9/codex-rs/tui/tests/suite/resize_reflow.rs#L624)
notes that a side request (title generation) races the visible turn for the
same mock. A Claude stub will meet the same problem.

Other TUI tests render widgets into ratatui `TestBackend` or a `vt100` parser
and use insta (about 1400 `.snap` files).

**Faults.** The mock serves 500s, 503 with `Retry-After`, `response.failed`,
and streams cut before `response.completed`. A raw TCP server gates SSE chunks
for timing tests.
[core/tests/suite/stream_no_completed.rs#L20-L101](https://github.com/openai/codex/blob/8094365e6a2da38be1cd37d58f308c496e3f7ac9/codex-rs/core/tests/suite/stream_no_completed.rs#L20-L101),
[core/tests/common/streaming_sse.rs#L53-L62](https://github.com/openai/codex/blob/8094365e6a2da38be1cd37d58f308c496e3f7ac9/codex-rs/core/tests/common/streaming_sse.rs#L53-L62).

**CI.** `cargo nextest` in four shards, and Bazel. The only test secret is
`BUILDBUDDY_API_KEY`. Real-API tests are opt-in:
[core/tests/suite/live_cli.rs#L1-L4](https://github.com/openai/codex/blob/8094365e6a2da38be1cd37d58f308c496e3f7ac9/codex-rs/core/tests/suite/live_cli.rs#L1-L4)
("`#[ignore]` by default so CI stays deterministic and free").

## Patterns that transfer to us, ranked by fit

1. **Real `claude` binary plus a scripted fake Messages API.** Source:
   claude-agent-acp `session-hooks.test.ts`. Set `ANTHROPIC_BASE_URL` to a
   loopback server and give a dummy `ANTHROPIC_API_KEY`. Isolate `HOME` and
   `CLAUDE_CONFIG_DIR`, and set `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`.
   Answer `/v1/messages/count_tokens` and return 200 for unknown paths. This
   exercises our real `--settings` hooks, `--mcp-config`, `--resume`, `--tools`
   and `--append-system-prompt-file` inside the real CLI. It replaces the
   463-line Python fake. To reach our MCP server and the tool hooks, the stub
   must return `tool_use` blocks, which acp's stub does not.
2. **Build that stub in Rust the codex way.** Use `wiremock`, an `sse()` helper
   and small `ev_*` builders for Anthropic events (`message_start`,
   `content_block_*` for text and `tool_use`, `message_delta`, `message_stop`).
   Mount one reply per turn, in order. A recording `Match` lets a test assert
   what Claude sent: our appended system prompt, the tool list from `--tools`,
   our MCP tool names, and the `tool_result` of the previous turn. Unscripted
   requests should fail loudly, as opencode's `TestLLM` does.
3. **Pre-seed Claude's config for an unattended TUI.** Write
   `hasTrustDialogAccepted` for the workspace into
   `$CLAUDE_CONFIG_DIR/.claude.json`, as the Python SDK's CI does. Pin the
   `claude` version so screen text and request shape stay put.
4. **Drive the TUI in a terminal and read the screen.** codex does this with
   tmux and `capture-pane`; we already own a PTY and can parse it with the
   `vt100` crate. Keep it to a few smoke tests.
5. **Fault injection from the same stub.** Serve 429, 500, 529 and cut streams,
   as codex does, to test how our daemon shows a stuck or failed agent.
6. **Recorded transcripts for parsing code.** happy writes recorded session
   `.jsonl` into a temp `CLAUDE_CONFIG_DIR`. Use this only where we read
   Claude's transcript files.
7. **Record and replay cassettes.** opencode's recorder forces replay in CI and
   records with a key locally. Claude Code's requests carry volatile data
   (dates, paths, versions), so strict matching would break on every CLI bump.
   It needs a loose matcher, so it fits worse than a scripted stub.
8. **A small opt-in real-model lane.** codex `#[ignore]`, acp
   `RUN_INTEGRATION_TESTS`, happy's probe-and-skip. Anthropic's own repos run it
   on every same-repo PR through OIDC workload identity instead of a key secret.

## Open questions

- Does the interactive TUI, not `-p` or the SDK, start cleanly against
  `ANTHROPIC_BASE_URL` with a dummy key? Every peer that uses a stub runs Claude
  headless. The interactive CLI may ask the user to approve a custom API key or
  finish onboarding first. I have not verified which config keys skip those
  screens.
- Which side requests does the TUI send at startup and per turn (title or topic
  calls on a small model, token counts, feature flags)? The stub must route them
  apart from main-loop turns. codex hit this race.
- Does `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` block every call that would
  leave the machine, or must the test also cut outside network?
- How far does the Messages SSE shape drift across `claude` versions? A pinned
  version plus a bump test would show it.
- Can our org set up Anthropic workload identity federation for a small
  real-model lane, as Anthropic's repos do?
