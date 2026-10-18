# U2571 empty Project keys

Base: origin/main a8df15237. Head: PR #2646 after merge 1cbe8d1b5, `Pane.tsx`, `styles.css` and behavioral tests. Observer: isolated headless agent-browser sessions `builder-39106503918` and `builder-39106503918-contrast`, fresh profiles in `/tmp`, 1512×950. Fake Daemon: U26 harness on ports 5203 (base) and 5201 (head). No native macOS claim; the user reports what they meet on the Mac.

```text
empty → New Workstream
          New Agent      ⌘ N → agent.spawn(parent: null) ×1
          New Terminal   ⌘ T → terminal.open(workstream: null) ×1 → focused Bubble
          Ask bar        ⌘ / → focused input → Escape → start button
```

`base/` and `head/` hold paired screenshots and complete `window.__checks()` results for the empty Project, creation failure (`failNext(-32000, "no space")`), successful retry, tree-40 and its failed Workstream creation. Light and dark use `set media`. The contrast session launches with Chromium `--force-high-contrast --disable-blink-features=ForcedColors`; `(prefers-contrast: more)` matches and `(forced-colors: active)` does not. The `*-contrast` captures record that additional browser mode, with light/dark requested separately.

Empty, shortcut, failure and recovery captures pass every Check. Dense-seed Todo checkboxes retain the baseline D6 (missing hover), D7 (non-instant press) and resulting D10 failures. No baseline-passing Check regresses, including D2, D5 and D6. Labels/chips fit below the button, stay text, and failure messages remain visible. Tab from `.pane-action` reaches New Terminal, skipping all three hints; no hint has a tab stop.

The `*.effects.json` records show one Agent/Terminal call and no `rail.createWorkstream` or `rail.startDoor`. Pending creation is covered with the held promise in `u2571c_hints_follow_empty_pending_failure_and_nonempty_states`; that test also proves rejected creation, disappearance for a Project-root Agent and restoration after removal. U143 retains creation/retry ownership. The old U524 empty chord test is replaced by `u2571b_each_empty_hint_runs_its_action New Terminal`; its pointer case remains.

No handler, timer, subscription, contract, Token or Daemon path changes. Only the already-empty composition renders three CHORDS rows and existing KeyChip instances; selected-Terminal typing and idle Agent costs retain their existing paths. No native timing claim is made.


Validation:

- `just lint-web` and `just lint-rust`: exit 0. After the clean main merge, `just lint-web` passes again; no Rust file changed.
- `pnpm --filter desktop exec vitest run src/terminal/u143_door_states.test.tsx src/bubbles/u469_tabs.test.tsx`: 47/47 pass on the merged head.
- The named U38, U2567, U2239–U2241, U32, U143 and U524 regression run passed 88 cases before the final full-App strengthening and duplicate-test removal; the final 47-case run covers both edited test files.
- `pnpm --filter desktop exec vitest related --run src/terminal/Pane.tsx src/terminal/u143_door_states.test.tsx`: 166 files, 1,274 passed, three failed and three skipped. The initial failures/setup timeouts were in U166, U194, U351 and U356 during the fresh-worktree build and concurrent run. Both isolated retries with unchanged timeouts and `--maxWorkers=1` pass: U166/U194 3/3; U351/U356 3/3. The first run also reported a fork teardown timeout; its process was terminated only after the complete test report.
- `loop/rules.sh merge-loss`: exit 0 after the clean merge of a8df15237. No conflict resolution was needed. Paired browser observations were repeated against that main and merged head, with no passing-Check regression.
