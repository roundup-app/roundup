# Web timeout measurement evidence

Scope: the 79 timeout reductions in the 49 App test files changed by merged
PR #4449. Source: #4451. This specification adds acceptance only; it grants no
exception and changes no timeout.

**T4451a support timeout claims with complete CI evidence.** Given those timeout
reductions, when their timing justification is published, then the timeout rollout
README makes only claims supported by the recorded measurements (policy). Its
App-source sentence distinguishes the source inventory from timing evidence; it
must not claim that every lowered file took at most 45 s without evidence for every
file (policy).

Policy observer: independent review of the README and a committed evidence table
under `tools/oxlint/anti-slop/web-timeout/`. The table accounts for every affected
file, recording repository-relative identity, CI run URL and head SHA, measured
file seconds, and the decision to retain the 60,000 ms cap or use T4451b. A file
absent from the timing output is unmeasured, never zero or evidence of a pass.
Deleted or renamed files identify the commit and surviving observer, or the
explicitly retired scenario clause; they cannot silently disappear from coverage.

Re-measure the three files below and every affected file missing from the
committed duration map by feeding a complete CI run log, including every web
shard's Vitest JSON report, to the existing `loop/web-durations.py`. Record the
command and its exit code, log/run identity and source SHA alongside its output;
confirm that every retained affected file has a result and its tests executed
successfully. Preserve setup/hook cost in file durations and distinguish retries
from first attempts. Partial logs, skipped tests and missing reports do not
establish a timing bound (policy).

| File under `apps/desktop/` | Existing file duration, seconds |
| --- | --- |
| `src/header/u2232_flat_tabs.test.ts` | 108 |
| `src/ink/u501_browser.test.ts` | 78 |
| `src/testing/n5_real_daemon.test.ts` | 61 |

A whole-file duration above 60 s does not establish that any individual test needs
more than 60 s: hooks and multiple tests contribute to that total. Use the CI
per-test results and the successful affected tests to decide the per-test cap.
If a test needs more than 60 s, apply T4451b rather than silently increasing a
file-wide or configuration-wide default. Keep the duration map consistent with
any newly committed extractor output, and label historical measurements with
their own source SHA rather than treating them as measurements of a newer head
(policy).

**T4451b justify each longer test by name.** Given an affected test that needs more
than 60,000 ms, when an over-limit timeout is retained or restored, then only its
exact repository-relative file and full containing-suite/test title receive an
allowlist entry naming the owning scenario, required real process or clock, why
an observer starting none cannot prove that clause, measured duration, and finite
maximum (policy, independently reviewed against T3779a). A file-wide exception,
missing measurement or merely starting a Daemon is insufficient (policy).

Observer: the existing `t3779a_timeout_boundary` fixtures in
`tools/oxlint/anti-slop/web-timeout/timeout.test.mjs` assert that the exact named
exception passes within its maximum, another test fails with exit 1, and the named
test above its maximum fails with exit 1. Reuse these fixtures; add no test that
only rereads documentation or copies the evidence table. Run the affected tests
with their effective declared caps and record their successful CI head (policy).

Policy: preserve all affected scenario clauses and behavioral assertions. Do not
add retries, skip tests, raise the inherited default, weaken the lint boundary,
enable the opt-in rollout, or edit frozen loop/workflow machinery to obtain
passing evidence. This work changes no product path, so no Principle gate gains
a new product observer; its observers are CI timing evidence, existing lint
fixtures and independent review. Progress and engineering questions stay on #4451.

## Existing checks

1. `scenarios/test-cost.md`, **T3779a bound web test timeouts**: exact-test
   exceptions and the 60,000 ms boundary remain in force.
2. `loop/web-durations.py`, module docstring and stdin processing: reporter file
   seconds include hooks; JSON fallback durations omit them.
3. `tools/oxlint/anti-slop/web-timeout/timeout.test.mjs`,
   `t3779a_timeout_boundary`: actual lint exit and diagnostic fixtures enforce
   exception identity, metadata and finite maxima.
4. `apps/desktop/vite.config.ts`, default `test.testTimeout`: the inherited
   15,000 ms default remains unchanged.
5. `tools/oxlint/anti-slop/web-timeout/README.md`, **Timeout boundary rollout
   (T3779a)**: source inventory is neither an allowlist nor a timing measurement.
