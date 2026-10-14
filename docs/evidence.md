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

## U346 executable observer

| Result | Regeneration |
| --- | --- |
| The retained observer's assertion is a hit test and real pointer deletion for Agent-owned/user-owned Pads and a Todo with a Terminal open, at 1280×800 and 700×800; it exits nonzero on a miss. No new pass is claimed here. N7 lifecycle tests live beside the observer in `apps/desktop/observers/U346/`. | On a disposable checkout of `3970aa87d180fdabb5d433cb7ab6bec3a39056d6`, run `cargo build -p rupd -p rup`, then `bash artifacts/ux/U346/observe.sh` from the repository root; it owns its fake Daemon, Vite and isolated headless browser. |

## U55 historical capture

| Result | Regeneration |
| --- | --- |
| On `9784d5439888c0fe847050943305b330b0c192a1`, U55 records a white notch about 7×15 px at x272–279/y70–85 in a selected empty Terminal. Its drawing element and cause were the requested diagnosis, not a result established by this migration. | Follow [U55](../scenarios/ui.md) on that disposable baseline after `pnpm install`: run `just harness <seed>`, select a Terminal with no output at 1280 px in an isolated headless browser, inspect the specified element/style facts and then feed one line of output; publish both screenshots when U55 is cited. |

Current observer sources and required inputs are classified in `loop/evidence-paths.json`; use `docs/evidence-relocation.md` for current regeneration paths. Historical checkout commands above refer to the files at those recorded revisions.
