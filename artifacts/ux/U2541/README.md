# U2541 paired captures

Base: origin/main `9989ec264569d71bbbb933c60de40ef99bb6b84b`.
Head: `562fefb8e` (Help refreshed after restoring the existing text spacing).
Hint and leader captures are from `f5ab9da1971d08949ad27f549ad8b32766daed54`;
the later change affects only Help spacing.

`base/` and `head/` each contain 16 PNG/Checks pairs from the real tree-40 harness:
light/dark × normal/increased contrast × 1512×950, 1280×800 and 700×800 hint lines,
plus Help and the leader panel in light/dark at 1512×950. An Agent is selected and
a Rail row has focus. At 700×800 the work-items panel is closed with ⌘K S to leave
space for the hint line. Each theme/viewport starts with cleared local storage.

Observer: fresh headless Chromium profile through the existing `ChromePage`
helper; Help and the injected error also inspected in the dedicated headless
agent-browser session `builder-39093745445`, profile `/tmp/roundup-hint-browser`.
No native macOS rendering is claimed.

`loop/rules.sh delta artifacts/ux/U2541/base artifacts/ux/U2541/head` exits 0.
D2 and D5 pass in every pair. No passing Check regresses. Existing D6/D7 failures
on `input.todo-tick` and the consequent D10 failure remain where the work-items
panel is visible. All 18 Help labels align after one shared key column; Enter and
Esc remain whole keys and alternative separators remain outside chips.

`failure.png` and `failure.checks.json` show the tree-40 Workstream error injected
with `window.__fake.failNext(-32003, "Workstream action failed")` before Add Agent.
The error remains visible beside the hint line at 1512×950.
