# UI: jumping and the shell Drawer (U105 to U110; U105, U106, U109 and U110 retired by U467)

Module: `apps/desktop` (the webview); begins when the Door scenarios land. Ids: U105–U110.

Source: the user's $anchor rules on attention, navigation and ergonomics (2026-10-02/03). "Main" in those rules is a Door, and "main agent" is an _Avoid_ word. Webview only: no App command and nothing under `contracts/`; U108 is a spike. Every clause is read on the injected emulator, the fake App and the U26 harness, with a fake clock.

**U105 retired by U467.** The Thread's input is gone, so typing no longer dims the periphery.

**U106 retired by U467.** The Thread's feed and its `⌃O` fold are gone; `⌃O` goes to `terminal.write` from every pane as U12 says.

**U107 jump to an Agent.** _Retired in part by U2238 to U2241: `⌥1` to `⌥9` and `⌥0` are not taken; the `Take control` button and `⌘⏎` in the Rail stay._ Given an open Project, when the user presses `⌥1` to `⌥9`, then the n-th Agent row as the Rail shows it, top to bottom (a Door row counts and is selected without a Takeover; Groups are skipped; the Agents of a collapsed Group are not shown and so not counted), is selected, its Terminal takes keyboard focus and, unless it is a Door (always typed into, U467), `takeover.begin {agent}` is called (B6); `⌥0` calls `takeover.end {agent}` and returns focus to the selected Terminal; a jump to a second Agent ends the first Takeover before the next begins. The chords are read by key position, not by the character `⌥` produces, and the webview takes them wherever focus is, so this narrows U12: with focus in a pane these chords do not reach `terminal.write`. A number with no Agent does nothing. When `takeover.begin` answers `CONFLICT` (B6: the Agent is `done` or `error`) the selection still moves and U80's one failure line shows. After a Daemon restart the webview calls no `takeover.end` for a Takeover that B8 says no longer exists. Tests use the fake App, record the order of calls and name the U12 test that is narrowed. Typing `@` for the switcher belongs to U51's owners and is not here.

**U108 (spike) the shell as a Drawer that minimises to a chip.** Question: can `⌃\`` toggle a slide-out shell that, when minimised, stays alive as a chip like a Terminal bubble (U164) without a fixed split pane? Pass: a prototype on the fake App that shows toggle, minimise and reopen with its process alive and one `terminal.resize` per U13, plus a written answer on whether it needs a new App seam command. Fail: it needs a seam command, so the spike ends with a seam proposal for the committee. No Builder starts on this id.

**U109 retired by U467.** The Thread's input and its Attachments are gone; a pasted image reaches a Terminal as U418 says.

**U110 retired by U467.** The Thread's feed, input and Quote are gone.

Tests are named `u107_`; U108 has a pass condition and no test.
