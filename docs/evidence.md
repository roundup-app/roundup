# Evidence references

L112 changes evidence storage only. Paths under `artifacts/`, `crates/rpc/r16/` and `crates/rupd/evidence/` in scenarios/docs are artifact-relative payload names, not committed-file links. Required observers keep every assertion and condition in their scenario. A specification-only PR requires no payload. After 14-day Actions expiry, result summaries remain and the recorded command regenerates evidence; an expired artifact is no longer claimed downloadable.

Historical statements remain observations at their named revisions. For a scenario id, use its Observer command at the stated revision, with `just capture <ids>` selecting only the cited ids. Native observers keep their scenario's Mac steps; executable observers/test inputs retiring with directories are relocated by #1651, while #1613 owns QA publication. These links describe no new observation.

## J14 first journey audit

| Revision | Result | Regeneration |
| --- | --- | --- |
| `b5b51f346486ecd59bbb58ab21c325eaf78467b6` | Four isolated headless passes cover all five journey stages at 1280×800 and 1440×800; all 68 screens pass D1–D14 and D16. The Daemon is real, `claude` is fake, and the chooser returns the configured isolated Project. | On a disposable checkout of this revision after `pnpm install`, run `python3 artifacts/ux/journey/J14/reproduce.py`; it installs the recorded temporary driver, runs `just capture J14` and restores the test/package files. The [journey instructions](../.agents/data/journey.md) name the stages and conditions. |

Historical payload partition: `artifacts/ux/journey/J14/`. This summary retains the result previously cited from its README. It claims no native chooser, native App or real `claude` observation. The user reports what they meet on the Mac.

## U451 native window observer

| Revision | Result | Regeneration |
| --- | --- | --- |
| `88a658e24029121600ed888f9c0f65ceec686937` | Native traffic-light placement, Window menu/Mission Control titles, drag and zoom were unobserved. Chromium reserved-geometry evidence does not decide them. | Follow [U451's native observer](../scenarios/ui-window-bar.md) with `pnpm install` and `just app <disposable-project-path>` on a Mac. Record each operation's pass/fail. |

Historical payload partition: `artifacts/ux/U451/head/`. The result stays unobserved until those steps run. Linux/Chromium implementation acceptance and independent gates remain as U451 specifies.

## U346 executable observer

| Result | Regeneration |
| --- | --- |
| The retained observer's assertion is a hit test and real pointer deletion for Agent-owned/user-owned Pads and a Todo with a Terminal open, at 1280×800 and 700×800; it exits nonzero on a miss. No new pass is claimed here. N7 lifecycle tests live beside the observer in `apps/desktop/observers/U346/`. | On a disposable checkout of `3970aa87d180fdabb5d433cb7ab6bec3a39056d6`, run `cargo build -p rupd -p rup`, then `bash artifacts/ux/U346/observe.sh` from the repository root; it owns its fake Daemon, Vite and isolated headless browser. |

## U55 historical capture

| Result | Regeneration |
| --- | --- |
| On `9784d5439888c0fe847050943305b330b0c192a1`, U55 records a white notch about 7×15 px at x272–279/y70–85 in a selected empty Terminal. Its drawing element and cause were the requested diagnosis, not a result established by this migration. | Follow [U55](../scenarios/ui.md) on that disposable baseline after `pnpm install`: run `just harness <seed>`, select a Terminal with no output at 1280 px in an isolated headless browser, inspect the specified element/style facts and then feed one line of output; publish both screenshots when U55 is cited. |

`docs/evidence-relocation.md` lists the observer sources, their required inputs and their regeneration paths. Historical checkout commands above refer to the files at those recorded revisions.

## U468 primary Terminal questions

The backend observer is `cargo test -p rup --test u468`: eight real-Daemon tests use
an isolated primary PTY and the production `rup mcp` → `agent.ask` call. They assert
exact answers, resumed execution and cleared needs-you state, consecutive and
replaced requests, dismissal, subprocess/claimed-user refusal, Door answers,
Takeover. Captured Prompt identity remains covered by
`b6_terminal_input_invalidates_identity_before_the_next_signal` in
`crates/rupd/tests/b6_prompt_identity.rs`. `e2e/u468_claude.py` renders the shim's actual
MCP form request and returns its actual tool response; it supplies no answer route.
This is separate from #1497's App selection, focus, attention and Toast observer.

On 2026-10-15, the native observer passed on Linux with the pinned **Claude Code
2.1.300 executable**, a fresh configuration, a real Daemon and a 120×40 primary
PTY. Aimock supplied only the model's tool call and continuation. Claude displayed:

```text
MCP server “roundup” requests your input
Cats or dogs?
cats — Quiet
dogs — Walks
✔ Answer: dogs
❯ Accept    Decline
```

The observer typed `dogs`, navigated to Accept, then a separate Terminal write of
Return submitted the form. The original tool returned exactly
`{"answer":"dogs","note":""}`; Claude rendered `U468 child resumed with dogs.` and
the Decision cleared. This proves vendor rendering/input and routing, not a live
model's compliance, a logged-in account or native App presentation. The native
observer is explicitly invoked because final confirmation is an observed action,
not a guessed renderer delay.

To repeat after `pnpm install`, run the observer (it checks both vendor executables
and builds the Daemon and shim):

```sh
pnpm observe:terminal-question
```

It prints its isolated socket and Terminal id at confirmation. Within 30 seconds,
use another shell to inspect and submit that Terminal, substituting those two values:

```sh
python3 - /path/to/isolated/rupd.sock 1 <<'PY'
import base64, json, socket, sys
with socket.socket(socket.AF_UNIX) as connection:
    connection.connect(sys.argv[1])
    replies = connection.makefile()
    def call(n, method, params):
        connection.sendall((json.dumps(dict(jsonrpc='2.0', id=n, method=method, params=params))+'\n').encode())
        result = json.loads(replies.readline())
        assert 'error' not in result, result
        return result['result']
    screen = call(1, 'terminal.screen', {'id':sys.argv[2]})
    print('\n'.join(screen['lines']))
    assert any('❯' in row and 'Accept' in row for row in screen['lines'])
    call(2, 'terminal.write', {'id':sys.argv[2], 'data':base64.b64encode(b'\r').decode()})
PY
```

The authenticated callback requires the native program itself as the primary
executable. A non-exec shell wrapper retains a different PID and is refused;
point `ROUNDUP_CLAUDE_BIN` at the native binary. The pinned observer does so.
The shim negotiates MCP 2025-11-25: installed Claude rejects the old
`elicitation/create` request in its 2026 protocol. rmcp 3.5.1 supplies the upstream
[bootstrap-neutral discovery fix](https://github.com/modelcontextprotocol/rust-sdk/releases/tag/rmcp-v3.5.1)
that permits the supported negotiation without a custom protocol implementation.

## A2698a Ask delivery and local commands

At 1512×950, an isolated headless agent-browser observed the App against the real Daemon and a temporary copy of `crates/rup/tests/e2e/fake_claude.py`. That copy handles `/clear` with `SessionStart` and no submit, holds `/held` until a release file appears, and injects refusal for `/model` by emitting no acceptance. These are controlled Adapter observations, not claims about running real Claude Code.

- `/clear` reached Sent with Idle and remained typed through subsequent commands and acceptance bounds: [screen](../artifacts/ux/A2698a/head/real-clear.png), [rows](../artifacts/ux/A2698a/head/real-clear.rows.json).
- `/held` showed Sent before its submit was released: [screen](../artifacts/ux/A2698a/head/real-held.png), [rows](../artifacts/ux/A2698a/head/real-held.json).
- The injected refusal reached Failed with its Agent-naming reason and all three recovery actions; Drop changed it to dropped: [screen](../artifacts/ux/A2698a/head/real-refusal.png), [rows](../artifacts/ux/A2698a/head/real-refusal.rows.json). D1–D14 pass on the [real refusal screen](../artifacts/ux/A2698a/head/real-refusal.checks.json).
- On `tree-40`, the failed reason and recovery controls remain visible, alongside Sent and the live Kind: [before](../artifacts/ux/A2698a/base/dense.png), [after](../artifacts/ux/A2698a/head/dense.png). D2/D5 pass. D6/D7 fail on `input.todo-tick` on both baseline `9ae183686` and the changed App; D10 reports those failures. All other Checks keep passing. `loop/rules.sh delta` reports no regression; the Ask controls add no D6 failure.

The behavioral observers are A2698a's named A41/H11 and U505/U506 tests. The existing tests in those files retain distinct proofs (byte framing, durable claim, ordinary instruction acceptance, ordering, selection, refusal reason and waiting-part recovery); no complete proof is replaced, so none was removed. The ordinary lost-submit observer additionally rejects local-command Signals; the existing live-row observer now checks immediate Sent and subsequent activity changes.
