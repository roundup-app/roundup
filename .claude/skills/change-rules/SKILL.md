---
name: change-rules
description: Use when writing or fixing roundup code or tests - the rules for UI primitives, reuse, contracts, perf, visual changes and tests, and which checks to run.
---

## Code

- Interactive UI uses the `apps/desktop/src/ui/` primitives, which wrap `@ui-sdk/solid` (`ui-sdk`). A new primitive wraps a library component or a `@ui-sdk/core` behavior, never a hand-written state machine.
- Reuse first (rule 9). Before adding a module, UI pattern (dialog, menu, tooltip, tabs, tree, drag, toast, focus handling, keyboard shortcuts), parser, protocol, store or clock helper, in a new file or an existing one:
  1. Read what the installed dependencies (`package.json`, `Cargo.toml`) and the platform (web, Tauri) already offer.
  2. Research at least two maintained libraries.
  3. Write custom code only when every candidate fails. "We can write it quickly" is no reason.
  - Never re-implement or work around a dependency's feature with `!important` overrides, synthetic events or DOM clones.
  - Record the result in the pull request's `Reuse:` section (`pr-shape`).
- Contract change (rule 4: `contracts/`, a new RPC method, an App seam command, U4's tokens, `GLOSSARY.md` or `docs/adr/`):
  - Every caller changes in the same change. Every new name is in `GLOSSARY.md`.
  - A Message, Route, Held or Takeover change names the laws M1 to M10 it touches (`scenarios/proofs.md`) and keeps `proofs/messages` and `docs/messages.md` agreeing.
  - Regenerate `contracts/generated/` from `crates/contracts`; never hand-edit it.
- Visible change under `apps/desktop/src` (rule 8): Tokens only; name the Checks it moves; break no Check passing on `main`; meet D2, D5 and D6 at 1512x950. Follow `emil-design-eng` and `taste-skill` (its `references/app-screens.md` and `references/tells.md`), and run its `scripts/lint.mjs` on the changed UI files. Never deal a direction, palette or type system with `draw.mjs`: the Tokens and `docs/design-system.md` decide those and win on any conflict. A motion clause adds `animate`.
- Perf (rule 7): cold start under 300 ms, keystroke-to-render under 16 ms p95, 10 idle agents under 150 MB extra RSS. `just perf` fails a regression above 10% (`docs/perf.md`).

## Tests (rule 10)

- Name each test after its scenario (`fn u83_…` proves U83). Land it red, then green (`tdd`).
- A test stays only if it fails when the behaviour its scenario names breaks, and no other test already fails for that break.
- Write none of these: a test with no assertion; one that checks only a test double; one that repeats another test's proof; one that rereads workflow, justfile or prompt text without pinning a token, permission or merge-gate boundary; one whose break the compiler, type check or a lint already fails; one that asserts only a value copied from the code it tests; one that starts a process, browser, daemon, PTY or real `claude` when a test that starts none fails for the same break; one over 5 s whose scenario names no real process or clock.
- No coverage target exists.
- Editing a test file cuts such tests from it; name the test that still proves each cut clause, or the scenario's retirement.
- UI tests check behaviour only: what a key, click, drag, focus move or Message does, plus roles, call counts and contracts. Looks (position, size, gap, overlap, clipping, colour, exact copy) are the design critic's.
- A test waits on the state it reads with a bounded failure, never on a fixed sleep. Fix a flaky wait; raise no timeout and add no retry.

## Run

- `nice -n 10 env CARGO_BUILD_JOBS=4 just ready`.
- The test files you added or changed, and each test the item names as failing: `pnpm --filter desktop exec vitest run <files>` or `nice -n 10 env CARGO_BUILD_JOBS=4 cargo nextest run -p <crate> <tests>`.
- Never run `vitest related`, a whole crate or a whole suite. The pull request's `check` runs the rest.
- Browser tests run headless in their own agent-browser session and a fresh profile. Never attach to the user's browser or desktop; close only what this run started.
- Red `main`: fix forward. Never revert a merge or weaken a test.
