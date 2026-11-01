# The App component layer

Status: Accepted; U474 foundation and the original U475 CloseDialog migration shipped in [#1658](https://github.com/roundup-app/roundup/pull/1658). U473 validation remains incomplete in the retained foundation evidence (details below).

Use `@ark-ui/solid` behind thin styled App wrappers in `apps/desktop/src/ui/`. Keep Solid, vanilla CSS and `tokens.css`. Shared library behaviour replaces bespoke focus, keyboard and ARIA code; the App keeps its appearance and domain actions. The first migration was CloseDialog. This records the user's 2026-10-14 direction; the shipped foundation's observations are retained in `apps/desktop/src/ui/evidence/README.md`. Current wrappers live in `apps/desktop/src/ui/`; `u474_foundation.test.tsx` and `u474_browser.test.ts` retain their behavioral observers. CloseDialog now uses `NativeAlert` under U3512a (`scenarios/ui-modal-surfaces.md`), superseding its original web AlertDialog presentation in [#3532](https://github.com/roundup-app/roundup/pull/3532).

## Reuse considered

[Ark Dialog](https://ark-ui.com/docs/components/dialog) supports controlled opening, initial/final focus and an `alertdialog` role. AlertDialog is an App wrapper of Dialog, not a separate Ark export. Its default outside-click dismissal differs from U184, so configure library dismissal to preserve outside-click cancellation and test it. Keep the library root alive through its close/focus cleanup rather than conditionally destroying it at the start of dismissal.

[Kobalte AlertDialog](https://kobalte.dev/docs/core/components/alert-dialog/) provides a Solid alternative with focus trapping and Escape dismissal; [corvu Dialog](https://corvu.dev/docs/primitives/dialog/) supplies additional Solid primitives. Neither is rejected for a demonstrated defect: defer this combination because the owner selected Ark and one behaviour layer avoids mixing component conventions. Use it only after a reproducible Ark performance miss. No size or latency advantage has been measured in this specification run.

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
