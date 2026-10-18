# U2571 empty Project keys

Base: origin/main 7a5f31d1a. Head: PR #2646, `Pane.tsx`, `styles.css` and behavioral tests. Observer: isolated headless agent-browser sessions `builder-39106503918` and `builder-39106503918-contrast`, fresh profiles in `/tmp`, 1512×950. Fake Daemon: U26 harness on ports 5202 (base) and 5201 (head). No native macOS claim; the user reports what they meet on the Mac.

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
