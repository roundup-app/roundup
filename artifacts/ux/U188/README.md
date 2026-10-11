# U188 rendered observer

Headless agent-browser (session `u188`) on `harness.html?daemon=1` (U144) over a real `rupd` started with `FAKE_CLAUDE_ON_PROMPT` set to `pad_write {name: "$pad", text: "done $prompt"}` (U146, U188). The user-owned Pad `notes` was opened, `shorten` typed into `Ask or edit this pad` and `send` pressed.

`1280x800.png` and `700x800.png` show the Pad document reading `done shorten` with no reload and `you shorten` in the exchange.

`u188_each_pad_has_one_scribe_that_writes_its_pad_and_no_other` asserts the last-touch line names the Scribe (`<name> wrote this pad at …`, not `you`) and that closing the Drawer leaves the Scribe no longer `idle` (U190 stops it).
