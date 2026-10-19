DV5 at 1512×950, Linux headless Chromium, real temporary Project and real Daemon. Makers use the deterministic fake vendor; discovery and opening request no Agent turns. Native opening is observed at the existing App seam, not on macOS.

| Observer | Evidence |
| --- | --- |
| Main baseline `589a137e6` | `base/overview.png`, `base/overview.checks.json` |
| Reopened catalogue: ten stopped makers, repeated titles, long Unicode title, all target kinds | `overview.png`, `overview.checks.json` |
| Published Pad revoked after opening: cause visible, catalogue retained | `failure.png`, `failure.checks.json`, `failure-dark.png`, `failure-dark.checks.json` |
| Home filter preserves the Terminal pane | `home.png`, `home.checks.json` |

Every measured Check passes on all five screens, including D2/D5/D6. Native look and feel remains user-reported on the Mac.

```text
selected Project/id → deliverable.resolve → existing openTarget
                       unavailable        → cause on the selected row
```

Behavior: `dv5_real_daemon.test.tsx` checks retained file/Pad bytes, exact external URLs, Home/maker filtering, opener refusals, removal/revocation of cached targets, unsafe schemes, interrupted listing and reopen. `dv5_rendered.test.ts` checks keyboard/pointer activation and the dense seed through an isolated agent-browser profile.

Reproduce from `apps/desktop`:

```sh
ROUNDUP_CAPTURES=DV5 pnpm exec vitest run src/ask/dv5_rendered.test.ts
```

For a baseline, also set `ROUNDUP_BASELINE_ROOT` to a main checkout's `apps/desktop` directory with dependencies installed.
