# Quality target (staging list)

The owner approved these rules on 2026-10-24 from a fan-out audit. This file stages them until each lands in its home; a landed row is deleted here, and the file goes when the last row lands. Each row's home is the one place the rule lives afterwards. "Loop" rows become work Issues; "hand" rows touch frozen loop files and land through hand-opened PRs.

Done, in the owner's words: "faster verlocity, maintainable, performant, no regression or stuckiness". Baseline to re-measure after the first wave: median 26 min open to merge; 40 of 100 merged PRs needed fix runs; 15 of 115 closed PRs never merged; CI test time 4,424 s web, 2,632 s Rust.

## Design and UX

| Id | Rule | Home | By |
|---|---|---|---|
| D1 | One click on a row selects it and opens nothing; Return or the row's Open button opens it; double-click or F2 renames; a press that becomes a drag or rename never opens it. | journey.md taste list | loop |
| D2 | One key or click from the Todos list focuses a one-line field; text plus Return files the Todo; only the field, the new row and its group mount. | journey.md | loop |
| D3 | A group with no items renders nothing, except the list's one empty line. | journey.md | loop |
| D4 | Every press changes the control's colour, opacity or scale within one frame by a Token; no background box appears on a control without one at rest. | journey.md | loop |
| D5 | A row at rest shows its name and at most one state glyph (failed > blocked > running > done); other parts show on focus or selection only, never on hover, and move no other row. | journey.md | loop |
| D6 | Header and footer strips show only what needs action now; the changes view mounts only when changes exist, behind one icon with a count. | journey.md | loop |
| D7 | Selected, focused and dragged rows differ by one cue: text colour or one selected ground. | journey.md | loop |
| D8 | Row text in Rail, Todos, Pads and Terminal tabs starts at one shared inset; name and glyph share a baseline within 1 px. | journey.md | loop |
| D9 | Every look value is a Token; no `!important`, no raw px, ms or colour outside the Tokens file; selectors at most two compounds, no child combinator. | stylelint config | loop |
| D10 | Floating surfaces use a two-layer shadow Token (tight contact plus soft ambient) and a 0.5 px ring; colours come from a Radix scale in light and dark with the macOS accent; the Rail and Shelf use native vibrancy. Shader or WebGL backgrounds are out. | docs/design-system.md | loop |
| X1 | Destructive actions run at once with "Deleted · Undo" and ⌘Z; a confirm dialog only where undo is impossible. Supersedes U150. | journey.md | loop |
| X2 | Every App chord (⌘N, ⌘T, ⌘W, ⌘F, ⌘K …) has a menu-bar item showing its key. | journey.md | loop |
| X3 | Every list takes ↑↓, Home/End, type-to-select, ⌘A and ⇧/⌘-click; Escape cancels a rename and restores the text. | journey.md | loop |
| X4 | Fields holding prompts, paths or names turn off spellcheck, autocorrect and autocapitalize. | journey.md | loop |
| F1 | Each of the top 10 tasks ends in at most 3 presses and has a chord. | journey.md | loop |
| F2 | One status shows in at most 3 places at rest. | journey.md | loop |
| F3 | A selected or focused row reveals at most 2 controls; a row shows at most 4 state marks at rest. | journey.md | loop |
| F4 | With nothing selected, the landing screen shows the ask bar and "needs you"; the rest opens on demand. | journey.md | loop |

## Motion

Motion (motion.dev) becomes the App's one animation engine and every animation is rewritten on it. Supersedes the library gate and U2579a in `docs/motion.md`, and U133/U510's ink-only press.

| Id | Rule | Home | By |
|---|---|---|---|
| M1 | Frequent actions (keys, list moves, tab switch, Return opens) are instant. | docs/motion.md | loop |
| M2 | Press: scale 0.97, 100 ms, back on release. | docs/motion.md | loop |
| M3 | Drawer, Shelf, Terminal bubble: Motion spring, bounce ≤ 0.1, ~0.25 s; a reverse keeps its velocity. | docs/motion.md | loop |
| M4 | Menus and popovers: scale 0.96 → 1 plus fade from the trigger corner, 150 ms in, 100 ms out. | docs/motion.md | loop |
| M5 | Reorder, nesting, new and removed rows: Motion layout animation, 200 ms; never a restarting keyframe. | docs/motion.md | loop |
| M6 | Drag: the lifted row keeps an accent outline, a dashed slot marks the landing place, nothing else flickers. | docs/motion.md (#3540) | loop |
| M7 | Todo done: the tick draws, then the row folds after a 300 ms beat. | docs/motion.md | loop |
| M8 | Copy, save, file: the control's own label changes for 1.5 s with no layout shift; every action shows a visible change within one frame. | docs/motion.md | loop |
| M9 | Agent status: glyph crossfade 150 ms; only "working" moves at rest. | docs/motion.md | loop |
| M10 | One reduced-motion switch turns movement into a 150 ms fade. | docs/motion.md | loop |
| M11 | Only transform and opacity animate; times and curves are Tokens; exits are faster than entrances; every effect is listed in the table or deleted. | docs/motion.md | loop |

## Code, architecture, libraries

| Id | Rule | Home | By |
|---|---|---|---|
| C1 | No hand-written file over 1000 lines; CI enforces it. | check.yml lint | loop |
| C2 | `copy.ts` splits into one module per surface; each crate's `lib.rs` holds only its interface. | check.yml lint | loop |
| C3 | Zero import cycles; no unused export, type, file or dependency (fallow, cargo-machete, cargo-deny). | check.yml lint | loop |
| C4 | A new RPC method is one contract declaration plus its handler; the rest is generated (specta). | AGENTS rule 4 | hand |
| C5 | A fix PR adds a lint, type or test that fails for the whole bug class. | AGENTS | hand |
| C6 | One job, one library; no hand parsing of a standard format; a new ResizeObserver or MutationObserver names why no library or CSS does it. | AGENTS rule 9 | hand |
| C7 | Rust: no sleep-poll loop, one clock helper, no child process on a request path, every timer on the shared clock. | clippy / ast-grep | loop |
| C8 | Rust library code denies unwrap, expect, panic and panicking index; each crate has a typed thiserror enum at its boundary. | Cargo.toml lints | loop |
| C9 | Release profile: LTO, strip, one codegen unit; rupd under 15 MB; dist under 10 MB. | Cargo.toml, check.yml | loop |
| C10 | Entry JS under 400 KB gzip; xterm and dnd-kit load lazily; at most one awaited RPC before first paint. | check.yml | loop |

## Failures and copy

| Id | Rule | Home | By |
|---|---|---|---|
| E1 | A failed read or local write retries once by itself before any message; a Daemon exit restarts with backoff and shows only on the third failure. | journey.md | loop |
| E2 | Every Daemon error code maps to a copy entry; the App never matches error text; one mapper turns errors into outcomes. | contracts | loop |
| E3 | Each failure source shows in one place per Project; no swallowed rejection. | journey.md, lint | loop |
| W1 | Every copy key has a caller and each value appears once. | lint | loop |
| W2 | A label is at most 3 words, a sentence at most 12, an error is cause plus fix; no fragment values. | lint | loop |
| W3 | No GLOSSARY Avoid word or code term (Daemon, MCP, session, revision, retained, acceptance) in App text. | lint | loop |

## Perf

| Id | Rule | Home | By |
|---|---|---|---|
| P1 | A new or changed RPC method has a perf budget, or the PR states it is off the hot path. | docs/perf.md | loop |
| P2 | A perf repair PR shows the metric before and after from one observer; a baseline change shows an old-versus-new pair from one host. | docs/perf.md | loop |
| P3 | Mac-only or host-specific measurement splits from Linux work before it starts. | docs/perf.md | loop |

## Tests

| Id | Rule | Home | By |
|---|---|---|---|
| T1 | A test over 30 s on CI fails unless an allowlist names the real process or clock it needs. | nextest / vitest config | loop |
| T2 | A test whose scenario id is in no scenario file fails CI; two tests with one name in different files fail CI. | loop/rules.sh | loop |
| T3 | No assert on computed style, size or exact App text; query roles and names. | lint | loop |
| T4 | Cuts: real-Daemon web tests, per-test Rust fixtures, Chromium looks tests, flaky slow retries, library re-proofs, the 456 s gutter test, copy-string tests, Rust real-process duplicates, browser tests to jsdom, capture pairs, fake-claude waits (verify first). | — | loop |
| T5 | Cut loop workflow-reread tests. | loop tests | hand |

## Loop velocity and specs

| Id | Rule | Home | By |
|---|---|---|---|
| V1 | A scenario citing a missing path, test or id fails before review. | check.yml lint | loop |
| V2 | check's test lanes start when lints pass, beside review. | workflows | hand |
| V3 | A build or fix run ends with the web and Rust lints. | builder.md | hand |
| V4 | A fix run reverts changes outside its Issue's module. | builder.md | hand |
| V5 | A PR the critic blocks twice on one finding closes; its Issue splits per module. | workflows | hand |
| S1 | A clause is at most 400 words with no history, Issue numbers or amendments; a scenario file at most 5000 words. | check.yml lint | loop |
| S2 | Retired clauses and clauses with no test or Proof line are deleted; ids go to a one-line list. | scenarios | loop |
| S3 | GLOSSARY.md becomes a term table under 3000 words. | GLOSSARY.md | loop |
| S4 | A rule lives in one file; others link to it. | AGENTS | hand |

## Proofs (Bend, law-driven)

| Id | Rule | Home | By |
|---|---|---|---|
| B1 | The proof gate runs `bend PROOF.bend --verdict` (the Lean-checked kernel) and the pin follows Bend releases. | proofs/check.sh | loop |
| B2 | Agent lifecycle (launch, restart, ending, worktrees) gets owner-held laws; its pure step is written in Bend, proven, compiled to C and called from Rust through one FFI crate. | scenarios/proofs.md | loop |
| B3 | Model and code are also tied by generated traces (proptest state machine), Shuttle for Daemon threads and Kani on pure Rust steps. | scenarios/proofs.md | loop |

## Libraries to file

xterm addons (search, serialize, clipboard, image); fuzzysort; TanStack virtual after a list-length measurement; Tauri store and window-state; tracing; gitoxide spike; rusqlite 0.41; insta; sccache, mold, cargo-binstall; cargo-deny; fallow; Vitest browser mode; specta; cargo-mutants; fast-check and proptest; typos; ruff; hyperfine; mimalloc; official Tauri plugins (global shortcut, single instance, deep link, positioner, log); tauri-plugin-decorum; tauri-nspanel; @solid-primitives; ast-grep; difftastic; cargo-llvm-lines; native NSMenu context menus and haptics; Motion. Rejected: Shader Gradient, Atlassian Pragmatic drag, kobalte, tauri-specta, anyhow, Quint for new laws.
