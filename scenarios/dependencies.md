# Dependencies

Module: `pnpm-lock.yaml`, `apps/desktop/package.json`, `package.json`. Ids: every `Z` heading in the file.

**Z1 patched lockfile.** Given `pnpm-lock.yaml` holds `solid-js` 1.9.15 and `seroval` 1.5.6 (`pnpm-lock.yaml:3251`, `pnpm-lock.yaml:3215`) and Issue #868 lists 15 open Dependabot alerts on it, when the lockfile is regenerated, then:
- *No critical or high alert.* Dependabot alerts #7, #8, #14 and #15 to #20 are closed on `main`: `solid-js` is 1.9.17 or later, so `seroval` is 1.6.3 or later; no `nanoid` or `lodash-es` version below its fix remains (policy: Security → Dependabot is the observer, since the alert list needs a token no run holds).
- *Medium and low cleared.* Alerts #4 and #9 to #13 (`katex`, `nanoid`, `lodash-es`, `fast-xml-parser`) are closed wherever a patched version exists; one with none stays open and Issue #868 names it (policy).
- *Upstream first.* `apps/desktop/package.json:25` raises `solid-js` to `^1.9.17`; a `pnpm.overrides` entry in `package.json` exists only for a package whose parent has no release taking the fix, each with a comment naming its alert (policy).
- *Nothing else moves.* `just check` and `just perf` pass; the PR body lists each alert it closes (policy, `.agents/data/pr.md`).
- *No advisory gate.* No workflow, recipe or rule fails a PR because an advisory exists (policy: the user decides it).
- *Out of scope.* Alerts #1 and #2 (`glib`, Rust through Tauri's GTK on Linux) stay open.
