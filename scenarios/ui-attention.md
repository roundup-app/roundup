# UI: jumping and the shell Drawer (U105 to U110; U105, U106, U109 and U110 retired by U467)

Module: `apps/desktop` (the webview); begins when the Door scenarios land. Ids: U105–U110.

Source: the user's $anchor rules on attention, navigation and ergonomics (2026-10-02/03). "Main" in those rules is a Door, and "main agent" is an _Avoid_ word. Webview only: no App command and nothing under `contracts/`; U108 is a spike. Every clause is read on the injected emulator, the fake App and the U26 harness, with a fake clock.

**U105 retired by U467.** The Thread's input is gone, so typing no longer dims the periphery.

**U106 retired by U467.** The Thread's feed and its `⌃O` fold are gone; `⌃O` goes to `terminal.write` from every pane as U12 says.

**U107 retired by #3563.** Its control-mode clauses (jump by `⌥1` to `⌥9`, `⌥0`, `takeover.begin`, `takeover.end`, the `Take control` button and `⌘⏎` in the Rail) are removed with Takeover (B3563a). `⌥1` to `⌥9` and `⌥0` are not taken and reach `terminal.write` like every other `⌥` key (U12); selecting an Agent row shows its Terminal and typing needs only Terminal focus.

**U108 (spike) the shell as a Drawer that minimises to a chip.** Question: can `⌃\`` toggle a slide-out shell that, when minimised, stays alive as a chip like a Terminal bubble (U164) without a fixed split pane? Pass: a prototype on the fake App that shows toggle, minimise and reopen with its process alive and one `terminal.resize` per U13, plus a written answer on whether it needs a new App seam command. Fail: it needs a seam command, so the spike ends with a seam proposal for the committee. No Builder starts on this id.

**U109 retired by U467.** The Thread's input and its Attachments are gone; a pasted image reaches a Terminal as U418 says.

**U110 retired by U467.** The Thread's feed, input and Quote are gone.

Tests are named `u107_`; U108 has a pass condition and no test.

**U3742 an Agent's comment waits in the Inbox as needs-you until the Todo is opened.** Work order: [#3192](https://github.com/saadshahd/roundup/issues/3192). Journey: Review. Given a Todo with an unread Agent comment (T23), when the Inbox opens, then one row names the Agent and the Todo and shows the comment's line in the needs-you amber; activating it opens that Todo's Drawer (U3741), which marks the comment read, and the row leaves the Inbox. The row is driven by `todo.unread` and the `todo.commented`, `todo.commentsRead` and `todo.deleted` events, never by a Message, sets no Rail Kind and makes no Toast. Test: `u3742_an_unread_agent_comment_is_a_needs_you_row_until_opened`. Moves: D2, D5, D6.
