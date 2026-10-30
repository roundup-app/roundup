U4708 / U4908: Pad marks, row columns and shared Open action.

The isolated headless observer compares main `90b95fe09f5912dce3c6978614dab7862b35223e` with head `655f29b748cec91df57841bd7157d36e1800d747`. Baseline product code is unchanged; its only local edit registers these capture ids. `observation.json` records the paired readings. Images and videos remain uncommitted.

| Coverage | Observer |
| --- | --- |
| Chosen Pad/Todo opens once by pointer, Enter or Space; no rename, completion or move | Six `u4908_open_button_opens_chosen_item_once` cases |
| Row selection, rename, drag, Project isolation and Escape | Shelf/Pad focused regressions |
| Dark paired rendering | Shared U4708/U4908 observer: both tabs, both seeds, rest/hover/focus/selection/Drawer/add/rejected creation/1280×820 |
| Dense data | 300-character Todo, 120-character Pad, 60-character group, ten blockers, Todo depths 0–3, Pad groups and done summary |

`just capture U4708` activates the shared U4908 observer and writes both scenario directories. Each phase has 32 matched states, at 1512×950 except the four 1280×820 states. The two head videos record the Todo and Pad interactions at the main viewport. The observer restores dark media after recording starts, loads the lazy Pad editor module before measuring its Drawer, reveals the full failure tooltip, and finishes recording before the smaller viewport.

Caller inventory:

| Caller | Leading mark |
| --- | --- |
| `pads/Pads.tsx` leaves and add field | Shared decorative sticky-note |
| `todos/OpenRow.tsx` Shelf and nested Rail rows | Kind glyph |
| `todos/Todos.tsx` pending rows and done summary | Idle/done glyph |
| `todos/Todos.tsx` via `ink/EntryRow.tsx` | Disabled capture tick |
| `ink/EntryRow.tsx` | Forwards caller mark or absence |
| Other Shelf tabs | No ShelfRow/EntryRow callers |
| Absent mark | No current caller; ShelfRow omits the wrapper and its one-column grid reserves no gap |

One Token-derived row/group origin governs marked columns. The long group name truncates with its count visible; hover, focus and selection retain the same columns. The critic judges the paired pictures; Check readings supplement that optical review. The Linux/Chromium observer makes no native macOS claim; the user reports what they meet on the Mac.

Validation: `just ready` passes; 93 focused regressions and 20 integrated Pad cases pass; the seven related browser cases pass. All eight final paired cases pass across the Todo and Pad runs. Both Check delta commands pass with no regression. Pre-existing vendor-editor D1/D2 failures and their aggregate D10 remain in matching Pad states; D5, D6 and D12 pass throughout.
