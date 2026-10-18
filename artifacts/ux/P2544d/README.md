P2544d guards `pad.write` with optional `expectedRevision`. One immediate SQLite transaction reads ownership and Revision, rejects a stale Revision, writes the text and mirrors its file. A refusal leaves text, file, Revision, Touches and Events intact. Two independently opened connections have exactly one winner in both storage modes. Omission retains owner-only writes. Bindings are regenerated from `crates/contracts`; MCP and the CLI derive the field from that contract. The CLI's existing spelling is `--expectedRevision`.

```text
source Revision → guarded autosave → acknowledged baseline
                         ↘ stale → pad.list → Keep mine / Use theirs
```

Autosave sends the source Revision; Keep mine sends the latest listed Revision. A stale response without an Event retains the draft and refreshes the shared list without a read Touch. A further intervening change conflicts again, without a blind retry. Typing survives an in-flight save. A late response cannot clear a newer conflict or replace text and Revision adopted through Use theirs. Missing attribution says “Pad changed” rather than inventing an Actor. M1–M10 remain unchanged; no Message, Route, Held or Takeover contract changes.

P2544e runs in isolated headless Chromium with the actual Crepe, Mermaid and Excalidraw bindings. It edits prose, autosaves, reopens, edits Mermaid text and draws a rectangle on the real canvas. Assertions compare the exact source outside each edited block. The real-Daemon observer starts an Agent in a Workstream; its fake Claude program invokes the actual `rup pad create` command. The user takes ownership through the Drawer, types, awaits Saved, closes the Drawer, restarts the Daemon and reopens. `pad.read` returns the exact edited source at Revision 2, with its Home and user ownership intact. `real-daemon-reopened.json` and its capture retain this result. The Daemon and tool calls are real; no real Claude model, native window or native timing is claimed.

Validation retains each attempt in `tests.json`: all 178 Pad/catalogue tests pass; the 276-test Rust run covers every contract and Pad test, the new RPC/CLI/MCP observers and both earlier Agent-rewind timeouts. The original full Rust run had 720 passes, two acknowledgement timeouts under overlapping validation and one skip; both timeouts pass in isolation. The three failures from the interrupted related run pass on isolated retry. After merging main’s tooltip changes, all 32 affected Pad interaction tests, both lints, proofs (`ALL PROOFS CHECK`) and `merge-loss` pass. The final full affected-web run passes all **1,625 tests across 214 files**, with no failures or pending tests; `tests.json` records its command and named Pad observers.

Paired light/dark `tree-40` captures at 1512×950 show the editor, slash menu, handle, Saved, save failure and conflict choices. `captures.json` identifies the served commits. `delta.txt` records no passing Check regression: D1, D2, D6, D7 and D10 already fail on the baseline; D5 and the other Checks remain passing. Baseline conflict captures use a named Actor; head captures exercise the missing-Event refusal. Failure text and both conflict choices remain visible on the dense seed.

The idle-host 1,000-key observer passes: **13.4 ms p95 on baseline and head**, below 16 ms and within 10%. `perf.json` retains all 2,000 raw samples, exact source commits, command, viewport, build mode and fixture. Both runs use the same isolated headless Chromium host and 100-paragraph/table/Mermaid/Excalidraw fixture. The first invocation had a mistyped baseline metadata argument and was interrupted when main gained shared UI changes; all 567 samples remain in `perf-interrupted.json`. Commit arguments are now verified before launching the observer. `observer-failures.json` also retains the IPv4 server-bind repair, overloaded navigation failures and rounded canvas-coordinate repair. No native timing claim.

Rule 10 cuts:

| Cut | Retained proof or retirement |
| --- | --- |
| `p7_pads_survive_reopening_the_directory` | `p7_every_pad_keeps_its_own_owner_and_text_after_reopening` proves persistence for multiple owners. |
| `u20_the_drawer_shows_the_owner_mark_and_the_name` | Retired from unit coverage: title/owner appearance belongs to the paired rendered observer. |
| `u20_a_write_reply_never_overwrites_text_typed_after_a_quick_refocus` | `p2544b_inflight_edits_are_not_lost` proves the retained draft, selection and subsequent write, including advancement to Revision 2. |
| `u36_a_dirty_draft_shows_a_changed_by_line` | `u36_typing_more_while_the_line_shows_keeps_the_line_and_blur_sends_no_write` and `p2544d_external_change_pauses_autosave` prove the notice and retained draft. |
| `u36_keep_mine_keeps_the_line_while_its_write_is_in_flight` | `p2544d_pending_keep_mine_cannot_clear_a_newer_conflict_use_theirs_%s` proves the pending notice and newer choice; `p2544d_conflict_choices_preserve_latest_draft` proves acknowledgement clears the old conflict. |
| `u36_keep_mine_never_overwrites_text_typed_after_a_quick_refocus` | Strengthened as `p2544d_conflict_choices_preserve_latest_draft`, including the subsequent write's acknowledged Revision. |

Reproduce from the repository root, with baseline/head Vite development servers bound to 127.0.0.1 on 5201/5202:

```sh
python3 artifacts/ux/P2544d/observe.py
python3 artifacts/ux/P2544d/perf.py 2d083bc32fad0f787f8d5cdf8eff7ee5ad613066 1b0410acb11d6a8a10e0cedb88b1102f05ef40b1
loop/rules.sh delta artifacts/ux/P2544d/base artifacts/ux/P2544d/head
ROUNDUP_PAD_EVIDENCE="$PWD/artifacts/ux/P2544d" pnpm --filter desktop exec vitest run src/pads src/copy.test.ts --maxWorkers=1 --no-file-parallelism
```

P2544a (#2573), P2544b (#2605) and P2544c (#2616) are merged. This PR completes P2544d–e and demonstrates the remaining implementation acceptance for #2552.
