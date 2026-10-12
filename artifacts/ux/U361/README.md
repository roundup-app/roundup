# U361: Todo rows

```text
☐ Todo title
  waits on blocker title, …
```

Captured with `ROUNDUP_U361_BASE_ORIGIN=http://127.0.0.1:5198 just capture U361`.
The second server serves detached main `7922b6f2`; `base/` holds its PNGs and Checks. Root PNGs and Checks hold this branch's render. The observer uses headless Chromium and a fresh profile, closed by the test.

| Evidence | Coverage |
|---|---|
| `<seed>-<scheme>-<viewport>.rows.json` | Every open/done Todo's boxes at rest and each row on hover/focus; title overlap, unchanged top/height/wrapping, 24 px tick boxes, 8 px side and 4 px vertical inset, gaps within each list, full blocker titles and one-line clipping |
| `<seed>-<scheme>-<viewport>.png` and `.checks.json` | `tree-40`, `agents-10`, `first-run`; light/dark; 1280×820 and 700×800; 300-character title, ten blockers, 40-character blocked/blocker titles, unfolded done Todos |
| `*-failure.png` and `.checks.json` | On both populated seeds, Tab from a blocked Todo's title to its tick box, Space, failed completion, unchecked box and retained visible focus; message replaces `waits on` |

D1–D13 pass in the populated and first-run renders. D14 passes on first-run. On both populated seeds, main and this branch expose D14's existing comparison of the 8 px gap before the done fold with 0 px gaps inside lists; no new Check failure is introduced. #1269 owns that Check repair.

The native tick box, event/refetch behavior, no Drawer/Touch on completion, blocker Drawer navigation and repeated pending/successful toggles are asserted by `todos/u361_todo_row.test.tsx`. The browser reads actual rectangles; it excludes title ancestors, which contain that title by definition, and tests sibling controls and lines for overlap. `u359_`, `u112_`, `u138_`, `u155_` and the retained nested `u60_`/`u157_` cases cover alignment, wrapping, focus, reorder and the Agent's Todo controls. Moving from the Shelf still uses the Drawer; U362/U363 belong to #935.

Agent-browser also observed before/after `tree-40` at 1280×800 and 700×800 in session `builder-38288866530`. This is webview evidence; the user gives Mac feedback independently.
