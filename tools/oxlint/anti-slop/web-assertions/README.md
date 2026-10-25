# Assertion inventory preparation (T3779b)

This is an **opt-in audit**, not the repository assertion gate or an approved
baseline. It changes no product tests, timeout, retry, capture or execution
selection. T3779a/b enforcement and all T3779c cuts remain on #3828.

```text
pnpm lint --config tools/oxlint/anti-slop/web-assertions/audit.json
  → Oxlint AST + lexical bindings → assertion candidates
  → Babel parses browser-expression strings
python3 python-audit.py apps/desktop/src
  → Python AST → every Python assertion + assignment dependencies
  → source review → exact shrinking baseline (still pending)
```

Reproduce from a checkout with `pnpm install`:

```sh
node tools/oxlint/anti-slop/web-assertions/audit.mjs > /tmp/assertions.jsonl
node --test tools/oxlint/anti-slop/web-assertions/assertions.test.mjs
```

`inventory.jsonl` is generated output. Its header records the source revision,
source hash/dirty flag, tool hash, lint command/exit and analyzed-file count.
Each observation contains the exact assertion, containing suite/test, source
location, dependencies and a SHA-256 fingerprint of assertion and dependency
source. Locations are navigation aids, never exemption identities. Identical
assertions may have identical fingerprints; a future baseline must disambiguate
those registrations before granting any exemption. This inventory grants none.
App source is unchanged from the implementation base. No test modules execute.

`fixtures.jsonl` records each JS boundary fixture's input, exit code and separate
diagnostic through the real `pnpm lint --no-ignore --config <temporary-config>
--format json <fixture.test.tsx>` entry point. Reproduce it by setting
`ASSERTION_FIXTURE_REPORT` to a new file while running the fixture command.
All negative fixtures require this rule's diagnostic; a syntax error or ignored
file cannot pass. The Python fixture makes its launcher raise if executed and
checks the parsed assertions and their browser-script dependency instead.

## What the inventory establishes

The rule recognizes Vitest `expect` imports/aliases, namespace imports and globals;
style matchers; computed style, rectangles and dimensions flowing through local
bindings, arithmetic and browser callbacks; exact DOM-text matchers and text/role
queries used as existence assertions. Embedded strings are parsed as expressions
with the installed Babel parser; comments and quoted strings cannot masquerade as
reads. Action setup, focus checks, name presence and call/contract observations
are excluded by the fixtures. Python uses its built-in AST without importing any
launcher, and records **every** assertion for review, including mixed behavior and
appearance conditions. Its assignment closure conservatively includes same-named
bindings across scopes; it does not classify Python assertions as forbidden.

These are **candidates**, not verified offenders or savings. In particular:

- `copy-candidate` needs source review to distinguish App wording from user content.
  A literal user-content round trip is deliberately not automatically exempted.
- Object provenance is conservative: a geometry-bearing object may also carry
  independent behavioral fields. Inspect the asserted member before classifying.
- `unparsed-browser-script` preserves inputs that need manual review, including
  dynamic/non-expression scripts. It cannot be silently treated as compliant.
- Snapshots are marked for review. Imported helper return values, mutable writes,
  destructured field precision, dynamic queries, wrapper-created assertions and
  indirect browser script builders need further analysis before gate activation.
- This audit does not test shrinking/stale baseline entries or prevent Python
  additions. No allowlist is created; those acceptance boundaries remain open.

The counts cannot confirm the historical “275 lines in 87 files” claim: source
revision, syntax, candidate provenance and assertion-versus-line counting differ.
They establish reproducible source observations for the next review. Timing
claims, complete base/head CI measurements, setup and retries remain separate.
No cut is authorized until both lints enforce and a reviewed baseline lands.

## Reuse

Read `package.json`, `apps/desktop/package.json`, the installed
`@oxlint/plugins` SourceCode/visitorKeys/scope API and Vitest 5.0.3's timeout API.
Reuse Oxlint 1.86.0 for TS/TSX parsing, bindings and diagnostics; reuse desktop's
installed `@babel/parser` 7.29.9 and `@babel/types` 7.29.8 for embedded expressions
and visitor keys; reuse Python `ast` for Python. No parser or dependency is added.

- [Oxlint JS plugins](https://oxc.rs/docs/guide/usage/linter/js-plugins) and its
  [rule list](https://oxc.rs/docs/guide/usage/linter/rules.html): selected for the
  existing lint entry point and scope graph. The stock rules do not inventory
  appearance/copy assertion provenance or supply a shrinking baseline. Maintained:
  [1.89.0, 2026-10-19](https://github.com/oxc-project/oxc/releases/tag/oxlint_v1.89.0).
- [eslint-plugin-testing-library rules](https://github.com/testing-library/eslint-plugin-testing-library#supported-rules):
  evaluated and rejected for this boundary; query/async best-practice rules neither
  follow computed-style/browser results nor distinguish App-copy assertions and
  baseline entries. Maintained:
  [7.16.2, 2026-03-24](https://github.com/testing-library/eslint-plugin-testing-library/releases/tag/v7.16.2).
- [Babel parser](https://babeljs.io/docs/babel-parser): selected for embedded script
  parsing because Oxlint's AST treats those as string literals. Maintained:
  [8.0.9, 2026-10-23](https://github.com/babel/babel/releases/tag/v8.0.9).
  The installed 7.x versions are reused unchanged.
