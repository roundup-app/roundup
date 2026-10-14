# AGENTS.md

roundup is built by agents in a loop. Every identifier, RPC method and UI string uses a `GLOSSARY.md` term (read it when naming one), or adds one in the same PR.

## The loop

Work orders are GitHub Issues (`.agents/data/work.md`); scenario files hold acceptance only.

Every unattended run chooses and executes routine engineering work under the recorded direction. A review run judges each proposed change; the user answers only `flag:needs-user` questions (L79) and the required Mac observation. An approach, repair strategy or next work selection never waits for user confirmation.

Builder and QA runs are one-shot GitHub Actions jobs, and an event ends every wait: a merge, a run's end or a failed check starts the next run. The user ends only the waits labelled `flag:needs-user` (L79). A Builder run builds a work Issue, fixes a PR or reviews a PR's head, each fresh, from one prompt, `.agents/builder.md`. A role's prompt is `.agents/<role>.md`, its skills are in `.agents/skills/`, and data a step reads on demand is in `.agents/data/`.

| Step | Who, where | Skills |
|---|---|---|
| 1 Ask | The user sets direction and files work Issues; a build run specifies an Issue that holds no Key or whose scenarios are not on `main` (L34) | — |
| 2 Build | `build.yml` (L23): on each merge, each new work Issue, each build job whose model worked and each hour, one Builder run per ready Issue | prime; spec: to-spec, grill-with-docs, anchor; seam: codebase-design; tdd; UI: emil-design-eng; motion clause: animate |
| 3 Review | `review.yml` (L24): a review run once `check` passes on a PR's head, and `critic.yml` (L103): a design-critic run on a UI PR's head; `fix.yml` (L82): at most three fix runs per Builder PR | review, judge |
| 4 Merge | GitHub auto-merge on `check`, `rules`, `review` and `critic` (L46) | — |
| 5 Observe | `qa.yml` (L66) sweeps `main` every six hours; a `design-critic` run on request | review-animations, break-ui |
| 6 Retro | `retro.yml` (L106) reads the last 24 hours daily and on dispatch, reports value and files up to three loop Work Issues; the user steers by editing or closing them | retro |

| 7 Care | `care.yml` (L107) reads complete main code/test evidence daily and on dispatch, ranks every finding and owns up to three repair Work Issues per UTC date | — |

## Rules

1. **Done**: GitHub merged the PR once its required checks passed on its head (L46), and `.agents/data/pr.md` and `.agents/data/gates.md` hold.
2. **Slop** fails CI: `just check`, plus no public function without a test or caller.
3. **PR size**: one module directory, about 2000 changed lines.
4. **Contract change** (`contracts/`, a new RPC method, an App seam command, U4's tokens) follows the Contract recipe of `.agents/builder.md`: every caller changes in the same PR, and the review run's approve covers it.
5. **Reviewer input**: the diff, the scenario, this file, earlier `VERDICT:` comments and a checkout; never the author's rationale.
6. **Vocabulary**: no `GLOSSARY.md` _Avoid_ word in a public name outside `crates/agents/src/claude_code/`.
7. **Perf**: cold start < 300 ms, keystroke-to-render < 16 ms p95, 10 idle agents < 150 MB extra RSS; `just perf` fails a regression above 10% (`docs/perf.md`).
8. **Visual change** under `apps/desktop/src` names the Checks it moves, uses only Tokens, and breaks no Check passing on `main`.
9. **Reuse first**: before adding a module, UI pattern (dialog, menu, tooltip, tabs, tree, drag, toast, focus handling, keyboard shortcuts), parser, protocol, store or clock helper, research existing libraries. A PR adding a file for this machinery or under `crates/*/src/`, `apps/desktop/src/` or `loop/` carries a `Reuse:` section naming at least two maintained libraries considered (for example `@ark-ui/solid` for UI or crates.io/npm packages), with source links and release/maintenance evidence. Name the selected library or state that every candidate failed; for each rejected candidate, cite a specific missing capability, licence restriction, size cost, rule 7 measurement or lack of recent releases. "We can write it quickly" is no reason. Custom code is allowed only when every candidate fails. A PR that only edits existing files needs no `Reuse:` section; research and reuse still apply.

## Conventions

- No scenario, no work. Tests are named after their scenario (`fn t3_…` proves T3).
- Work in your own worktree and branch; `pnpm install` and `just check` before pushing; PRs go against `main`.
- Loop machinery, including workflows, merges after independent review and the required checks; reviewers use main’s instructions and inspect the proposed diff.
- Red `main`: revert, never fix forward.
- Regenerate `contracts/generated/` from `crates/contracts`, never hand-edit it.
- No run pushes to `main`; every change merges through a PR.
- What the user reads (a needs-you comment, a PR body, a report): `reduce`, then the `show-me` layout. A verdict is for agents.

## Agent skills

- **Issue tracker**: GitHub Issues, as work orders; see `docs/agents/issue-tracker.md`.
- **Triage labels**: none but `wontfix`, since an open Issue the user files is already queued (L34); see `docs/agents/triage-labels.md`.
- **Domain docs**: single-context, `GLOSSARY.md` and `docs/adr/`; see `docs/agents/domain.md`.
