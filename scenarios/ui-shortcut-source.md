# UI: namespace imports preserve shortcut source checks

Acceptance for #5728. This extends U5557b in `scenarios/ui-create-keys.md`; it does not deliver that implementation. Implementation follows #5557, which owns the production shortcut-source guard. The result is that changing a named import to a namespace import cannot make a copied display-string lookup pass CI.

## Checks on main

1. `scenarios/ui-create-keys.md`, heading U5557b: production chips and shortcut attributes read the registry by action identity; copied chord text, including display-string lookups, is prohibited. Its guard is planned acceptance, not evidence of an implemented guard.
2. `apps/desktop/copy/guard.mjs`, function `checkCopy`, and `apps/desktop/copy/guard.test.mjs`, tests `u471_copy_guard_accepts_resolved_reads_%s` and `u471_copy_guard_rejects_unused_and_duplicate_values_%s`: existing in-memory source-checking seam and diagnostic assertions. Babel owns parsing and lexical binding resolution.
3. `apps/desktop/package.json`, script `typecheck`, and `apps/desktop/copy/check.mjs`, top-level diagnostic/exit handling: the production desktop gate runs the checker after TypeScript and exits 1 for checker diagnostics.
4. `apps/desktop/src/keys/chords.ts`, constants `CHORDS` and `LEADER`: the existing registry rows distinguish action `name` from display `keys`. `scenarios/ui-shortcut-hints.md`, heading U2541d: press, sequence and alternative boundaries remain unchanged.

## Acceptance

**U5728a namespace lookups cannot select actions by copied key text.** Given a production module importing `* as registry` from the real `keys/chords.ts`, when it selects a row with `registry.CHORDS.find(row => row.keys === "⌘N")!`, then the shortcut-source guard reports that lookup as a violation, including when the result is passed to a production `KeyChip`. The same rejection holds for a renamed namespace binding and a local alias `const rows = registry.CHORDS; rows.find(row => row.keys === "⌘N")!`. Planned parameterised test: `u5728a_namespace_display_lookups_are_rejected` in `apps/desktop/copy/guard.test.mjs`, using `checkCopy` with production-path source fixtures and asserting the shortcut-source diagnostic identifies the offending file/lookup. The fixtures use the actual module path and export name; a generic syntax error or unrelated copy diagnostic does not prove rejection.

**U5728b namespace lookups can select actions by identity.** Given the same namespace import and direct/local-alias variants, when the lookup selects `row.name === "agent.new"` instead of comparing `row.keys`, then the shortcut-source guard returns no shortcut-source diagnostic for that lookup. Planned parameterised test: `u5728b_namespace_action_name_lookups_are_accepted` in `apps/desktop/copy/guard.test.mjs`, paired with U5728a at the same checker seam. Other copy rules remain in force; this is no whole-file or namespace exemption.

Policy: extend the existing shortcut-source analysis, using the installed Babel parser/traversal and lexical bindings; add no parser, registry, key renderer or parallel lint. Preserve U5557b's existing named-import, alias, destructuring, filtering and copied-array coverage when it lands. Track the imported module and binding rather than matching the spelling `registry`. No new public name, contract, RPC, App seam command, binding, Token or visible change is required. No rendered or native-Mac observer is needed for this static guard change.

## Implementation scope and verification

Policy: implementation is confined to `apps/desktop/copy/guard.mjs` and `apps/desktop/copy/guard.test.mjs`, with `apps/desktop/copy/check.mjs` only if the existing gate needs diagnostic integration. Do not change production callers to hide a failing fixture, expand the copy baseline, exempt namespace imports or modify loop machinery. Apply AGENTS.md rule 10 to any edited test file; preserve distinct U471 and U5557 proofs.

The implementation run verifies the production gate with a temporary, type-correct namespace lookup passed to `KeyChip` in an existing production caller, then removes it. Record the failing command, offending file/diagnostic and restored success on #5728; commit no probe. This is a manual gate observation (policy), not a new process-starting test duplicating the in-memory fixture proof.

| Command | Failure | Exit |
| --- | --- | --- |
| `pnpm --filter desktop exec vitest run copy/guard.test.mjs --config copy/vitest.config.mjs` | A namespace display-string lookup lacks its shortcut-source diagnostic. | 1 |
| Same command | An action-name lookup receives a shortcut-source diagnostic. | 1 |
| Same command | An existing copy or shortcut-source regression assertion fails. | 1 |
| `pnpm --filter desktop typecheck` with the temporary production probe | The copied display-string lookup is reported by the shortcut-source guard. This is the required negative result; TypeScript itself must accept the probe. | 1 |
| `pnpm --filter desktop typecheck` after removing the probe | TypeScript or the copy checker reports a remaining error. Required clean result: exit 0. | 1 |
