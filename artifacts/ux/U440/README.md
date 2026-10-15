# U440–U443 boxed Project tabs

Source: PR #1898, refreshed on Linux after merging main `8f4aeda2`. Baseline: main `e572ac11`. Captures use isolated headless agent-browser sessions and fresh profiles.

36 fixtures: zero, one, two, three and eight Projects, including the dense tree-40 seed; light/dark at 1280×800, 1280×820 and 1440×800. Each variant has 96 PNG/Check pairs: rest, close hover and selection. Geometry JSON includes the box, name, close, plus, dot, header rule, rename field and overflow cap rectangles. Mark-clearing readings verify that the reserved dot column prevents movement.

All ten U440–U443 geometry tests pass. Name, close and plus centres differ from their tab centre by at most 0.0 px. Boxes and overflow caps meet the header’s bottom rule. Marks are 8×8 px filled dots and stay clear of the close target. Rename remains inset within its box. The three-Project fixture exercises unselected hover and switching selection without moving any tab. The dots retain the existing sentence-case accessible names, `Error` and `Needs you` (U471/U472).

`loop/rules.sh delta artifacts/ux/U440/base artifacts/ux/U440/head` exits 0: every passing D1–D14 Check remains passing. All D1–D14 readings pass on the head in these 96 captures. The U441 sibling directory contains composited contrast, press, focus, failure/Reopen, increased contrast and Token-scope readings; all nine Token tests pass. Updated surface captures include the final overflow-cap layout and scroll-dependent fades.

The U179 no-box assertion is retired by U440. The Token prerequisite’s old-geometry equality assertion is replaced by `u441_hover_and_selection_move_no_other_tab`; U179–U186 behavior tests preserve rename, close, overflow clicks and keys. U180/U185 read dots and U184 keeps tone precedence, counts and direction. `GLOSSARY.md` already defines Tab mark as this dot on main.

Two additional endpoint captures in `edges/head/` (`tabs-8-1280-{first,last}`) show the first and last tab borders outside the mask ramp. `u440_uncut_end_borders_stay_in_the_masks_opaque_region` failed on the rejected head (first border x=132, opaque region x=136) and passes with a fade only on the side with hidden content. The three existing edge tests still prove selection reveal, separation from the caps and fading of cut tabs. All four live endpoint Check readings pass; U453 permits stored captures only at 1280 px and above. No test is retired in this repair.

These observations prove the Chromium webview; the user reports what they meet on the Mac.
