P2544c reconciles changed Crepe blocks into their authored source ranges. Untouched blocks and gaps keep their bytes; moved blocks reuse their source. New lists use `-`. Unprovable mappings pause saving, retain the editor document and report failure without calling `pad.write` or showing Saved. The result is reparsed before it can be saved. Diffing uses jsdiff; source positions and serialization use the installed Milkdown processor. Reconciliation runs behind `getText`, outside the keystroke callback.

```text
editor baseline → block diff → source-range edits → parse verification → existing autosave
```

The initial red Crepe-binding observer exposed table normalization and a lost trailing blank line. The exact-source fixtures cover insertion/deletion, formatting, split/join, separated edits, repeated paragraphs, non-ASCII, CRLF, final-newline presence, undo/redo, reordered authored blocks, new lists, reference definitions, front matter, HTML, footnotes, repeated acknowledgements and clean reloads. A generated caret paragraph is identified through Milkdown's trailing-plugin callback; an authored empty paragraph survives. Generated heading IDs do not count as authored changes. The Drawer observer proves an unmatched source cannot write or acknowledge its draft.

The final Pad-plus-catalogue run passes all 174 tests; the final named source observer passes all 24 fixtures. The broader related run recorded 1,636 passing and two failing tests before the final fixes: the catalogue guard and authored-empty-paragraph fixture. Both pass in the clean final runs. `tests.json` retains those failures. Both post-merge lints pass, proofs print `ALL PROOFS CHECK`, and `merge-loss` passes after merging main’s Door-only changes.

The full Pad regression suite retains slash/drag, ownership, conflict choices, autosave and visual bindings. Existing single-paragraph write expectations and deferred replies now use the exact source without an invented final newline. The contract and caller set remain unchanged in this slice.

Rule 10 coverage:

| Test | Coverage or retirement |
| --- | --- |
| `u20_a_pad_the_user_owns_has_editable_text` | Restored: asserts editable ownership and absence of an append control. |
| `u147_closing_the_drawer_after_a_blur_write_does_not_write_twice` | Restored: blur followed by close sends one write through the autosave deadline. |
| `u36_the_changed_by_line_is_light` | Retired unit-test appearance clause under rule 10; U36’s light appearance remains rendered-observer policy. `u36_a_dirty_draft_shows_a_changed_by_line` still proves the conflict notice; no behavioral clause is retired. |

Fix validation after merging `origin/main`: `pnpm install`, both lints (including `ALL PROOFS CHECK`), `loop/rules.sh merge-loss`, and `pnpm --filter desktop exec vitest related --run src/pads/u147_live_preview.test.tsx src/pads/u20_pad_drawer.test.tsx src/pads/u36_pad_conflict.test.tsx src/pads/PadDrawer.tsx` pass. Both restored tests pass in that related run.

Paired 1512×950 light/dark `tree-40` captures show the editor, slash menu, handle, Saved and a save refusal. `captures.json` names the served revisions. `delta.txt` records no passing Check regression; D1, D2, D6, D7 and D10 already fail on the baseline. D5 and the other Checks remain passing. The post-merge capture initially timed out waiting for the editor under validation load; an idle-host retry passed without an App or assertion change. `observer-failures.json` retains the timeout. These are isolated headless Chromium observations, with no native rendering or timing claim.

The isolated 1,000-key observer passes: baseline p95 15.0 ms, head p95 15.1 ms, below 16 ms and within 10%. `perf.json` retains all 2,000 raw samples, source revisions, command and the empty failure list. Both runs use the same Chromium session, viewport, development mode and 100-paragraph/table/Mermaid/Excalidraw fixture, after validation jobs finished. No native timing claim.

Reproduce with the baseline and head Vite development servers on 5201 and 5202:

```sh
python3 artifacts/ux/P2544c/observe.py
python3 artifacts/ux/P2544c/perf.py <baseline-commit> <head-commit>
loop/rules.sh delta artifacts/ux/P2544c/base artifacts/ux/P2544c/head
```

#2552 remains open for P2544d's atomic Revision guard and all callers, followed by the complete P2544e real-Daemon ownership/reopen and visual-block observers. P2544a (#2573) and P2544b (#2605) are already merged. This PR does not claim full implementation acceptance.
