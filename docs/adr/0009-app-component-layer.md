# The App component layer

Status: Accepted; U474 foundation and the original U475 CloseDialog migration shipped in [#1658](https://github.com/roundup-app/roundup/pull/1658). U473 validation remains incomplete in the retained foundation evidence (details below).

Use `@ark-ui/solid` behind thin styled App wrappers in `apps/desktop/src/ui/`. Keep Solid, vanilla CSS and `tokens.css`. Shared library behaviour replaces bespoke focus, keyboard and ARIA code; the App keeps its appearance and domain actions. The first migration was CloseDialog. This records the user's 2026-10-14 direction; the shipped foundation's observations are retained in `apps/desktop/src/ui/evidence/README.md`. Current wrappers live in `apps/desktop/src/ui/`; `u474_foundation.test.tsx` and `u474_browser.test.ts` retain their behavioral observers. CloseDialog now uses `NativeAlert` under U3512a (`scenarios/ui-modal-surfaces.md`), superseding its original web AlertDialog presentation in [#3532](https://github.com/roundup-app/roundup/pull/3532).

## Reuse considered

[Ark Dialog](https://ark-ui.com/docs/components/dialog) supports controlled opening, initial/final focus and an `alertdialog` role. AlertDialog is an App wrapper of Dialog, not a separate Ark export. Its default outside-click dismissal differs from U184, so configure library dismissal to preserve outside-click cancellation and test it. Keep the library root alive through its close/focus cleanup rather than conditionally destroying it at the start of dismissal.

[Kobalte AlertDialog](https://kobalte.dev/docs/core/components/alert-dialog/) provides a Solid alternative with focus trapping and Escape dismissal; [corvu Dialog](https://corvu.dev/docs/primitives/dialog/) supplies additional Solid primitives. Neither is rejected for a demonstrated defect: defer this combination because the owner selected Ark and one behaviour layer avoids mixing component conventions. Use it only after a reproducible Ark performance miss. No size or latency advantage has been measured in this specification run.

## Bubble move and resize: Ark FloatingPanel rejected (#6536)

Decision, 2026-11-13: `bubbles/Bubble.tsx` keeps its hand-written move and resize; `FloatingPanel` is not added to the stack table. Source read: `@zag-js/floating-panel` 1.45.0 as installed, behind `@ark-ui/solid` 5.39.3 (1.47.0 is latest and was not diffed; neither changelog is evidence here, only the installed source).

Held, through configuration: Escape restores the position and size a drag began with (`dragging` and `resizing` states handle `ESCAPE`); `getBoundaryEl` clamps size and position, so U4459's measured extent can be a sized element; the Ark root `open` prop can fold a bubble to its tab chip (U2224) if the `minimized` stage is unused (gap 3 is met by not calling `minimize`); the top layer orders the open bubble (U2307b) however Zag ranks its `panelStack`, but the positioner's inline `z-index: var(--z-index)` fails `u2307b_the_bubble_is_a_library_layer_and_no_z_index_orders_it` unless that test is loosened (gap 2 is a scenario change, not a blocker alone).

Missing capabilities that fail it:

1. **Centred resize (U2236 call 1).** `setSizeFromDrag` picks `scalingOriginMode: event.altKey ? "center" : "extent"` from the pointer event and `lockAspectRatio` from `event.shiftKey`. No prop selects the centre origin as the default, so a bubble would resize from the opposite edge unless a synthetic event carries `altKey`, which rule 9 forbids. Changing the calculation means patching Zag.
2. **Cancel on focus loss (gap 1).** The only exits from `dragging` and `resizing` are `DRAG_END` (pointerup, pointercancel, contextmenu, a mouse move with no button down) and `ESCAPE` (a keydown on the panel content). The API exposes no cancel; `Bubble.tsx` cancels and restores on `blur` and `focusin`. A wrapper could only dispatch a synthetic Escape.
3. **Hit zones (U2236 call 2).** Zag's resize triggers sit inside the content box at its edge; U2236 centres the 8 px strips on the edge line and uses 16 px corners clear of the header controls. This is styleable, not a blocker alone.

Other candidates: `@dnd-kit/solid` 0.5.0 (installed) drags but has no resize and no boundary clamp. Both would still leave the U2236 and U4459 rules (`bubbles/places.ts`) hand-written.

Selected: the current hand-written code. Rule 7 was not measured: with the capability above failing, a prototype's drag-frame p95, bundle delta and K1 to K3 could not change the decision, so no number is claimed. Revisit if Zag gains a default centre-origin option and a cancel event, and then measure drag-frame p95 against 16.7 ms (#6342), the entry and `bubbles` chunk sizes with `rollup-plugin-visualizer`, and K1 to K3 (`scenarios/perf.md`); a Mac run is a `flag:needs-mac` request. `scenarios/ui-bubble-resize.md` needs no proposed headings.

## Stack and migration boundary

| Need | Choice | Replaces |
|---|---|---|
| Headless components | `@ark-ui/solid`: Dialog (also AlertDialog), Menu, Tooltip, Tabs, SegmentGroup, Toast, Splitter, TreeView, Popover, Combobox | Custom traps, menus, confirms, tooltips, tabs and resize edges |
| Budget fallback | `@kobalte/core` + `corvu` | The same behaviour if Ark reproducibly fails rule 7 |
| Keyboard shortcuts | Research `tinykeys` and `@solid-primitives/keyboard` in the keyboard registry Issue | Per-file keydown listeners |
| Drag and reorder | Research `@thisbeyond/solid-dnd` and Ark/Zag coverage in the drag Issue | `rail/drag.ts` and `todos/reorder.ts` |
| Colour scales | Radix Colors, `@radix-ui/colors`, CSS only; validate in the semantic Tokens Issue | Hand-picked hex values in `tokens.css` |
| Token enforcement | `stylelint` + `stylelint-declaration-strict-value`; validate in its Issue | Literal-value enforcement currently done by computed-style tests; behavioural Checks remain |

The foundation added Dialog, AlertDialog, Menu, Tooltip and IconButton and migrated CloseDialog. The remaining migration boundaries follow the original order: Dialog/AlertDialog → Menu → Tooltip/IconButton → Tabs/SegmentGroup/Toast → Splitter/TreeView → keyboard registry → drag → semantic Tokens and stylelint. Later rows are bounded research directions, not unmeasured final package selections. Existing migration Issues own their scope; this decision does not widen them.

`just perf` measures the Daemon, not keystroke-to-render or App startup. U473 requires its Daemon budget evidence separately from the authorised native keystroke observer. Package addition and wrapper adoption have landed. The retained foundation report records passing absolute Daemon limits, failing regression gates and no native keystroke result; it is not a complete U473 pass. Issue #1629 was subsequently closed on merged Linux/Chromium evidence, with the user reporting what they meet on the Mac; that closure supplies no native measurement.
