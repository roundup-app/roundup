# U350 rendered observer

Headless agent-browser (session `u350`) on `just harness thread-report 5199`, the Workstream `workstream-1`, light scheme, with a 150-character reason. `prompt`, `pending`, `failure` (`NOT_ACKED`, installed through `window.__fake.app.handlers`) and `result` (`workstream.cleared` emitted) at 1280x800 and 700x800; `*.checks.json` is `window.__checks()` for each.

D1, D2, D5, D6 and D8 pass in every capture. D3 (and so D10) fails in `failure-*`: the `✕ <message>` line U350 asks for is red, and D3 allows red only beside an `error` or `needs-you` row. D3 is not among U350's Checks; it is a Check rule for `testing/checks.ts`, outside U350's Scope.

`result-*` shows no rule: the fake Daemon's `message.list` carries no second Iteration, so only the prompt closing is observed; the rule above old Messages is asserted by `u350_the_old_thread_stays_above_the_new_one` and `u350_a_long_reason_is_cut_to_one_line`.

The reason field is a one-row `textarea`: D6 and D7 skip a `textarea` (U353) but not an `input`, which failed D6 on its text cursor.
