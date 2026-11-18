# AGENTS.md

roundup is built by agents through hum. Identifiers and RPC methods use `GLOSSARY.md` code terms (read it when naming one), or add one in the same PR. App copy uses its user labels: words describing the action or content, which may differ from code terms.

Before specifying, implementing or reviewing product behavior, read `PRINCIPLES.md`; derive the applicable Gates and Observers from the scenario and diff.

## How hum builds roundup

Work items are roundup Todos assigned to hum's Agent (`docs/agents/issue-tracker.md`); scenario files hold acceptance only. hum runs on the user's Mac and takes each item through the roles in `.hum/roles/`, each loading the skills `.hum/hum.json` names from `.claude/skills/`.

| Step | Who | What |
|---|---|---|
| 1 Plan | `plan` | Finds the item's scenario, names the files and the command that proves it, and splits by rule 3 |
| 2 Build | `build`, `fix`, `repro` | Writes the scenario when `main` lacks it, then tests and code; runs `.hum/hum.json`'s `checks`; writes the PR (`pr-shape`) |
| 3 Review | `review` | A fresh reader judges the diff against the item's scenarios and rules 3, 4, 6, 8, 9 and 10; `.hum/hum.json`'s path levels choose agent or user review |
| 4 Merge | ruleset `main-2` | `check` and `rules` pass on the PR's head (L46) |
| 5 Observe | `qa.yml` | Sweeps `main` every six hours (L66) |

GitHub Actions runs `pre`, `check`, `rules`, `qa.yml` and `pages.yml`; none calls a model. An approach, repair strategy or next work selection never waits for the user. A product decision that no scenario, Principle or `GLOSSARY.md` entry settles goes to the user.

## Rules

1. **Done**: GitHub merged the PR once `check` and `rules` passed on its head (L46).
2. **Slop** fails CI: `just check`, plus no public function without a test or caller.
3. **PR size**: one module directory, about 2000 changed lines. An API change and all its callers form one PR across directories when a split would leave two interfaces live.
4. **Contract change** (`contracts/`, a new RPC method, an App seam command, U4's tokens) follows the Contract change rule in `.claude/skills/change-rules/SKILL.md`: every caller changes in the same PR, and review's approve covers it. Review of a change touching `crates/messages`, `docs/messages.md` or `proofs/` follows V7 (`scenarios/proofs.md`).
5. **Reviewer input**: the item, its diff, its scenarios on `main`, this file and a checkout; never the author's reasoning or the PR text (`.hum/roles/review.md`).
6. **Vocabulary**: no `GLOSSARY.md` _Avoid_ word in a public name outside `crates/agents/src/claude_code/`.
7. **Perf**: `.claude/skills/change-rules/SKILL.md`, Code.
8. **Visual change** under `apps/desktop/src`: `.claude/skills/change-rules/SKILL.md`, Code.
9. **Reuse first**: `.claude/skills/change-rules/SKILL.md`, Code.
10. **Tests earn their place**: `.claude/skills/change-rules/SKILL.md`, Tests.

## Conventions

- No scenario, no work. Tests are named after their scenario (`fn t3_…` proves T3).
- Work in your own worktree and branch; `pnpm install` before pushing. A change ends with the checks `change-rules` names under Run, and CI's `check` judges the push. By hand, `just check origin/main` runs every lint and the tests the change reaches. PRs go against `main`.
- Behind `main`: merge `origin/main` in; never rebase a branch whose review is in flight. On a lockfile conflict, take main's file and regenerate it in the merge: `git checkout origin/main -- Cargo.lock && cargo update -w`, or `git checkout origin/main -- pnpm-lock.yaml && pnpm install`.
- Every authored commit carries `Author-Agent: <id>` (`human-saad` for the user's own) in its final trailer block, with no blank line before `Co-Authored-By` or another trailer. No check requires it.
- Red `main`: fix forward through a PR that repairs the cause; never revert the merge or weaken a test.
- Regenerate `contracts/generated/` from `crates/contracts`, never hand-edit it.
- Nothing pushes to `main`; every change merges through a PR.
- What the user reads (a question, a PR body, a report): `reduce`, then the `show-me` layout. A verdict is for agents.

## Agent skills

- **Issue tracker**: roundup Todos assigned to hum's Agent; see `docs/agents/issue-tracker.md`.
- **Triage labels**: none; Todo actions stand in for them; see `docs/agents/triage-labels.md`.
- **Domain docs**: single-context, `GLOSSARY.md` and `docs/adr/`; see `docs/agents/domain.md`.
- **ui-sdk**: before using ui-sdk, follow the `ui-sdk` skill and read `apps/desktop/node_modules/@ui-sdk/solid/docs/llms.txt`. To build a new component, also search `docs/core.md` there by heading, and read `rendering.md` beside it.
