# U440–U443 boxed Project tabs

Source: `e6e68a24`, merged with main in `ed7020ec`. Baseline: main `e572ac11`; main `7063788d` changes only Rust Agent modules, so its webview source is identical. Captures use isolated headless agent-browser sessions and fresh profiles.

36 fixtures: zero, one, two, three and eight Projects, including the dense tree-40 seed; light/dark at 1280×800, 1280×820 and 1440×800. Each variant has 96 PNG/Check pairs: rest, close hover and selection. Geometry JSON includes the box, name, close, plus, dot, header rule, rename field and overflow cap rectangles. Mark-clearing readings verify that the reserved dot column prevents movement.

All ten U440–U443 geometry tests pass. Name, close and plus centres differ from their tab centre by at most 0.0 px. Boxes and overflow caps meet the header’s bottom rule. Marks are 8×8 px filled dots and stay clear of the close target. Rename remains inset within its box. The three-Project fixture exercises unselected hover and switching selection without moving any tab.

`loop/rules.sh delta artifacts/ux/U440/base artifacts/ux/U440/head` exits 0: every passing D1–D14 Check remains passing. All D1–D14 readings pass on the head in these 96 captures. The U441 sibling directory contains composited contrast, press, focus, failure/Reopen, increased contrast and Token-scope readings; all nine Token tests pass. Updated surface captures include the final overflow-cap layout.

The U179 no-box assertion is retired by U440. The Token prerequisite’s old-geometry equality assertion is replaced by `u441_hover_and_selection_move_no_other_tab`; U179–U186 behavior tests preserve rename, close, overflow clicks and keys. U180/U185 read dots and U184 keeps tone precedence, counts and direction. `GLOSSARY.md` already defines Tab mark as this dot on main.

These observations prove the Chromium webview; the user reports what they meet on the Mac.
