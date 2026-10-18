# Motion

Terms from the animation vocabulary. The more often a change is seen, the shorter (or absent) its animation. Check D9 (`docs/design-system.md`) measures each duration against this table.

**Key-driven layers are instant.** A layer opened or closed by a key shows and hides at once, including Enter or Space activation of a button. Each action carries its source; a key interrupts and settles a pointer slide immediately. Pointer actions keep their row’s motion.

| Trigger | Term | Duration / easing | Notes |
|---|---|---|---|
| Drawer (Inbox, Todo detail, Pad, history), pointer open/close | Slide in from the right | ~180 ms, `--easing-out` | Exit reverses. The centre narrows with it (U430); the Terminal is fitted once per slide (spatial consistency). |
| Shelf, pointer open/close | Slide in from the trailing edge | ~180 ms, `--easing-out` | Exit reverses. Overlay: never resizes the terminal. A tab switch and a restore are instant. |
| Drawer, key open/close | none (instant) | 0 | Focus and content settle by the next frame; no exit waits for a transition. |
| Shelf, key open/close | none (instant) | 0 | Centre and scrim settle together; fit the Terminal once. |
| Help, Leader, Switcher, Bubble, key or pointer open/close | none (instant) | 0 | Existing focus behavior. |
| Toast enter, exit | Fade and 8 px rise | 150 ms, `--easing-out` | Instant under reduced motion. Hover or focus keeps it; it hides itself after 5 s. |
| Rail live-line text change | Crossfade | ~120 ms | No spinner (purposeful animation). |
| `working` Glyph arc | Turns | ~1 s (8 × `--duration-crossfade`), linear | `transform` only; ring stays fixed; still under reduced motion. |
| Status glyph change | none (instant) | 0 | Seen constantly. |
| Done Agents fold | Accordion / collapse | ~150 ms, `--easing-out` | |
| New row | Layout animation | ~150 ms | Siblings move; nothing snaps. |
| Drag in the rail | Drag to reorder | follows pointer | Others shift to make room; thin drop line, its left end sets depth; release is interruptible. |
| Needs-you arrival | Pulse | one cycle, ~400 ms | Then still. An ambient loop would break the calm rule. |
| Rejected Inbox action | Shake / wiggle | ~250 ms | On the row. |

**Reduced motion** (`prefers-reduced-motion`) turns off every row above except the instant state changes.
