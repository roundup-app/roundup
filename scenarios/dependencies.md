# Dependencies

Module: `pnpm-lock.yaml`, `apps/desktop/package.json`, `package.json`. Ids: every `Z` heading in the file.

**Z1 patched lockfile.** Given `pnpm-lock.yaml` holds `solid-js` 1.9.15 and `seroval` 1.5.6 (`pnpm-lock.yaml:3251`, `pnpm-lock.yaml:3215`) and Issue #868 lists 15 open Dependabot alerts on it, when the lockfile is regenerated, then:
- *No critical or high alert.* Dependabot alerts #7, #8, #14 and #15 to #20 are closed on `main`: `solid-js` is 1.9.17 or later, so `seroval` is 1.6.3 or later; no `nanoid` or `lodash-es` version below its fix remains (policy: Security → Dependabot is the observer, since the alert list needs a token no run holds).
- *Medium and low cleared.* Alerts #4 and #9 to #13 (`katex`, `nanoid`, `lodash-es`, `fast-xml-parser`) are closed wherever a patched version exists; one with none stays open and Issue #868 names it (policy).
- *Upstream first.* `apps/desktop/package.json:25` raises `solid-js` to `^1.9.17`; a `pnpm.overrides` entry in `package.json` exists only for a package whose parent has no release taking the fix, each with a comment naming its alert (policy).
- *Nothing else moves.* `just check` and `just perf` pass; the PR body lists each alert it closes (policy, `.agents/data/pr.md`).
- *No advisory gate.* No workflow, recipe or rule fails a PR because an advisory exists (policy: the user decides it).
- *Out of scope.* Alerts #1 and #2 (`glib`, Rust through Tauri's GTK on Linux) stay open.

**Z2 diffs highlight with Pierre's highlighter.** Given `apps/desktop/package.json` holds `@pierre/diffs` `^1.5.2` and `apps/desktop/src/changes/DiffReader.tsx` registers the `roundup` CSS-variable theme (`registerCustomCSSVariableTheme("roundup", {})`), when `@pierre/diffs` is raised to 1.6.1 and the reader opens a changed file, then:
- *Pierre's highlighter.* `DiffReader.tsx` passes `preferredHighlighter: 'highlights'` to every `@pierre/diffs` diff it builds (test: `z2_diff_reader_prefers_highlights`, asserting the option on the options the reader hands the library).
- *Colours kept.* The `roundup` theme still colours tokens through its CSS variables under `highlights`; a highlighted line carries token colours from those variables, not from a fallback theme (test: `z2_highlights_uses_roundup_theme`). If `highlights` cannot use a CSS-variable theme, the PR says so on Issue #3322 and stops: no silent fallback to Shiki.
- *No Shiki the App no longer needs.* Any Shiki package `@pierre/diffs` makes optional and the App does not import is absent from `apps/desktop/package.json` and `pnpm-lock.yaml` (policy: the lockfile is the observer).
- *Faster, not heavier.* `just perf` shows no regression (R-ids, `scenarios/perf.md`); the PR records time to first highlighted line on the largest diff fixture, before and after, on Issue #3322 (policy).
- *Looks the same.* Dark-mode captures of the diff reader, `just capture U3016d` style, show the same token colours as on `main`, judged by the design critic (policy: layout and colour are the critic's, not a test's).
