# UI: one fixed centre header

Acceptance for #4315, retired by #4454 (`scenarios/remove-time-timeline.md`) except U4355 below. The centre has no navigation row. Terms: Agent, Workstream (`GLOSSARY.md`).

**U4315a retired.** The centre navigation row is removed by #4454 (`scenarios/remove-time-timeline.md`, U4454a); a requested screen closes through its own Close action.

**U4315b retired.** Back to Ask, Time and Timeline are removed by #4454 (U4454a); Ask stays reachable through the Rail's Project root button.

## Import in progress

Acceptance for #4355. Journey stages: Understand and Review. This adds a pending-commit exception to U4315b; it changes no import discovery, authority or outcome contract.

**U4355 Close keeps a pending import on screen.** Given an open Project with an Agent selected, Import Claude Code opened through the Project menu, a chosen period and selected eligible sources, when the user confirms Import and `project.importCommit` has not settled, then activating the Import page's own Close action, by pointer or Escape, leaves the Import region mounted with its pending state available; the selected Rail identity, original Project, period and submitted source identities/revisions remain unchanged. Exactly one commit is sent, with no cancellation, retry or deferred close. Assert in `u4355_close_keeps_pending_import` in `apps/desktop/src/terminal/u4315_header.test.tsx`, using the mounted App and a controlled commit promise through the existing fake App RPC seam. Assert region identity, selected identity, exact choices and captured call count; do not test a standalone handler or layout.

In the same test, settle the commit in separate success and all-sources-refused cases. On success, the existing U2875d navigation opens the created work once, without another commit. With all sources refused with a retryable failure, the Import region keeps the failed selections and recovery action and pending ends. Close now closes the page without another commit; reopening retains the failed choices against the original Project and restoration imports nothing. The attempted close while pending never runs later on its own.

Policy — boundary and regression: pending means confirmation/commit, not discovery or the listing Agent's lifetime. Back before confirmation, including during discovery, retains U4315b's return behavior and U3815/U3037d's recoverable draft and stale-response rules; retain `u4315a_requested_screens_share_navigation` and the existing U3037d deadline/late-result probes (check 7). Escape retains the Import panel's pending guard (check 6). Closing Project Settings while an import is pending elsewhere still follows U3817; this exception applies only while the Import page itself is displayed. No new RPC, App seam command, domain term, library machinery or Token is required.

Policy — gates and observers: P11's Gate asks whether navigation loses or retargets choices or submits them without confirmation; U4355's exact-choice, Project and call-count assertions observe this path. P3's Gate asks whether routine progress creates attention; preserve existing import progress without a new attention entry or prompt. This is an Understand/Review navigation repair, not evidence of completing the full journey.

Policy — rendered observer for implementation: use `emil-design-eng` and the existing shared control and Tokens. In isolated headless Chromium with a dedicated session and fresh profile, at 1512×950 in dark mode, open Import from `tree-40` with long titles and ten candidates. Capture confirmation pending with disabled Back, then settled success and retryable failure with complete failure text visible on the densest seed. Run `just capture U4355`; leave baseline/head PNG images, interaction video and Check readings under `artifacts/ux/U4355/` as `.agents/data/harness.md`, heading “Captures”, requires. The critic judges D2, D5 and D6 (check 5) and no regression in any Check passing on main. This specification-only PR needs no capture and makes no native Mac claim; the user reports what they meet on the Mac.

Checks on main:

1. `apps/desktop/src/importer/ImportPanel.tsx`, `ImportPanel` (`dismiss`): Close is ignored while the commit is pending.
2. `apps/desktop/src/terminal/u4315_header.test.tsx`, `u4355_close_keeps_pending_import`: the test that holds U4355.
