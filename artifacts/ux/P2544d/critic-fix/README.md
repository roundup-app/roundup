The stale autosave now opens only the conflict notice. A failed `pad.list` reload still produces a failure line; Use theirs settles the notice and clears the action failure. The label uses `conflictLabel()` and shares the buttons' baseline. Moves: D2, D5, D6.

```text
stale write → reload → Pad changed / Keep mine / Use theirs
                 ↘ reload failure → failure line
```

Paired headless agent-browser captures use a fresh isolated profile at 1512×950, tree-40 in light and dark, before opening, after an injected -32003 refusal, and after Use theirs. Base is c82d660b7d7f92d4eda61dd4da41814427a830d8; head is this fix's source tree. Each capture includes the complete Check readings and Drawer text. `delta.txt` finds no passing Check regression; D1, D2, D6, D7 and D10 fail on both. Conflict refusal injection does not mutate the stored text; the real-daemon test separately proves replacement with the newer stored source.

The conflict seed now includes the existing shelf fixture, so a Pad can open without creation. Its first refusal is consumed through pad.create, then pad-0 opens in the Drawer (`head/conflict-seed-drawer.png`). No Workstream is selected in this seed, so user-owned Pads stay out of the running-Agents scope; the Agent-owned Pad is the observer.

The capture script's first attempts selected uppercase DOM text although the tabs use sentence case plus CSS uppercase; those attempts ended before capturing. A later attempt selected user-owned pad-3 in the conflict seed's running-Agents scope; selecting Agent-owned pad-0 completed that observer.

Test audit: no tests removed. The existing real-daemon stale-write observer now asserts absence of raw revision failures instead of requiring them, including after Use theirs. The added parameterized observer distinguishes successful reload from failed reload and proves only the latter surfaces an error; existing tests did not assert that distinction.
