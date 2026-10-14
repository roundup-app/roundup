# Evidence references

L112 changes evidence storage and publication only. Paths under `artifacts/`, `crates/rpc/r16/` and `crates/rupd/evidence/` in scenarios/docs are artifact-relative payload names, not committed-file links. Required observers keep every assertion and condition in their scenario. Their implementation PR links the downloadable artifact and result rows by [Capture publication](../.agents/data/captures.md). A specification-only PR requires no payload. After 14-day Actions expiry, result summaries remain and the recorded command regenerates evidence; an expired artifact is no longer claimed downloadable.

Historical statements remain observations at their named revisions. For a scenario id, use its Observer command at the stated revision, with `just capture <ids>` selecting only the cited ids. Native observers keep their scenario's Mac steps; executable observers/test inputs retiring with directories are relocated by #1651, while #1613 owns QA publication. These links describe no new observation.

## J14 first journey audit

| Revision | Result | Regeneration |
| --- | --- | --- |
| `b5b51f346486ecd59bbb58ab21c325eaf78467b6` | Four isolated headless passes cover all five journey stages at 1280×800 and 1440×800; all 68 screens pass D1–D14 and D16. The Daemon is real, `claude` is fake, and the chooser returns the configured isolated Project. | On a disposable checkout of this revision after `pnpm install`, run `python3 artifacts/ux/journey/J14/reproduce.py`; it installs the recorded temporary driver, runs `just capture J14` and restores the test/package files. The [journey instructions](../.agents/data/journey.md) name the stages and conditions. |

Historical payload partition: `artifacts/ux/journey/J14/`. This summary retains the result previously cited from its README. It claims no native chooser, native App or real `claude` observation. The user reports what they meet on the Mac.

## U451 native window observer

| Revision | Result | Regeneration |
| --- | --- | --- |
| `88a658e24029121600ed888f9c0f65ceec686937` | Native traffic-light placement, Window menu/Mission Control titles, drag and zoom were unobserved. Chromium reserved-geometry evidence does not decide them. | Follow [U451's native observer](../scenarios/ui-window-bar.md) with `pnpm install` and `just app <disposable-project-path>` on a Mac. Record each operation's pass/fail. |

Historical payload partition: `artifacts/ux/U451/head/`. The result stays unobserved until those steps run. Linux/Chromium implementation acceptance and independent gates remain as U451 specifies.
