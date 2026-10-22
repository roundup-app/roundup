# A test owns one scenario clause

Module: tests under `apps/desktop/src`, `crates/` and `tools/`. Source: #3421. Ids: T3421a, T3421b, T3421c.

Existing checks on main:

1. `AGENTS.md`, Rules, rule 10: a test stays only if it fails for the break its scenario names.
2. `scenarios/ui-truncated-names.md`, heading U3296c: a Todo row opens no title Tooltip.
3. `apps/desktop/src/shelf/u491a_browser.test.ts`: three Shelf tests that waited on that Tooltip went red on `main` when U3296c landed.

**T3421a a test depends on no other scenario's clause.** Given every test under `apps/desktop/src`, `crates/` and `tools/`, when each is read against the scenario it is named after, then none waits on or asserts a clause another scenario owns (policy):

- A step another scenario owns stays only when the test's own scenario names it as a given.
- A foreign step such as a Tooltip, popover, toast, animation or label wording is replaced by the shortest path to the state the test's clause needs: a direct call, a fixture or a key press, never another feature's UI.
- The test keeps its own then-clause and the assertion that proves it.
- All fixes land in one PR (policy).

**T3421b the PR lists each fix.** Given T3421a's fixes, when the implementation PR is written, then its body has one row per fixed test naming the test, the foreign clause it depended on and what it uses instead (policy). A test fixed by #3420 is not listed.

**T3421c a guard is added only when exact and fast.** Given T3421a, when the implementation PR is made, then it either adds a lint that fails on a foreign wait in exact terms (for example a browser test that waits on `[role=tooltip]` while its file name carries no Tooltip scenario id), runs in seconds, and has a test that fails when the lint stops catching the case; or adds no guard and the PR body states why none is exact (policy).

Observer: independent review of the diff and surviving test bodies, and a green `check` on the head. Add no test that rereads this specification. Out of scope: product behaviour, and test cuts that rule 10 already covers. Engineering progress and questions belong on #3421.
