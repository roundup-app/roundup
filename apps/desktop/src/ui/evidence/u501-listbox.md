# U501 shared answer Listbox

Source: `faa8743e2f9b0313d7d03983e7ee71dc8530ff7b`; main baseline: `32198b7297869ddc237030cf14b754fb8084206f`. Scope is `ui/`; #2004 owns lane adoption. No lane, App, contracts, Tokens, package or loop file changes. The final branch includes main’s test-only #2163 merge (`5882ad851`); its UI and Rust release inputs match this captured/measured baseline.

```text
controlled answer/highlight → Ark collection + Root → supplied options
                                       └──────────→ virtual own-answer stop → null
associated note arrows → Ark getInputProps → same navigation
note Enter → caller (blocked while pending)
```

Installed `@ark-ui/solid` 5.39.3 and Zag Listbox 1.45.0 are mounted without mocks. The shared wrapper uses `createListCollection`, controlled `value`/`highlightedValue`, `loopFocus`, `selectOnHighlight`, `Root` callbacks, `Label`, `Content`, `Item`, `ItemText` and `getInputProps`. Ark traverses an unrendered own-answer collection entry; the interface maps it to null. Every visible option is supplied by the caller. Empty active-descendant references at null avoid a dangling ARIA target; an empty question's note has no dangling controls reference. There is no traversal calculation or keyboard state machine in the wrapper.

| Acceptance | Observer |
| --- | --- |
| First-answer default; all supplied answers and null; wrap both ways; unchanged note | `u501_arrows_visit_supplied_answers_and_null_in_both_directions`, `u501_own_answer_callbacks_report_null_to_the_owner`; `u501_browser_navigation_keeps_note_focus_and_text` exercises both list and note |
| Controlled selection and highlight; names, descriptions, disabled items | `u501_owner_controls_selection_and_highlight_independently`, `u501_names_and_descriptions_come_from_the_caller`, `u501_disabled_answer_is_named_but_skipped_by_ark` |
| Pending/disabled retain text and focus; repeated Enter blocked; recovery | `u501_disabled_blocks_answer_changes_and_preserves_the_note`, `u501_pending_blocks_answer_changes_and_preserves_the_note`, `u501_browser_pending_keeps_note_focus_and_blocks_repeat_enter` |
| Caller recommendation metadata keeps the supplied name/description | `u501_supplied_metadata_keeps_the_option_name_and_description` |
| Pointer selects without submitting; note Enter stays with caller | `u501_browser_pointer_never_submits_and_enter_stays_with_note_owner` |
| No supplied answers; teardown removes DOM, timers and callbacks | `u501_empty_answers_keep_an_own_answer_input`, `u501_disposal_removes_navigation_and_callbacks` |
| Paired rendered Checks | `u501_rendered_checks`: light/dark, 1280×800/1440×800, normal/increased contrast, initial/hover/focus/null/pending plus tree-40 multiline failure |
| Existing Decision policy and Markdown bytes | Existing `decisions/` suite, including all `u406_` and `q2_decision_preview` |

The browser driver uses a dedicated agent-browser session and fresh profile. Increased contrast uses `AGENT_BROWSER_ARGS='--force-high-contrast,--disable-features=ForcedColors'` from `docs/u478-contrast-observer.md`; each test asserts the native media query. The baseline worktree receives only this observer fixture, which imports main's existing `AskAnswers`; its production source and styles stay on main. Captures remain untracked. [Review evidence bundle](https://github.com/saadshahd/roundup/releases/tag/pr-2166-evidence) retains the paired captures and observer logs.

Reproduce from the implementation checkout after `pnpm install` in it and a detached main worktree:

```sh
git worktree add --detach /tmp/u501-main 32198b7297869ddc237030cf14b754fb8084206f
(cd /tmp/u501-main && pnpm install)
ROUNDUP_CAPTURES=U501 U500_BASE_ROOT=/tmp/u501-main/apps/desktop \
  pnpm --filter desktop exec vitest run src/ui/u501_browser.test.ts
ROUNDUP_CAPTURES=U501 U500_BASE_ROOT=/tmp/u501-main/apps/desktop \
  PROVIDERS_CONTRAST=more \
  AGENT_BROWSER_ARGS='--force-high-contrast,--disable-features=ForcedColors' \
  pnpm --filter desktop exec vitest run src/ui/u501_browser.test.ts -t rendered_checks
```

`artifacts/ux/U501/{base,head}/` holds paired PNG/Check JSON. The tree-40 observer verifies the visible first error line and the full unchanged multiline title, preserving the existing error renderer. Opening and replacing the fixture never moves keyboard focus. Preview rendering and submission/retry remain caller policy; the existing Decision implementation is unchanged.

## Reuse

Selected [Ark Listbox](https://ark-ui.com/docs/components/listbox) and its [collection interface](https://ark-ui.com/docs/collections/list-collection), already installed. [npm release metadata](https://registry.npmjs.org/@ark-ui%2fsolid) dates 5.39.3 to 2026-10-05T23:09:32.521Z. Real mounts and browser tests above verify its installed capabilities. The virtual collection entry adapts Ark's supported collection interface and callbacks; it adds no visible answer.

Considered [Kobalte Select/Listbox](https://kobalte.dev/docs/core/components/select/) and [Combobox](https://kobalte.dev/docs/core/components/combobox/), maintained in [0.13.14, 2026-09-07](https://github.com/kobaltedev/kobalte/releases/tag/%40kobalte/core%400.13.14). Rejected because they do not wrap the installed Ark Listbox required by U501/#2165; introducing their separate selection engine would violate that required shared interface. Browser observation reuses the existing `tabsBrowser` driver and agent-browser; no browser driver or package is added.

## Matched rule 7 observations

Both `just perf` invocations use the same Ubuntu 24.04 x86_64 AMD EPYC 7763 host, four available CPUs/online set/affinity `0-3`, rustc 1.99.0, release profile, login-shell workload and unchanged `crates/perf/budgets.json`. Both revisions' `crates` tree is `d97fac193b413c6e3644b460c5b4b2ba9f2bf9c4`. The same release binaries are reused because the Rust and build inputs are identical. Full host, hashes, loads, per-run samples, limits and skips are retained with the evidence.

| Metric | Main | Head | Gate |
| --- | ---: | ---: | --- |
| Cold plugin materialization | 11.750 ms | 11.691 ms | Pass absolute and regression limits |
| Cold start | 13.609 ms | 13.658 ms | Both below 300 ms |
| Hook loop | 288.366 ms | 289.873 ms | Both below 2000 ms |
| Ping p95 | 0.133 ms | 0.125 ms | Both miss shipped 0.029 ms regression ceiling |
| Rail-10 p95 | 0.250 ms | 0.244 ms | Both below 2 ms |
| Rail-40 p95 | 0.556 ms | 0.566 ms | Both miss shipped 0.293 ms regression ceiling |
| Ten idle Agents extra RSS | 2.598 MB | 2.625 MB | Both below 150 MB; both miss shipped 1.810 MB regression ceiling |
| Terminal write p95 | 0.495 ms | 0.469 ms | Both miss shipped 0.062 ms regression ceiling |
| Write-to-output p95 | 0.607 ms | 0.579 ms | Both below 16 ms; both miss shipped 0.074 ms regression ceiling |

Each lower-load command exits 1 on the same five shipped regression baselines. No comparison is skipped: median load is 0.653 per CPU on main and 0.865 on head. Every absolute limit passes on both revisions. All matched head/main medians stay within 10%; the largest positive difference is Rail-40 at 1.81%. These observations do not claim a clean perf pass or establish native App latency. Earlier busy observations and their load skips remain in the bundle. No limits, baselines or machinery change and #1990 is not revived. No native keystroke result is claimed or requested.

## Repairs demonstrated during the run

| Before | After | Evidence |
| --- | --- | --- |
| A native disabled note can lose focus; caller Enter can run while pending | Explicitly keep native disabled false, use readOnly and block pending key callbacks | Pending tests went red with `submitted`, then green; real browser retains focus and retries once |
| New note lacked the required click-target states | Token hover/press/focus behavior, disabled colour/cursor and no disabled hover/press | Rendered D2/D5/D6 and baseline comparison |
| Dense observer expected the second error line in visible text | Assert main's first-line renderer and full multiline title | Paired tree-40 failure captures |

