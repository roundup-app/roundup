# U361

The headless Chromium observer uses a fresh profile, a new tab for each load and the U26 harness. It waits for the new document before probing it. `just capture U361` writes only this scenario's captures. `base/` holds origin/main at `7ec4ab93`; `head/` holds the matching changed-row captures; the top-level files include row measurements and failures.

| Observer | Evidence |
| --- | --- |
| tree-40, agents-10, first-run; light/dark; 1280×820 and 700×800 | 12 before/after PNG pairs and Check records |
| 300-character title, ten open blockers, 40-character blocked and blocker titles, unfolded done Todos | Eight `.rows.json` records with rest, hover and focus boxes |
| Tab from row to tick box, Space, failed `todo.complete` | Eight `-failure.png` captures, Check records and `.focus.json` edge measurements; the box unchecks and retains visible keyboard focus without painting over the title |

D1–D14 pass on every head capture, including failure states. The observer measures the visible box at 16 px, its native hit area at 24 px, the 8 px gap before titles, Token insets on open and done rows, stable geometry and no control overlapping a title. The blocked Glyph stays on the tick box's left edge. The visible tick box is a borderless Glyph in `--grey`, with 5.09:1 light and 7.15:1 dark contrast against `--sunken` (checked: `--accent` fill); its pseudo-element border width is 0 px in both states. Keyboard focus outlines that 16 px rounded Glyph with a 2 px offset, leaving the title clear. Blocker buttons use the text baseline. The prefix and separators keep their spaces; short blocker titles retain their natural width in reading order, with one trailing ellipsis on the list. A 40-character blocker keeps visible characters in its own truncated link. `loop/rules.sh delta base head` passes.

An additional dedicated headless agent-browser session passes the Checks at 1280×800 and 1440×800. This proves the webview; WKWebView remains the user's own `just app` feedback, as #812 specifies. Rail drag and its worst case belong to #935.
