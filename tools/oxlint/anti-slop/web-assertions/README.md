# Web assertion gate (T3779b)

Normal `pnpm lint` enforces the assertion rule in `.oxlintrc.json`, checks the
baseline against the merge base with `origin/main`, and statically checks Python.
Its no-argument invocation also runs `assertions.test.mjs` and the timeout
boundary suite, so `just lint-web` and CI reach both sets of fixtures. A targeted invocation forwards its arguments to
Oxlint and still checks the baseline and Python; it does not recursively run the
fixture suite.

```text
pnpm lint
  → actual-command fixtures (isolated source / baseline repositories)
  → Oxlint: new assertion or stale per-file entry → exit 1
  → baseline: invalid / duplicate / added / broadened / missing file → exit 1
  → Python AST + Babel browser expressions: new / stale assertion → exit 1
```

`baseline.jsonl` is the initial exact baseline: one file, containing test (or
named helper) and SHA-256 assertion identity per row. `baseline-source.json`
records the source revision/hash, tool hash, versions and scan command. App source
is unchanged from the merged `origin/main`; no product test is cut here. Initial
baseline creation requires independent review before any T3779c cut. Once it is
on main, the lint rejects any head entry absent from its merge base's baseline.
There is no command that updates or expands the baseline during lint.

An identity pins exact assertion source, dependency source, enclosing registration
or helper source, and its AST path. Identical assertions are distinct, without a
line-number or count exemption. A test's numeric or `timeout:` argument is left out of the pinned registration source, so a timeout repair keeps its legacy entries. Any other edit to an enclosing registration invalidates
its legacy exceptions: remove its forbidden assertions and their entries rather
than re-keying them. Deleting a file, test or assertion requires removing its
entries. Adding a second identical assertion cannot reuse the original's entry.

## Reproduce and review

```sh
pnpm install
pnpm lint
node tools/oxlint/anti-slop/web-assertions/audit.mjs > /tmp/assertions.jsonl
```

The audit executes no test modules or browser launchers. Its rows retain exact
assertion text, dependencies and navigation locations for source review; locations
grant no permission. Python observations marked `python-behavior` need no baseline
entry. All other audit rows project to the initial baseline's three keys.
`fixtures.jsonl` records each input's separate diagnostic and exit code. Recreate
it with `ASSERTION_FIXTURE_REPORT=/tmp/new-fixtures.jsonl node --test
 tools/oxlint/anti-slop/web-assertions/assertions.test.mjs` (use a new output file).

The rule follows local bindings, mutable assignments, derived expressions,
function return values and browser callbacks/strings. Appearance reads used only
for actions do not contaminate a helper's independent return value. Literal DOM
copy comparisons, complete-copy regexes, text/role queries used as copy-presence
proof, style matchers and snapshots need an exact baseline entry. Role queries
used to locate actions, focus outcomes, nonempty names, call/contract assertions
and round trips comparing with user-input variables remain behavior observations.
Legacy literal DOM comparisons are pinned conservatively, including literals
whose authorship cannot be inferred from syntax; they grant no future exception.

Python uses built-in `ast`, never imports the launcher, and passes browser script
strings to the same Babel classifier as TypeScript. Existing mixed appearance /
behavior assertions are pinned individually; new Python assertions on style,
geometry or literal DOM copy fail. Independent numeric and user-input round trips
pass. Dynamic browser fragments that cannot be parsed and contain browser code
fail for review instead of silently passing.

T3779a's timeout exception review/normal activation and the directory-sized
T3779c cuts remain on #3828. No timing savings, copy-specific scenario retirement,
product behavior or completion of those groups is claimed by this prerequisite.
Protected observers, capture selection and retries are untouched.

## Reuse

Inspected root/desktop dependencies, installed Oxlint 1.86.0's
SourceCode/visitorKeys/scope API and Vitest 5.0.3's timeout API first. No dependency
or parser is added. Node's process/filesystem APIs and Git supply process exits,
exact manifest reads and the merge-base comparison.

- Selected [Oxlint JS plugins](https://oxc.rs/docs/guide/usage/linter/js-plugins)
  for the existing parser, bindings and diagnostics. Its
  [stock rules](https://oxc.rs/docs/guide/usage/linter/rules.html) lack assertion
  provenance and a shrinking exact baseline. Maintenance:
  [1.89.0, October 19](https://github.com/oxc-project/oxc/releases/tag/oxlint_v1.89.0).
- Considered [eslint-plugin-testing-library](https://github.com/testing-library/eslint-plugin-testing-library#supported-rules).
  Its query/async rules lack style/browser-result provenance and a shrinking
  baseline; adding it would not supply this gate. Maintenance:
  [7.16.2, March 24](https://github.com/testing-library/eslint-plugin-testing-library/releases/tag/v7.16.2).
- Selected installed [Babel parser](https://babeljs.io/docs/babel-parser) 7.29.9
  and types 7.29.8 for expressions Oxlint sees only as strings. Maintenance:
  [8.0.9, October 23](https://github.com/babel/babel/releases/tag/v8.0.9).
  Python reuses its built-in AST.

## Timeout re-key

`rekey.jsonl` maps 59 baseline entries from the identity that included the timeout argument to the current one. The normalized keys are now on `main`. This file is historical evidence only: lint never reads it or accepts a key absent from the merge base's baseline. Editing or adding migration rows cannot authorize another assertion.
