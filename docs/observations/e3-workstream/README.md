# E3 real-Claude observation — failed

On 2026-10-30, build `cbb6b05020067531f9e4b721f393f73c2d16629c` did **not** satisfy
`e3_workstream_uses_todos_and_reaction_unprompted`. #5002 remains open, blocked by
[#5051](https://github.com/roundup-app/roundup/issues/5051) (current-head activation)
and [#5052](https://github.com/roundup-app/roundup/issues/5052) (Todos and keeper Pads).
No Mac observation is needed to establish these failures.

[The recording](2026-10-30.json) holds the fixture sources, exact prompt, all
assistant tool calls, reported final replies, public saved-record reads, start
Context, turn-end status and released-check output. Reports are distinguished
from records. Credentials, private configuration, thinking and vendor usage
records are excluded.

## Result

Real Claude Code **2.1.296**, first-party OAuth, answered the login probe
`Reply with OBSERVER_LOGIN_OK only.` with `OBSERVER_LOGIN_OK`. The isolated
fixture used real git Worktrees and a local bare push remote, real Node tests,
the checksum-verified Worktrunk **v0.80.0** release, and controlled `gh` transport
adapted from `crates/agents/tests/fixtures/worktrunk-v0.80.0/gh.py`.
This was a fixture PR, **not a live GitHub PR**; no fake vendor supplied a turn.

The first attempt exposed defective fixture wiring: its nonexistent push remote
and branch-unaware forge reply prevented PR registration. It is retained in the
record and supplies no passing evidence. The second attempt fixed both, provided
pending PR evidence before the prompt, and reproduced two independent failures
in normalization and registry lookup. The Agent received the Workstream guidance
in SessionStart attachments. Its only task prompt was:

```text
fix X, then wait for PR checks
```

| Acceptance fact | Result in the second attempt |
| --- | --- |
| Reproducible X; normally answering public tools | Pass: two failing checks, then two passing checks on the pushed commit |
| At least two task Todos before multi-step work | **Fail:** no create/update calls; public `todo.list` returned `[]` |
| Complete Todos as outcomes land | **Fail:** no Todos existed |
| Retain a keeper finding in a Pad | **Fail:** Agent reported lookup must reuse slug normalization; `pad.list` returned `[]` |
| Agent independently creates a Reaction without approval | Pass: `reaction_create` at 05:27:14.751Z, authenticated maker Agent `3` |
| Saved reason, Home, exact target, finite bound and expiry | Pass: Reaction `41789b8db8f7ced2662f87b518d543d3`, Home `1`, target `3`, one firing, no re-arm, expiry `2026-10-31T06:00:00+00:00` |
| Reaction pins the fixed PR head | **Fail:** cached `7873520a6d1b8fc964885edc9331610434cafa65`, rather than pushed `52930067eef1ff24063ce858fa27437230070dc9` |
| Turn ends while check remains pending, without polling | Pass: final reply 05:27:20.852Z, public Idle 05:27:21.140Z; no sleep or repeated wait reads |
| Release produces a durable Message via NR7/NR8 | **Fail:** release at 05:27:45.498095Z passed X on an archive of the pushed commit; subsequent refresh invalidated the old pin, with zero firings and `message.list` returning `[]` |
| Read back placement through public tools | Pass for existing items: Agent `3` under Workstream `1`; Reaction Home `1`; no Todos or Pads to place |

The Agent explicitly noticed the old pin in its final reply, but left that wait
active. Later NR7 head-change refusal worked: it did not silently repin or claim
success. NR8 delivery remains undemonstrated by this observation. No observer
created a replacement Reaction or supplied successful evidence for the old head.
The App's user Stop/Intervene observer remains separate.

## Reproduce

1. Check out the recorded build, run `pnpm install --frozen-lockfile`, then
   `cargo build -p rup -p rupd --bins`. Keep `claude auth status` logged in with
   the configured login/gateway. Record the actual `claude --version` on rerun.
2. Create disposable Project/config/data/socket/fixture-bin directories. Use the
   recording's `fixture.before` files for the two-part X. Commit them on `main`,
   add fetch origin `https://github.com/fixture/collector.git`, and set a separate
   local bare repository as origin's push URL. Set `origin/main` and `origin/HEAD`.
3. Install the recording's `fixture.forge_transport` as executable `gh` in the
   isolated PATH. Its root is `/tmp/e3-observation`; use that root or replace it
   consistently. Install the pinned release `wt` there too. Its archive SHA-256 is
   `532ce3ed5eecb1be274c925b5887f61671e2434a4ca2561b9a8ac9379dbba199`;
   extraction instructions/provenance are in the existing Worktrunk fixture README.
   Do not create `released.json` yet. The transport returns pending until release.
4. Reuse the isolated onboarding/trust setup from
   `crates/rup/tests/e2704b_rail_name.rs`, without its model fixture or API-key
   helper. Preserve the login environment. Bundle the existing sidecar with
   `bash tools/sidecar/bundle.sh /tmp/e3-observation/sidecar --local-node`.
   Start real `rupd` on the fixture Project with isolated `RUPD_SOCKET`,
   `ROUNDUP_DATA_DIR`, `CLAUDE_CONFIG_DIR`, and the fixture PATH; point
   `ROUNDUP_CLAUDE_BIN`, `ROUNDUP_RUP_BIN`, `ROUNDUP_SIDECAR_DIR` at the real
   programs/bundle. Never print credentials or archive the config directory.
5. Through existing public RPC/MCP, as the user: `project.setWorktrees` with
   `on:true` and check `node --test slug.test.cjs`; `rail.createWorkstream` named
   `slug`; `agent.spawn` in the Project with that Workstream as parent and no
   prompt/order. Save the returned Agent/Workstream/Worktree identities.
   Set the branch's origin tracking ref/upstream and publish it to the local bare
   remote. Use the fixture's `gh pr view` in that Worktree and public
   `agent.worktreeState` to establish PR 42, the exact head and pending evidence
   before sending the task. Clear only the fixture's Worktrunk cache if repairing
   setup; never alter saved Reaction pins or fabricated freshness flags.
6. Send exactly the prompt above using `agent.prompt`. Retain the SessionStart
   guidance attachment and timestamped tool calls. Observe public Agent status
   until turn end; the observer may read status, but the Agent must not poll.
   Read actual `todo.list`, `pad.list`, `reaction.list/get` and `rail.tree` records.
   Keep the check pending until the Agent has ended its turn.
7. Verify the pushed branch head equals the local Worktree commit. Run
   `node --test slug.test.cjs` on a clean `git archive` of **that commit**, saving
   stdout and exit status. Only on exit 0 write `released.json` containing that
   exact `head`, exit status and release time. The transport grants success only
   to that head. Let the normal collector/evaluator refresh; read Reaction firing
   ids and the linked durable Message with `message.list/get`, including delivery
   state. A missing/invalidated wait is a failure; never rescue it with user
   creation, manual run or invented passing checks.
8. Record every acceptance row, stop only the fixture Agents/Daemon, and keep
   #5002 open unless the full observer passes. The recording contains both
   before/after source snapshots; no fixture commit is needed from a remote.

## Gates and verification

P4: real configured vendor/login; no credential copying. P6: public Home readback.
P9/P10: one task prompt; no model evaluated the condition and no Agent polled.
P13: real authenticated maker, reason and bounds; changed head invalidated rather
than substituting success. No production behavior, contract or scenario changed.

`pnpm install --frozen-lockfile` and the source build passed. `just ready` is
recorded on the PR after completion. No helper/test code is added by this evidence
PR; the real observation and clean archived-commit check exercise the fixture.
