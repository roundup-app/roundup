# U195 rendered observer

Headless agent-browser on `just harness` (`tree-40`): select the `payments…` Workstream, emit a pending `message.sent` from `you` to its Door. The Thread shows one `[data-now]` line per working or failing Agent (Door first) and the Message reads `queued`. `queued-*.png` are the captures at 1280×800 and 700×800; `*.checks.json` are the `window.__checks()` readings (D1 to D10 pass at both).

The delivered and `taken up` words are asserted against the real `rupd` by `u195_queued_messages_and_the_door_line_follow_the_door_going_idle` and in jsdom by `u195_a_queued_message_then_delivered_reads_taken_up_then_nothing`.
