# Loop inventory and removal plan

Measured at `f8886e87` (origin/main, 2026-10-14); acceptance: L117 in `scenarios/loop-inventory.md`. This is a plan, not permission to weaken a gate or a claim that removal has shipped.

| Measurement | Lines | Method |
| --- | ---: | --- |
| `loop/*.py`, `loop/*.sh` (including tests) | 13,934 | Physical lines, blank/comment lines included |
| `.github/workflows/*.yml` | 1,616 | Same method |
| Inventory total, 40 files | 15,550 | Sum of the 40 rows below |
| All 60 tracked files under `loop/` | 17,760 | Includes plans, observations and retained evidence; byte lines, including binary payloads, are not a code-size estimate |
| All 15 tracked files under `.github/workflows/` | 1,616 | No untracked files |

Reproduce the inventory with `git ls-tree -r --name-only f8886e87 -- loop .github/workflows`, filtering the three requested globs, and count `len(git show <commit>:<path> output bytes.splitlines())`. Repository history reachable from this commit has 5,691 commits, 2,373 merges (41.7%); this is a different bounded sample from the Issue's 46%/364 figures. No projected saving below treats a partial replacement as whole-file deletion.

## Stock tools considered

- [Merge queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue): validates a temporary combined head instead of requiring branch-update commits. GitHub documents organization ownership as a prerequisite. `gh api repos/saadshahd/roundup --jq .owner.type` returned `User`; it is unavailable here without an ownership change. The single settings decision below asks about that change. If selected, first add `merge_group: checks_requested` handling to **all four** required check producers; validate the combined head, then enable the no-bypass ruleset. Preserve per-PR review/critic evidence and run combined-head validation without treating a synthetic SHA as an approved PR head. Remove update-only fixes only after a live two-PR queue test; conflicts and behavior repairs still need engineering.
- [claude-code-action usage](https://github.com/anthropics/claude-code-action/blob/main/docs/usage.md) and [security](https://github.com/anthropics/claude-code-action/blob/main/docs/security.md): built-in review prompts and `@claude` entry points supply stock model invocation, not this repository's independent verdict policy. Latest published stable release from the GitHub API: `v1`, 2025-08-26; the repository's review/critic already use it. The upstream is unarchived and its API reports a push on 2026-10-14. Do not describe the entire Builder as a Claude wrapper: L23 now executes **Codex**. Mention mode is an optional entry point, not a replacement for unattended priority/dependency intake. Preserve main-owned prompts, actor checks, read-only models and a separate trusted publisher; do not give the stock action a write token merely to post its own gate.
- [Issue forms](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-issue-forms): GitHub-maintained required inputs improve human work-order entry. Forms render Markdown headings, not the canonical single-line fields. Keep a narrow adapter plus legacy/API intake; forms cannot enforce trusted authors, native blocker graphs, immutable Keys or concurrent body edits. Required dropdown/input fields must still round-trip through `orders.py check`.
- [actionlint](https://github.com/rhysd/actionlint) ([releases](https://github.com/rhysd/actionlint/releases)): `v1.7.12`, published 2026-03-30, checks workflow syntax, expressions and embedded shell via ShellCheck. Its upstream is unarchived, with API-reported activity on 2026-07-16. Add it pinned in the existing rules workflow; it cannot replace role-permission, stale-head, capture or scenario assertions. Existing workflow tests are policy checks rather than a complete YAML linter; keep them.
- [Required reviews](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches) and [auto-merge](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/automatically-merging-a-pull-request): GitHub-maintained merge enforcement is already in use. Required reviews with stale-approval dismissal help enforce independent approval, but a generic approval does not assert structured scenario findings, Capture authenticity or a separate critic veto. Keep `review` and `critic` statuses until an equivalence test proves any alternative; never require a human approval on every unattended PR. Replace only duplicate CLI/dispatch plumbing, leaving readiness body checks.

## Inventory

`replace` means the named responsibility moves to stock machinery; the row explicitly states the repository-specific remainder. `delete` retires a loop-only observer or its orphaned helper/test, including its callers and obsolete acceptance through a later reviewed specification. Tests of still-active laws remain. Each non-keep row has one independently scoped Work Issue below.

| File | Lines | Scenario served | Stock replacement considered | Decision and boundary |
| --- | ---: | --- | --- | --- |
| `.github/workflows/activity.yml` | 44 | L104 | Native Actions checks and PR run links | **delete** — Only observes loop runs; retire activity status and five-minute polling, never any required gate. |
| `.github/workflows/build-issue.yml` | 175 | L23, L79, L81, L96, L98, L112 | claude-code-action @claude / reusable workflows | **keep** — Already reusable; stock Claude mode cannot replace the accepted Codex login/model execution policy. |
| `.github/workflows/build.yml` | 101 | L23, L34, L96, L98 | @claude / Actions schedules and concurrency | **keep** — Scheduled authorized priority/dependency intake is not mention-driven execution; retain until equivalence is proved. |
| `.github/workflows/care.yml` | 116 | L107 | Actions schedule / claude-code-action | **keep** — Already uses stock model action and artifacts for product code/test care. |
| `.github/workflows/check.yml` | 95 | L24, L82, L84, L89, L98, L99 | GitHub required checks / merge queue | **keep** — Product validation is required; add merge_group only if ownership makes queue available. |
| `.github/workflows/critic.yml` | 160 | L103 | claude-code-action review / required reviews | **keep** — Already uses the action; generic review does not supply the independent held-out visual critic or separate veto. |
| `.github/workflows/fix-branch.yml` | 221 | L23, L79, L81, L82, L98, L112 | Actions concurrency / @claude / merge queue | **keep** — Already serializes branch writes; real check/review repairs and Codex policy survive even with a queue. |
| `.github/workflows/fix-observer.yml` | 91 | L82 | Actions artifacts / run and job API | **delete** — A dedicated observer of fix jobs, not product acceptance; archive historical evidence before removing publication. |
| `.github/workflows/fix.yml` | 96 | L82, L103, L98 | Actions retry / @claude / merge queue | **keep** — Only branch-update causes could leave with a queue; stock retry does not implement bounded source repairs. |
| `.github/workflows/loop.yml` | 104 | L2, L3, L24, L37, L41, L46, L82, L95–L98, L101, L102, L112 | actionlint / GitHub required checks | **replace** — Add pinned actionlint as stock syntax/expression validation; preserve all repository-specific rules and trusted gate authority. |
| `.github/workflows/qa.yml` | 60 | L52, L66, L98 | Playwright / scheduled reusable workflows | **keep** — Product observation; preserve separate WebKit ownership in #1613. |
| `.github/workflows/retro.yml` | 90 | L106, L109 | Actions insights / claude-code-action | **keep** — Already uses stock action; product delivery accounting adds user value beyond observing a job. |
| `.github/workflows/review.yml` | 148 | L24, L98 | claude-code-action built-in review / required reviews | **keep** — Already invokes the stock action; retain main-owned head admission and isolated status publisher while builder.py reduces dispatch. |
| `.github/workflows/stall.yml` | 51 | L94, L79, L98 | Actions failure notifications | **delete** — A separate loop-job observer and repair source; delete its callers before stall.py. |
| `.github/workflows/summary.yml` | 64 | L23, L24, L66, L82, L103, L106, L107 (job-result reporting) | Native Actions job summaries and logs | **delete** — Only summarizes other loop jobs; retain useful result links at their producing steps and remove reusable calls. |
| `loop/author.sh` | 13 | L2, L23, L97 | Git trailers / GitHub required reviews | **keep** — Stock reviews do not stamp Agent attribution or allocate scenario IDs. |
| `loop/builder.py` | 1,797 | L23, L24, L34, L46, L79, L81, L82, L100, L102–L104, L107 | claude-code-action review / @claude; required reviews; merge queue | **replace** — Replace review invocation, activity polling and ready/merge wrappers where stock APIs suffice; retain Codex execution, queue authorization, recovery and trusted verdict publication. |
| `loop/builder.test.py` | 2,624 | L23, L24, L79, L81, L82, L100, L102–L104 | Action upstream tests / GitHub checks | **keep** — Repository-specific authorization, stale-head and recovery assertions remain; migrate affected assertions with their implementation. |
| `loop/captures.test.sh` | 255 | L112 | Actions artifacts | **keep** — Tests head-bound publication and retention beyond artifact transport. |
| `loop/care.py` | 853 | L107 | Scheduled claude-code-action / GitHub code scanning | **keep** — Code scanning lacks complete scenario/test evidence ranking and bounded authorized repair intake. |
| `loop/care.test.py` | 727 | L107 | Code scanning / upstream action tests | **keep** — Proves collector completeness and publication authority, not vendor execution. |
| `loop/fix-observer.py` | 651 | L82 | Actions run/job API and retained artifacts | **delete** — One historical fixed-window observer of fix jobs; preserve its existing evidence before retirement. |
| `loop/fix-observer.test.py` | 633 | L82 | Actions run/job API | **delete** — Retire the historical collector fixtures after evidence validation; retain live fix admission/gate tests in builder/workflows tests. |
| `loop/observer.py` | 23 | L82 (sole caller: fix-observer.py) | gh api --paginate --slurp | **delete** — Only caller is the retiring fixed-window observer; remove after its caller. |
| `loop/orders.py` | 470 | L23, L34, L79, L94, L96, L102 | GitHub Issue forms / native Issue dependencies | **replace** — Replace human field entry with a required-field form and a small Markdown adapter; retain legacy/API intake, actor allowlist, graph ordering and conflict-safe edits. |
| `loop/orders.test.py` | 368 | L34, L96, L102 | Issue form validation | **keep** — Forms do not prove trusted authors, dependency cycles, legacy bodies or edit concurrency. |
| `loop/qa-sweep.sh` | 201 | L52, L66 | Playwright / Actions schedules | **keep** — Product visual observation, not a loop-job observer; Playwright is execution machinery, not scenario selection and reporting. |
| `loop/qa-sweep.test.sh` | 200 | L52, L66 | Playwright tests | **keep** — Preserves bounded selection and truthful observation results. |
| `loop/retro.py` | 797 | L106, L109 | Actions insights / scheduled claude-code-action | **keep** — User delivery/wait metrics and evidenced bounded repairs span Issues and PRs; stock run lists lack their joins and attribution. |
| `loop/retro.test.py` | 1,029 | L106, L109 | Actions insights | **keep** — Protects delivery accounting and published evidence rather than observing a job for its own sake. |
| `loop/review-checkout.sh` | 11 | L24 | actions/checkout / action review mode | **keep** — Vendor review mode does not guarantee main-owned instructions replace adversarial PR instructions. |
| `loop/rules.sh` | 893 | L2, L3, L33, L37, L41, L42, L54, L95–L98, L101, L102, L112 | actionlint / required reviews / merge queue | **keep** — actionlint checks workflow syntax, not vocabulary, Tokens, provenance, undo intent or Capture authenticity; merge queue unavailable on this owner type. |
| `loop/rules.test.sh` | 536 | L2, L3, L33, L37, L41, L42, L46, L54, L95–L98, L101, L102, L112 | actionlint tests / GitHub rulesets | **keep** — Repository-specific negative gate fixtures remain necessary. |
| `loop/scenario_ids.py` | 200 | L97 | GitHub Issue numbers / Markdown linters | **keep** — Neither assigns collision-free scenario IDs and updates all new references across live branches. |
| `loop/scenario_ids.test.py` | 204 | L97 | Markdown linter tests | **keep** — Proves branch collisions and refusal behavior absent from Markdown lint. |
| `loop/screen-observer.py` | 168 | L79 | unittest / upstream action tests | **keep** — An executable isolated policy regression replay, not a scheduled observer of another job. |
| `loop/screen.test.sh` | 23 | L79 | unittest discovery | **keep** — Small entry point for that regression; no autonomous observation or repair intake. |
| `loop/stall.py` | 196 | L94, L79 | Actions failure notifications / check and PR pages | **delete** — Observes loop jobs and manufactures stall repair Issues; retire automatic stall intake/escalation explicitly, keeping actual failed checks visible. |
| `loop/stall.test.py` | 318 | L94 | Actions failure notifications | **delete** — Delete obsolete stall fixtures only after the retired policy is recorded; keep failure and retry tests elsewhere. |
| `loop/workflows.test.py` | 744 | L2, L23, L24, L46, L79, L82, L89, L98–L107, L112 | actionlint | **keep** — Assertions check trust, authority, event admission and gate semantics; actionlint is complementary syntax/expression checking, not a substitute. |

## Gates and ordering

The regression contract is `.agents/data/gates.md`: `check`, `rules`, `review`, `critic` succeed for the exact head; authored commits retain Agent attribution and undo intent; Capture publication is authenticated and head-bound; review and critic are independent, main-owned and cannot be cleared by authors or by one another. `activity`, stall detection, historical fix observation and decorative summaries are not required gates. Retiring their extra scheduling/escalation promises requires explicit superseding acceptance; it does not retire failed-check evidence or source repair.

```text
stock invocation / Issue form / actionlint
  -> repository policy checks
  -> independent review + critic
  -> GitHub required checks and auto-merge
```

The plan deletes 2,071 inventoried lines across nine rows before caller cleanup (not a measured net saving). Three replacement rows contain 2,371 lines, of which substantial policy code stays. Keep rows account for the rest. Re-measure physical lines and API calls after each implementation; no target justifies dropping gate assertions.

First settle overlapping owners via native blockers, then merge implementation specifications, remove observer workflow/callers, remove collector/tests, and finally remove orphaned helpers. Keep all implementations blocked by #1602 until this inventory merges. Do not blanket-block the inventory closeout epic on implementations: its inventory prerequisite is distinct from its later measurement of shipped changes.

## Filed work

| Row | Work Issue | Native blockers at filing |
| --- | --- | --- |
| `.github/workflows/activity.yml` | [#1735](https://github.com/saadshahd/roundup/issues/1735) | #1602, #1655, #1644, #1287 |
| `.github/workflows/stall.yml` | [#1736](https://github.com/saadshahd/roundup/issues/1736) | #1602, #1287 |
| `.github/workflows/fix-observer.yml` | [#1737](https://github.com/saadshahd/roundup/issues/1737) | #1602 |
| `.github/workflows/summary.yml` | [#1738](https://github.com/saadshahd/roundup/issues/1738) | #1602 |
| `.github/workflows/loop.yml` | [#1739](https://github.com/saadshahd/roundup/issues/1739) | #1602 |
| `loop/builder.py` | [#1740](https://github.com/saadshahd/roundup/issues/1740) | #1602, #1728, #1715, #1659, #1655, #1645, #1644, #1632, #1623, #1735, #1738 |
| `loop/orders.py` | [#1741](https://github.com/saadshahd/roundup/issues/1741) | #1602, #1659, #1655, #1644, #1600, #1623 |
| `loop/stall.py` | [#1742](https://github.com/saadshahd/roundup/issues/1742) | #1602, #1287, #1623, #1736, #1740 |
| `loop/stall.test.py` | [#1743](https://github.com/saadshahd/roundup/issues/1743) | #1602, #1287, #1623, #1652, #1742, #1659 |
| `loop/fix-observer.py` | [#1744](https://github.com/saadshahd/roundup/issues/1744) | #1602, #1623, #1737 |
| `loop/fix-observer.test.py` | [#1745](https://github.com/saadshahd/roundup/issues/1745) | #1602, #1623, #1652, #1744, #1659 |
| `loop/observer.py` | [#1746](https://github.com/saadshahd/roundup/issues/1746) | #1602, #1623, #1744, #1745 |

The only repository-settings question is [#1747](https://github.com/saadshahd/roundup/issues/1747), labelled `flag:needs-user`. Recommendation: retain personal ownership and defer merge queue; choosing an organization transfer requires combined-head check support before enabling the ruleset. This question holds that setting alone, not #1602.


## Inventory validation command

Run from the repository root. Every failure prints its own row and exit code; success prints one row. This observes a pinned document inventory rather than production behavior.

```sh
python3 - <<'PY'
import fnmatch, re, subprocess, sys
from pathlib import Path

commit = 'f8886e87'
text = Path('docs/loop-inventory.md').read_text()
paths = subprocess.check_output(['git', 'ls-tree', '-r', '--name-only', commit,
                                 '--', 'loop', '.github/workflows'], text=True).splitlines()
patterns = ('loop/*.py', 'loop/*.sh', '.github/workflows/*.yml')
expected = {p for p in paths if any(fnmatch.fnmatchcase(p, pat) for pat in patterns)
            and p.count('/') == (2 if p.startswith('.github/') else 1)}
rows = re.findall(r'^\| `([^`]+)` \| ([0-9,]+) \| ([^|]+) \| ([^|]+) \| \*\*(keep|replace|delete)\*\*', text, re.M)
errors = []
actual = [r[0] for r in rows]
if len(actual) != len(set(actual)):
    errors.append('duplicate inventory row')
for path in sorted(expected - set(actual)):
    errors.append('missing row: ' + path)
for path in sorted(set(actual) - expected):
    errors.append('unexpected row: ' + path)
for path, count, scenario, stock, decision in rows:
    if path not in expected:
        continue
    source = subprocess.check_output(['git', 'show', f'{commit}:{path}'])
    if len(source.splitlines()) != int(count.replace(',', '')):
        errors.append('line count differs: ' + path)
    if not re.search(r'\bL[0-9]+', scenario) or not stock.strip():
        errors.append('missing scenario or candidate: ' + path)
    if decision != 'keep' and not re.search(r'^\| `' + re.escape(path) + r'` \| \[#[0-9]+\]', text, re.M):
        errors.append('missing Work Issue: ' + path)
for directory, total in [('loop', 17760), ('.github/workflows', 1616)]:
    measured = sum(len(subprocess.check_output(['git', 'show', f'{commit}:{p}']).splitlines())
                   for p in paths if p.startswith(directory + '/'))
    if measured != total:
        errors.append('tracked total differs: ' + directory)
    if f'{total:,}' not in text:
        errors.append('tracked total absent: ' + directory)
if sum(int(r[1].replace(',', '')) for r in rows) != 15550:
    errors.append('inventory total differs')
for error in errors:
    print('| ' + error + ' | exit 1 |')
if not errors:
    print('| L117: 40 rows, counts, totals and Work Issue links agree | exit 0 |')
sys.exit(bool(errors))
PY
```

Native dependency validation: read `gh api repos/saadshahd/roundup/issues/<row-issue>/dependencies/blocked_by --paginate` and compare against the filing table, which records open overlapping owners at filing time, not perpetual ownership. Review the source links above and `.agents/data/gates.md` separately; this count command does not claim to validate settings, library capabilities or gate equivalence.
