P2544b adds a 500 ms pause save on the existing Pad source interface. Blur and close flush immediately, writes run one at a time, and a noninteractive Saved mark acknowledges only the current draft. Later edits keep their document and caret. A close snapshots the latest draft for the old Pad and Project; deletion cancels queued work. Failures keep the draft and permit retry. Explicit conflict choices survive an active save and an own-write echo cannot erase an in-flight undo.

```text
edit → pause / blur / close → one write at a time → acknowledge current draft
```

The final 149 Pad tests pass, including Crepe slash/drag/read-only and retained visual bindings. Both lint recipes pass; proofs print `ALL PROOFS CHECK`. Main's easing-token change merged cleanly and `merge-loss` passes. `validation.json` records commands and the four observed red regressions before their repairs.

The broader related run started before the final repairs: 1,864 passed, two Pad assertions failed, and U356's setup hook timed out while its cold Daemon build took 3m 05s. Both Pad cases pass in the final complete Pad suite; U356 passes on its isolated warm-build retry. `tests.json` retains the initial result, shutdown cleanup and final observers. CI judges the final push.

Paired 1512×950 light/dark `tree-40` captures show the editor, slash menu, handle, Saved and save refusal. `captures.json` identifies the baseline and final source. `delta.txt` exits 0: no passing Check regresses. D5 passes; D1, D2, D6, D7 and D10 fail identically on baseline and head. Each capture retains its complete Check output. `observer-failures.json` keeps the interrupted development-server capture and the corrected timing-label error.

The isolated headless Chromium observer measures 1,000 prose keys in 100 paragraphs plus a table, Mermaid and Excalidraw fences. Baseline and head both have 14.1 ms p95: below 16 ms with no measured regression. `perf.json` retains all 2,000 samples, verified source commits, actual invocation and corrected reproduction command. Its mistyped baseline label was corrected against the served checkout; arguments label already-running servers and do not select source. No sample was changed or discarded. This is no native timing claim.

Rule 10 cuts from `u20_pad_drawer.test.tsx`:

| Removed duplicate | Surviving proof |
| --- | --- |
| `u20_leaving_the_field_calls_pad_write_once_when_the_text_changed` | `u147_blur_after_a_change_writes_once_and_an_unchanged_blur_writes_nothing` in `u147_live_preview.test.tsx` |
| `u20_leaving_the_field_with_unchanged_text_calls_nothing` | The same U147 blur test, plus `p2544b_unchanged_or_undone_draft_does_not_autosave` in `u20_pad_drawer.test.tsx` |
| `u20_a_change_skipped_while_editing_refreshes_on_blur_when_nothing_was_typed` | `u20_clicking_in_and_out_without_typing_never_sends_the_text_the_user_was_shown` in the same file |

Reproduce with baseline/head Vite development servers on 5201/5202, respectively:

```sh
python3 artifacts/ux/P2544b/observe.py
python3 artifacts/ux/P2544b/perf.py 84290149a5e1d88c657a5795989bf8d248813bb4 39d0a91f5f98b956064db65da93ac8722b7f8405
loop/rules.sh delta artifacts/ux/P2544b/base artifacts/ux/P2544b/head
```

#2552 stays open for P2544c source-range reconciliation, P2544d Revision guards and full P2544e real-Daemon reopen/visual-block acceptance. This slice retains today's save path and adds no contract.
