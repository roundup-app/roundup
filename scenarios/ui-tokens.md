# Semantic Tokens

Module: `apps/desktop`. Acceptance for the semantic Token migration; implementation follows this specification and the system UI font implementation in #1630. Solid, vanilla CSS, existing button kinds and Terminal metrics remain unchanged. This specification adds no implementation or rendered evidence.

**U478 semantic roles replace literal policing.** Given the App's existing light, dark and increased-contrast appearances, when the Token migration is implemented, then the following clauses hold.

## Token tiers

1. Primitive colour Tokens use a pinned Radix Colors scale with light and dark values, including alpha values where compositing is required. Semantic Tokens reference primitives rather than colour literals. The public roles include `--surface`, `--surface-raised`, `--text`, `--text-muted`, `--border`, `--accent`, `--danger` and `--focus-ring`. Additional roles preserve sunken, hover, selected, pressed, disabled, warning and scoped header/tab appearances; eight roles must not collapse distinct existing states. `u478_semantic_roles_resolve_in_each_scheme` resolves the actual imported CSS in a browser for light, dark and each scheme with increased contrast, asserting every required role resolves and no reference cycle or missing primitive occurs. It also checks the semantic declarations reference the selected primitives. These are proposed implementation tests, not evidence on main.
2. Every existing Token name remains usable. Existing names that differ from the semantic names become aliases of semantic roles; names already semantic keep their meaning. Preserve root, header, tab and fixed-descendant scopes, including hover, selection and press overrides. Alias direction is legacy → semantic → primitive, never semantic → legacy. `u478_legacy_aliases_preserve_scopes` reads baseline names and exercises their computed resolution in those scopes and states under all four media combinations. It asserts alias direction as well as resolved values. Non-colour Tokens retain their type, space, radius, shadow, duration and metric meanings. U476's UI/monospace separation and Terminal cell metrics retain their existing tests (regression).
3. Components continue using their existing names in this migration; each UI lane owns its directory's later semantic-name conversion, and the UI epic's closeout deletes the aliases (policy). No component CSS rule, inline style or component implementation changes here. Scoped Token assignments already in `tokens.css` remain owned here (policy).

## Static enforcement

4. Stylelint with `stylelint-declaration-strict-value` is mandatory in the existing `just check` path, including `just check origin/main`; new matching stylesheet files are discovered without a tracked-file allowlist. The gate rejects raw colour, font family/size, margin/padding/gap, radius and shadow values in App-authored CSS outside `tokens.css`. It covers shorthands and longhands, including background/border colours, logical spacing and row/column gaps. Token-backed expressions are allowed; a function containing a raw governed value is not an escape. `tokens.css` is the value-definition boundary; vendor CSS is outside App ownership (policy).
5. `u478_raw_values_fail_the_check_gate` creates and cleans up an otherwise unused probe stylesheet under `apps/desktop/src` and invokes the real check path. It reports one row per case with command, diagnostic and actual exit code. Run each failing declaration separately so one failure cannot conceal another:

   | Probe declaration | Required result |
   |---|---|
   | `color: #fff` | nonzero, strict-value diagnostic naming the probe |
   | `background-color: rgb(255 255 255)` | nonzero, strict-value diagnostic |
   | `border: 1px solid #fff` | nonzero, strict-value diagnostic for the colour |
   | `font-family: Arial` | nonzero, strict-value diagnostic |
   | `font-size: 13px` | nonzero, strict-value diagnostic |
   | `padding: 7px` | nonzero, strict-value diagnostic |
   | `margin-inline-start: 7px` | nonzero, strict-value diagnostic |
   | `gap: 7px` and, separately, `row-gap: 7px` | one nonzero row per declaration, strict-value diagnostic |
   | `border-radius: 7px` | nonzero, strict-value diagnostic |
   | `box-shadow: 0 1px 2px #000` | nonzero, strict-value diagnostic |
   | `color: var(--text); padding: 0 var(--space-1); border-radius: var(--radius-control); box-shadow: var(--shadow-drawer)` | 0 |
   | probe removed, unmodified App | 0 |

   A missing tool, syntax error or unrelated failing check does not prove rejection (policy). The implementation records a finite property-specific allowance list for CSS structural keywords and zero; arbitrary numbers, arbitrary functions, warning-only severity, blanket disables and ignored App directories do not satisfy this clause (policy). Layout dimensions such as width are not spacing values for this clause. Duration literal enforcement already required by U130 is preserved (regression). Existing violations outside this Issue's ownership require a scoped prerequisite repair, not weaker enforcement or component edits here (policy).

## Test retirement and reference

6. Tests whose sole assertion is that a style uses or equals a Token are removed after static enforcement covers that assertion. Mixed tests lose only those assertions. Keep assertions of rendered contrast, layout/overflow, hit areas, focus visibility, media behavior, scoped inheritance, interaction states, UI/Terminal font separation and Terminal metrics: a linter cannot prove those results. In particular, the browser observers in `apps/desktop/src/header/u441_tokens.test.ts` are classified by assertion, not deleted by filename (policy). The implementation PR maps each cut to its scenario clause and surviving asserting test or exact lint probe; a retired clause is explicitly identified. Any edited test file also applies AGENTS.md rule 10 to its remaining tests (policy).
7. The implementation PR reports immutable base/head SHAs, the counting command, test files deleted, test files changed, test lines deleted and net test-line change. Count tracked test sources from the diff; separate whole-file removals from lines removed in edited files and report additions so replacement tests cannot be hidden. Do not claim all 89 files or 676 lines are removable without classification (policy). All retained behavioral tests pass through `just check origin/main` (observer).
8. A one-page reference under `docs/` is generated from `tokens.css`, identifying each semantic role's purpose, light/dark primitive mapping, increased-contrast overrides and the legacy alias mapping; include non-colour Token groups and the regeneration command. Generation is deterministic, and a freshness check in the check path fails on a changed Token absent from the reference. `u478_reference_tracks_tokens` changes a Token in an isolated fixture, proves stale output fails with nonzero status, regenerates twice, and asserts identical current output and exit 0. No second manually maintained value table is authoritative (policy).

## Rendered regression observer

9. `u478_rendered_token_regression` compares baseline and head using the same Linux Chromium version, isolated headless profile, seed, viewport and media settings. Capture `first-run`, `agents-10`, `tree-40`, `tabs-8` and `conflict` at 1512×950 in dark; also run `agents-10` with increased contrast in dark. Include selected/hovered/pressed tabs, a focused control, an open Drawer, and a visible injected call failure on dense `tree-40`. The failure retains its text and next action. Check readings and paired screenshots are PR artifacts, never tracked additions. No passing Check on the baseline may fail on the head. The observer asserts the failure text and state, runs the real Checks, and records image differences; it does not merely assert screenshot files exist.
10. No visible change is accepted except a correction to a raw value that violated an existing Check. For each difference the implementation names the old declaration, failing Check and before/after readings; adopting a stock palette is not an exception. Choose/customize the Radix scale and semantic mappings to meet this regression, preserving scoped surfaces (policy). D2, D5 and D6 must hold. These are the existing checks, cited by number and holder on main:

   | Check | Holder on main |
   |---|---|
   | 2 | `docs/design-system.md`, “The checks”, D2; type steps and spacing |
   | 5 | `docs/design-system.md`, “The checks”, D5; text/Glyph/focus contrast |
   | 6 | `docs/design-system.md`, “The checks”, D6; target states and hit area |

The first journey keeps Enter, Understand, Intervene and Review surfaces legible and their failure actions visible; this migration adds no journey behavior or native App claim (policy). The rendered observer proves the webview; users report what they meet on the Mac.

## Ownership and reuse

Implementation owns `tokens.css`, stylelint configuration rules, Token-only assertions across test directories, the generated reference and its generation/freshness observer. It changes no component CSS rules and no loop machinery (policy). Shared dependency/check wiring is a prerequisite if not supplied by its existing owner; do not silently expand this Issue into the UI foundation's manifest ownership (policy). The implementation remains a separate work Issue blocked by this specification and #1630; add it as a native blocker of #1652, the UI lanes and epic closeout that require Token implementation (policy).

Reuse research: [Radix Colors usage](https://www.radix-ui.com/colors/docs/overview/usage) supplies CSS scales and [custom palettes](https://www.radix-ui.com/colors/custom) support matching the existing appearance; [Radix source/maintenance](https://github.com/radix-ui/colors) is the selected primitive source. [Stylelint](https://github.com/stylelint/stylelint/releases) plus [stylelint-declaration-strict-value](https://github.com/AndyOGo/stylelint-declaration-strict-value) is selected for property-value enforcement; the plugin documents longhands, shorthand expansion, function handling and property-specific allowances, with its [release history](https://github.com/AndyOGo/stylelint-declaration-strict-value/releases) providing version evidence. [stylelint-csstree-validator](https://github.com/csstree/stylelint-validator) was considered as an alternative: its maintained CSS grammar validation accepts valid literal colours and lengths, so it cannot enforce Token references. Core Stylelint's [custom-property-pattern](https://stylelint.io/user-guide/rules/custom-property-pattern/) validates declaration names, not literal-value use, and cannot replace the selected plugin. No custom CSS parser or literal scanner is authorized; the implementation verifies compatible pinned releases and records current maintenance evidence before installing (policy).
