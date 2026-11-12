# Assertion baseline after timeout migration

Module: `tools/oxlint/anti-slop/web-assertions`. Source: #4448.

**T4448a re-key rows cannot authorize an edited assertion.** Given an isolated Git repository whose `origin/main` baseline contains the current timeout-stripped identity for `expect(element.scrollWidth).toBe(10)` in a named test, when a proposed head changes that assertion to `.toBe(11)`, replaces its baseline entry with the audited identity of the edited source, and supplies a `rekey.jsonl` row with the same file/test, `from` equal to the base identity and `to` equal to the edited identity, then the actual assertion lint exits 1 with an `Added or broadened assertion baseline entry:` diagnostic. The head has the same number of entries as the base and each entry matches its head source, so neither a count check nor a stale-source check proves this clause. Observer: new implementation test `t4448a_rekey_cannot_authorize_edited_assertion` in `tools/oxlint/anti-slop/web-assertions/assertions.test.mjs`, using the existing isolated-repository lint fixtures and real Git merge-base comparison.

**T4448b retain exact exceptions and timeout independence.** Given a base using the current timeout-stripped identities, when the actual assertion lint checks each input below, then its exit equals the required value. Observer: the existing `t3779b_assertion_boundary: baseline <change>` cases in `tools/oxlint/anti-slop/web-assertions/assertions.test.mjs`; retain their behavior assertions rather than duplicate them under a new name.

| Input (`<change>`) | Required lint exit |
| --- | --- |
| Unchanged assertion and exact entry (`unchanged`) | 0 |
| Assertion and its entry both removed (`removed with entry`) | 0 |
| Only the registration timeout changes from 90,000 to 60,000 ms (`timeout edited`) | 0 |
| Assertion removed but its entry retained (`deleted`) | 1 |
| New assertion with an exact new entry (`added entry`) | 1 |
| Assertion changed from `.toBe(10)` to `.toBe(11)` and its entry replaced, without a re-key row (`broadened entry`) | 1 |
| Edit outside the owning test, entry kept (`edit outside the test`; Python fixture in a Git repo with `origin/main` and baseline history, shaped like #6916's line) | 0 |
| Edit inside the owning test, assertion text unchanged, entry kept (`owner edited`) | 1, one diagnostic naming the swap |
| Same edit, entry swapped to the new identity (`owner edited, entry swapped`) | 0 |
| Same swap plus one added entry (`swap with added entry`) | 1 |
| Swap whose test name differs (`swap across tests`) | 1 |
| Second identical assertion reusing the swapped entry (`swap reused`) | 1 |

The timeout case isolates assertion identity; it does not permit an over-limit timeout through T3779a's separate gate (policy).

Policy: remove `rekey.jsonl` and its loading/authorization code from `baseline.mjs`; the timeout-identity migration is already on `main`. Remove the obsolete migration instructions from this module's README. A leftover or newly supplied file at the old re-key path grants no baseline permission. An identity depends on the files alone, never on `baseline.jsonl`, its Git history or a rehash of the file text. The lint accepts an identity swap, TS and Python alike: a head entry absent from the merge base replaces a base entry absent from the head, one-to-one, with the same file, test, assertion text and violation kinds, and no net addition. It covers an edit inside the owning test, such as `main()` of a Python test or a TS test body. An entry an edit leaves unmatched fails with one diagnostic naming the stale entry and the identity that replaces it (file, test, both identities). T4448a stays: an edited assertion cannot be swapped. Keep the merge-base subset comparison and normal `pnpm lint` entry point; do not regenerate or expand the baseline, change timeout allowances, cut product tests, add dependencies or modify loop machinery. The implementation records each failing fixture separately with its input, diagnostic and exit code, using the existing fixture-report facility. Test accept/reject behavior, never the presence or absence of source text (policy).

Checks (existing on specification base `4dab889be`; none retired):

1. `scenarios/test-cost.md`, T3779b prevent new appearance and copy assertions: exact identities, shrinking baseline and stale-entry rejection.
2. `tools/oxlint/anti-slop/web-assertions/baseline.mjs`, `baselineErrors`: compare head entries with the Git merge base and reject added or broadened entries.
3. `tools/oxlint/anti-slop/web-assertions/assertions.test.mjs`, `t3779b_assertion_boundary: baseline timeout edited`: changing only a timeout preserves the assertion exception.
4. `tools/oxlint/anti-slop/web-assertions/lint.mjs`, no-argument fixture invocation and final exit: ordinary lint reaches the fixture suite and baseline failures cause exit 1.

No product behavior or `PRINCIPLES.md` Gate changes; the observers above exercise the assertion-lint permission boundary. Implementation progress and engineering questions belong on #4448.
