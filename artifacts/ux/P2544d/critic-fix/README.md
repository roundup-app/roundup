The stale autosave now opens only the conflict notice. A failed `pad.list` reload still produces a failure line; Use theirs settles the notice and clears the action failure. The label uses `conflictLabel()` and shares the buttons' baseline. Moves: D2, D5, D6.

```text
stale write → reload → Pad changed / Keep mine / Use theirs
                 ↘ reload failure → failure line
```

Paired headless agent-browser captures use a fresh isolated profile at 1512×950, tree-40 in light and dark, before opening, after an injected -32003 refusal, and after Use theirs. Base is c82d660b7d7f92d4eda61dd4da41814427a830d8; head is fix 65b8fc370 (the Pad source is unchanged by merge e03979f54). Each capture includes the complete Check readings and Drawer text. `delta.txt` finds no passing Check regression; D1, D2, D6, D7 and D10 fail on both. Conflict refusal injection does not mutate the stored text; the real-daemon test separately proves replacement with the newer stored source.

The conflict seed now includes the existing shelf fixture, so a Pad can open without creation. Its first refusal is consumed through pad.create, then pad-0 opens in the Drawer (`head/conflict-seed-drawer.png`). No Workstream is selected in this seed, so user-owned Pads stay out of the running-Agents scope; the Agent-owned Pad is the observer.

The capture script's first attempts selected uppercase DOM text although the tabs use sentence case plus CSS uppercase; those attempts ended before capturing. A later attempt selected user-owned pad-3 in the conflict seed's running-Agents scope; selecting Agent-owned pad-0 completed that observer.

Test audit: no existing tests removed. The new successful-reload example was cut because `p2544d_stale_write_without_event_keeps_draft` already proves that path. The existing real-daemon stale-write observer now asserts absence of raw revision failures instead of requiring them, including after Use theirs. The added failed-reload observer requires the reload error inside the Drawer; the Shelf showing its own list error cannot satisfy it. Existing tests did not assert this path.

Validation: `just lint-web`, `just lint-rust` (`ALL PROOFS CHECK`), the final test-edit lint and `merge-loss` pass. The post-merge focused run passes 56 tests across the conflict, real-daemon Pad and harness files; the tightened Drawer-error assertion passes separately. The broad related run started before the merge: 1,664 tests passed and five failed in the two Terminal test files updated by main during that run. Both files equal main; their settled-checkout retry passes all 33 tests, including all five earlier failures. The initial post-merge Rust lint run ended with signal 143; its standalone retry passed. JSON records retain the attempts.
