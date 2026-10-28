# Timeout boundary rollout (T3779a)

The `anti-slop/bounded-test-timeout` rule is available through the existing Oxlint
plugin. It is **opt-in** while the exact existing-test exception review is pending.
This PR does not complete T3779a, enable the repository gate, or authorize cuts.

```text
pnpm lint --config tools/oxlint/anti-slop/web-timeout/audit.json
  -> existing rules + bounded-test-timeout
  -> 158 timeout observations in 50 files require review
  -> justify exact exceptions or repair each observation
  -> enable the rule in .oxlintrc.json in a subsequent PR
```

Reproduce the source inventory (no test modules or global setup execute):

```sh
node tools/oxlint/anti-slop/web-timeout/audit.mjs > /tmp/timeouts.jsonl
node --test tools/oxlint/anti-slop/web-timeout/timeout.test.mjs
```

`baseline.jsonl` records the actual lint exit, source revision, tool hash, analyzed
file count and each diagnostic. Its App source equals base `d99d98226`;
the recorded tool hash identifies the rule used for this audit. These observations
are **not** an allowlist or timing measurements. The printed locations help review;
exception identity uses exact repository-relative file and full containing-suite /
test title, never a line number. Parameterized tests use their static title template.
Dynamic titles cannot receive an exception. No existing timeout or retry changes.

`fixtures.jsonl` records every boundary fixture's input, diagnostic and exit code
through `pnpm lint --no-ignore --config <isolated-config> --format json <fixture>`.
The 70 retained fixtures include 45 negatives, each with its own diagnostic and
exit code. The over-limit alias fixture added during development was removed:
`configuration default` already proves that literal-property rejection; the
mutated and immutable alias fixtures retain the distinct binding-resolution proof.
Each test verifies that Oxlint analyzed its file and that the expected rule emitted
its diagnostic. Successful fixtures also reject unexpected timeout diagnostics.
Normal `pnpm lint` (and therefore `just lint-web` and CI) also runs this suite,
alongside the assertion boundary suite. Targeted invocations do not recursively
run either suite. To recreate the report, set `TIMEOUT_FIXTURE_REPORT` to a new
output file while running the fixture test command. Each fixture removes only its
own directory.

The rule reads the installed Vitest APIs: numeric third argument, options timeout,
import aliases, local aliases/constants/arithmetic, namespace imports, chained and
parameterized registrations, suite inheritance, `vi.setConfig`, and configured
`testTimeout`. `defineConfig` from Vite or Vitest (including imported aliases and namespace
imports) resolves the effective `test` / `testTimeout` through the same property
resolver. Unknown configuration spreads and computed keys fail; a later explicit
safe default overrides an earlier unknown spread. Configuration aliases remain
valid only while unmodified. Dynamic configuration callbacks remain unresolved
and fail for review. Default exports in `vite.config` and `vitest.config` JS/TS files (including
CJS/ESM extensions) resolve the same effective properties, including aliases,
computed keys and spreads. Unrelated default exports are not configuration.
An exported alias of `defineConfig(...)` is checked at its call rather than
misread as an unresolved object. Configuration-wide defaults still cannot use
a named-test exception.

Unknown file configuration and computed option keys fail at their
source location. A later explicit timeout overrides an earlier unknown property,
spread, or inherited file setting. Const options are accepted only while their
properties stay unchanged: direct writes, writes through local aliases, method
calls and escapes to unknown functions make their timeout unresolved. Known
Vitest registrations and `vi.setConfig` consume options without mutating them.
Unresolved values, zero, negative and nonfinite timeouts fail. A configuration-wide over-limit default always fails; file/suite inheritance requires
an exact exception for every affected test. Multiple file `vi.setConfig` values are
checked conservatively for every test without an explicit/suite override; dynamic
runtime ordering is not inferred. Hooks and polling deadlines are separate APIs.

An exception supplies `file`, `test`, `scenario`, `observer`, `reason` and `maximum`.
`observer` names the required real process or clock. The rule checks metadata completeness and the numeric maximum. Independent review
must verify that the named scenario really needs the stated process or clock and
that a process-free observer cannot prove it. No production exceptions are granted
here. In particular, merely starting a Daemon is not a process-need justification.

Before any T3779c cut, #3828 still requires justified timeout exceptions and normal
lint activation, retained-clause mappings, and equivalent successful base/head CI
timings with setup and retries distinguished. Keep T3779b’s baseline and shrinking
enforcement (including Python), now enabled through normal lint. The earlier consumer/timing audit remains in
`../web-cost/`. This slice changes no product path or protected observer.

## Reuse

Installed Oxlint 1.86.0 provides the parser, lexical scopes, plugin seam, configuration
inheritance and diagnostics. The rule reuses `shared/scope.ts` for binding resolution
and `shared/array-method.ts` for syntax-wrapper removal;
there is no new parser or dependency. Installed Vitest 5.0.3 defines the timeout APIs;
its runtime setting terminates tests but does not reject unbounded source declarations.

- [Oxlint require-test-timeout](https://oxc.rs/docs/guide/usage/linter/rules/vitest/require-test-timeout):
  requires an explicit timeout, but has no finite maximum, static arithmetic policy or
  justified exact-test exceptions. It would also reject the permitted inherited default.
  Oxlint is maintained: [1.90.0, 2026-10-27](https://github.com/oxc-project/oxc/releases/tag/oxlint_v1.90.0).
- [eslint-plugin-testing-library rules](https://github.com/testing-library/eslint-plugin-testing-library#supported-rules):
  query and async-observation rules have no per-test timeout cap or exception policy.
  [7.16.2, 2026-03-24](https://github.com/testing-library/eslint-plugin-testing-library/releases/tag/v7.16.2)
  is release evidence. Adding it would not supply this missing capability.
- [Vitest test API](https://vitest.dev/api/test) and
  [testTimeout](https://vitest.dev/config/testtimeout): retained as the runtime mechanism.
  Source enforcement uses Oxlint's AST because runtime termination cannot enforce the
  named-test source exception boundary. These sources do not establish T3779b coverage.
