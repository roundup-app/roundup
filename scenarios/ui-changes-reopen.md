# UI: opening and closing the Changes view repeatedly never hangs the page (U7924a)

Module: `apps/desktop/src/changes/` (the Flows lens, its call tree and call paths) and its test harness. Ids: U7924a. Work order: [#7924](https://github.com/roundup-app/roundup/issues/7924). While building the Flows lens (U7683, #7858) the U7683 lane found that in one page, opening the Changes view over the Tree target 4 to 5 times with the Flows lens's call paths active left headless Chrome unresponsive (DevTools port silent, CPU 0%); it hung with `agent.callPaths` unhandled too, and not on `main` before #7858. Whether the real App hangs or only the harness does is not yet known. No Daemon method, Message or contract change, and no change to the Flows lens's design.

**U7924a the Changes view opens and closes any number of times in one page and the page keeps answering.** Given one page of the isolated Chromium harness (U26) with an Agent that has a Worktree and the flow fixture (U7683), then:
- **Reopen.** Opening the Changes view over the Tree target and closing it again, 10 times in the same page, with the Flows lens active and its call paths ready, and again 10 times with `agent.callPaths` unanswered, leaves the page responsive after each open: a script round trip to the page returns within 2 s, and the view paints its lens list. A later open that hangs fails the test at that open's number. Asserted in `u7924a_the_changes_view_reopens_ten_times_in_one_page_and_the_page_keeps_answering`.
- **Cause.** The fix sits where the cause is. A cause in App code under `changes/` is fixed there. A cause in the test harness is fixed in the harness, and the PR names the proof that the App itself does not hang: the same 10 opens driven through the App's own path with no harness hook. Policy; the PR body states which it was.
- **No hiding.** No retry, timeout, per-state browser session or cap on opens stands in for the fix: the 10 opens run in one page and one session. Policy, judged in review.

Not wanted: a retry or timeout that hides a hang; a change to the Flows lens's design (U7683a to U7683h).

Checks on main (numbered references, not claims that this specification implements them):

1. `scenarios/ui-changes-flows.md`, U7683h: the capture that opens one browser session per state today.
2. `scenarios/ui-changes-lenses.md`, U7679a to U7679c: the switch and the Overview.
3. `apps/desktop/src/changes/u7683_flows.test.tsx`: the Flows lens's tests.
