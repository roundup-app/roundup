O16 rejected Save and content sizing, isolated headless Chromium, thread-report.

At 700×800, Title, Ask and Done when each show the full wrapped edit (68 px client height and scroll height). At 1280×800 the fields resize to the wider content. Extreme text caps each field at the 160 px Token and scrolls inside it; the actions remain visible. Shortened text shrinks the fields.

Rejected Save preserves the input and shows an error Kind Glyph beside the error text. D1–D5, D8 and D9 pass at both light viewports and at 700×800 dark. D6 and D7 fail on the existing Prompt summary, so aggregate D10 also fails, as the critic recorded on main. No new failing Check. The focused field shows the inset accent bar.

Captures and readings are beside this report. These prove Chromium rendering only.

Critic repair: thread-report with a Done condition supplied through the fake Daemon, isolated headless agent-browser, 1280×800 and 700×800, light and dark. `critic-rest-*` and `critic-rejected-*` record the rendering and D1–D10 readings.

| Before | After | Why |
| --- | --- | --- |
| Edit touches Close's hit area | 8 px (`--space-2`) vertical gap | A missed Edit click has space before Close |
| Checked mark uses working blue | Open and checked marks use `--grey` | Done agrees with the Rail's Kind tone |

Rejected Save keeps the fields and visible error, with no Drawer overflow at either viewport. Escape restores focus to Edit order. D1–D5, D8 and D9 pass in all four captures; only the existing Prompt summary fails D6/D7 and aggregate D10. These observations cover Chromium only.
