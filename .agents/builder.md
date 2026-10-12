# Builder

One kind of run builds roundup and reviews it. The task below names the run: build an Issue, fix a PR, or review a PR's head. A review run is a fresh Builder: it never saw the author's run and reads no rationale (rule 5).

Skills, each read from `.agents/skills/<name>/SKILL.md`: `prime` loads the taste rules; `to-spec`, `grill-with-docs` and `anchor` write a scenario; `codebase-design` judges a seam; `tdd` lands a scenario red then green; `review` and `judge` give a verdict; `reduce` and `show-me` write the PR body. A change under `apps/desktop/src` adds `emil-design-eng`, and `percy-review` in a review run; a motion clause adds `animate`.

Browser tests run headless in a dedicated agent-browser session and a fresh test profile. Never attach to the user's browser or desktop: no `--auto-connect`, `--headed`, CDP connection, personal profile, or OS keystrokes. If headless launch fails, repair the isolated browser setup or record the observer failure; do not fall back to the user's Chrome. Close only tabs and browser processes this run created.

## Recipes

Each recipe says what its part of a PR holds. Read `.agents/data/work.md` for the canonical Issue format. A build run follows every recipe its Issue needs.

A UI Issue, or a Brief, Door or Decision Issue in the first user journey, also reads `.agents/data/journey.md`: its stage, rendered observer and next-gap rule apply to the build and the independent review. Work toward the selected journey, not merely an isolated green component test.

- **Spec**, for an Issue requesting a specification. Each id gets a `**<id> <name>.**` heading; every then-clause names the test that will assert it, or is marked policy; every check is a number citing its file and line on `main`; every cited id, file and PR exists on `origin/main`; a script has one row per failure with its exit code; the text states the result, never the incident; native Issue dependencies identify prerequisites; `loop/rules.sh vocab` passes.
- **Contract**, for a row needing `contracts/`, a new RPC method, an App seam command, `GLOSSARY.md` or `docs/adr/`. Every caller changes in the same PR and every new name is in `GLOSSARY.md`; a Message, Route, Held or Takeover change names the laws M1 to M10 it touches (`scenarios/proofs.md`) and keeps `proofs/messages` and `docs/messages.md` agreeing.
- **Code.** Tests are named after their scenario; `just check` passes; after any merge of `main`, `git diff origin/main --stat` lists only your files. A visible change meets D2, D5 and D6 at the scenario's viewport (`.agents/data/harness.md`), with failure text visible on the densest seed.

- **Filing** (L96, L102), for any run that files or edits a work Issue: write the new body to a file, run `python3 loop/orders.py check <file>` and write it only on exit 0. To rewrite a body you read earlier, save that read to a file and write with `python3 loop/orders.py edit <issue> <read-at> <read-file> <new-file>`, which merges your change into any edit made since instead of erasing it. A repair run (task: "Repair run") edits the Issue the same way and opens no PR.

## Owner comments

A task holding an `## Owner comments` heading carries what the owner (`saadshahd`) left as comments on the Issue and its PR, oldest first. Each overrides the Issue body and a scenario's Work table where they conflict, and an `Overturned by` note in a scenario means build its replacement. The owner's closure of the Issue or PR outlasts your run: before your last push, and before you reopen or ready anything, run `python3 loop/builder.py closed <issue> <pr>`; on exit 1 change neither, push nothing and reopen nothing.

## Build run

1. Branch as the task says from `origin/main`. Commit the spec or the red tests first, push, and open a draft PR as `.agents/data/pr.md` says, and link its work Issue.
2. Read every comment on the Issue starting `<!-- fix-exhausted` first: each is a PR that used its fix runs, with the causes and commits that failed. Treat them as approaches already tried and take another. Read every `<!-- strike -->` comment too: each is a run that ended without a PR, and one holding "The screen sent it back to the loop" answers that run's `ask`, so settle it yourself and never ask it again. Fulfil the Issue acceptance. A missing implementation prerequisite becomes a linked blocking Issue; a specification-only PR keeps the implementation Issue open.
3. `just ready <pr>`. It marks the PR ready and arms auto-merge, or exits 1 naming each line `.agents/data/pr.md` asks for that the body lacks: add them with `gh pr edit` and run it again. On a branch without the recipe, merge `origin/main` first.

A fix run starts with `gh pr ready --undo`, answers every finding or failure in the task with commits on the PR's branch, then ends with `just check`, a push and step 3. A paragraph of the PR body holding "The screen sent it back to the loop" answers the question an earlier run stopped on, so settle it yourself and never stop on it again.

A missing prerequisite is an engineering repair: file the missing implementation as a scoped `loop:work` Issue, then block this Issue on it: `gh api -X POST repos/{owner}/{repo}/issues/<this>/dependencies/blocked_by -F issue_id=$(gh api repos/{owner}/{repo}/issues/<prerequisite> --jq .id)`. An isolated contract test does not complete a multi-scenario implementation Issue. Keep implementation within its Scope; an Architect or the user authorizes an ownership expansion. Contract approval requirements still apply.

Stop only on an unresolved product decision that changes the requested outcome and that no scenario, Item or `GLOSSARY.md` entry settles. Engineering uncertainty calls for investigation, a tested repair or a scoped prerequisite Issue under the existing direction. For that unresolved question, leave a draft with `Stopped: <the question>`, its user-visible consequence and one recommended choice; the end of your run screens it like an `ask` (L79, L81). With no PR to leave, put the same three in your answer's `ask`.

## Review run

Your input is the task, the checkout of its head, `gh pr diff`, the scenarios it names and `.agents/data/gates.md`. You cannot post or push; your answer is the verdict.

1. `git rev-parse HEAD` equals the task's head, or reject with that finding.
2. Judge the diff against the recipes, the scenario and `AGENTS.md`, naming the rule per defect.
   - A visible change: the Checks it moves hold, and its Percy build shows no unintended diff, name, email or token.
   - A change to `crates/messages`, `docs/messages.md` or `proofs/`: `just proofs` (until it exists, `bend proofs/messages/PROOF.bend`) prints `ALL PROOFS CHECK`, and `proofs/messages/LAWS.bend` weakens no law.
   - A contract change: probe each new type and method in the checkout, never only its text.
   - A change to loop machinery: no rule or workflow lets a PR pass its own gate.
   - An `Undoes:` trailer (`git log --format='%(trailers:key=Undoes,valueonly)' origin/main..HEAD`, L101): judge each named commit's undone hunks whatever earlier verdicts said, and reject unless a scenario or Issue the PR names needs the undo.
   - An empty diff: for every then-clause of the scenarios it names, find the test on the checkout whose body asserts it, not only its name, and run it; a clause with no such test, or a failing one, is a reject.
3. A re-review checks each earlier finding first, then what changed. Judge the head, not who pushed it.
4. Reject only a real defect: a broken rule, a contradiction, wrong behaviour, data loss, or a security hole (a secret, a token, an identity, a rule letting an Agent act beyond its role). Wording and taste are `NOTE:` lines in an approve.

Done: a build or fix run leaves a ready PR with auto-merge armed, or a draft with a `Stopped:` line; a review run answers `verdict` and `findings` in the format of `.agents/data/gates.md`. A build run ends without a PR only when its Issue is settled or it asks the user. Settled: blocked by a prerequisite Issue, or closed as completed with a comment naming the evidence because a merged `build/<Key>` PR already met its acceptance; a remainder that another open Issue's acceptance holds keeps nothing open, and the comment names that Issue. When other merged PRs already met the acceptance, open the `build/<Key>` PR with one empty commit (`git commit --allow-empty`) and `Closes #<issue>`, as `.agents/data/pr.md` says. When only an observation is missing, make it and commit its evidence in a PR that closes the Issue. An observation no run can make goes in your answer's `ask`: only a check whose pass or fail only the user's Mac can produce (a logged-in real `claude`, the `just app` window's native behaviour no Chromium check covers). A check `check`'s `macos-latest` jobs already run is read from CI history (`actions: read`), and a native look-and-feel check whose observer is a Linux or Chromium check closes on that observer, the user reporting what they meet on the Mac. A build run that finds its Issue's work merged, with that work's Linux or Chromium tests passing on `main`, closes the Issue as completed with a comment naming the PR and those tests and saying the user reports what they meet on the Mac (L46); it asks for no native Mac check. The `ask` holds: what to build from which commit, each step, and what each result decides. Your build run's answer is `{ask}`, empty otherwise; a screen (`.agents/screen.md`) sends a non-empty one to the user, to an agent on the user's Mac, or back to the queue as a strike (L79).
