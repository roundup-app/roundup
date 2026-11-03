# U5741 conditional Pad controls

Audited main: `2136a0813f23b187102f2af1040c393537cec35b`, 2026-11-03. This continues [Pad decisions](pads.md); it does not complete the inventory or request owner choices. No product, acceptance or data changed. [Sources and replay](catalogues/pad-controls-source.json) distinguish repository bytes from installed Milkdown 7.22.2 bytes; [rendered observations](rendered-pad-controls.json) retain isolated dark 1512×950 states. Fake-Daemon acknowledgements establish this webview path, never real persistence or native behavior.

## Criteria and decision boundary

Q1 compares the same action/result with Claude Code, Codex, macOS or gh. Apple’s [TextEdit table guide](https://support.apple.com/guide/textedit/add-tables-and-lists-txte4120841e/mac), retrieved 2026-11-03, establishes editable table dimensions, alignment and border resizing. It does not establish Markdown round trips, shared Project identity, row/column reordering or roundup authority. **Yes/T** below means the narrower table-dimension/alignment action is supplied there; those differences remain. **Unverified** is an unresolved comparison, never a no.

Q2: **Yes/O** means Review’s required “Read the action’s outcome and inspect its resulting work from the Workstream. Reopen the Project and find that work again” (`.agents/data/journey.md`, “What must work”) can use retained prose without this authoring convenience. It does not retire its owning acceptance. **No/R** means that Review’s existing human/Agent separation in U5561a–c needs the retained disclosure/body path. Q3 is **No** for every row below: each names an action on the content or information, rather than calling an editable document inert. Resolved yes answers are provisional candidates only; unresolved comparisons and remaining whole-App coverage prevent the final owner request.

All table rows belong to U147/P2544a–e and U4698b; the same editable Markdown reaches `pad.write` through `PadContent::PadBody`. A local operation is not a separate RPC/MCP offer. PF/PA identifiers refer to earlier decisions, avoiding duplicate owner choices. These additional PC identifiers separate independently removable operations previously hidden in PF11/PF25. Controls shared with Todo rich descriptions must be reconciled there before deletion; no Pad-only retirement is inferred.

## Disclosure evidence correction

`agentDetailsView` uses native `details`/`summary`, an editable label and a body textarea. Keyboard Enter on the summary is followed by a bounded assertion of both `details.open` and `aria-expanded="true"`. The fresh expanded observation, label edit and body edit supersede the *coverage gap*, not the historical failed capture: `rendered-pads.json::agent-details-open` remains a failed expansion. PF22/PF27/PF28 remain the same decisions. Label Enter blurs/saves; body input writes through the editor. The fresh observer requires a `pad.write` call containing the edited body. Neither equal text nor a layout Check is taken as acknowledgement.

| Existing row | Exact entry / implementation | Q1 | Q2 | Q3 action |
| --- | --- | --- | --- | --- |
| PF22 | For Agents summary Enter/pointer; `agentDetailsView` | Unverified: no same shared source-preserving disclosure comparison | No/R | Reveal or hide retained evidence without changing document source |
| PF27 | Toggle label input, Enter/blur; `agentDetailsView::save` | Unverified: external label editing not compared at this identity seam | Yes/O | Rename the selected disclosure |
| PF28 | Expanded body textarea; `agentDetailsView::save` | Unverified: external text editing does not establish same retained source | No/R | Edit exact evidence/commands; fake `pad.write` carries changed body |

## Independent table controls

Installed source: `@milkdown/components/src/table-block/view/{component.tsx,operation.ts,pointer.ts,drag.ts}`. `PadRichEditor` enables Crepe’s `table` feature; `@milkdown/crepe/src/feature/table/index.ts` supplies icons, not additional App authorization. Handles are library-owned divs and icon buttons; the source census is necessary because several buttons have no accessible name. This is an inventory finding, not a new UI implementation.

| Row | Exact entry point / implementation | Q1 | Q2 | Q3 action on information |
| --- | --- | --- | --- | --- |
| PC01 | Interior cell hover → column handle click; `useOperation::selectCol` | Unverified: matching column selection not established by Apple guide | Yes/O | Select the column the pointer identifies; exposes alignment/deletion choices |
| PC02 | Interior body-cell hover → row handle click; `selectRow` | Unverified: matching row selection not established | Yes/O | Select the chosen row; deletion submenu opens only for non-header rows |
| PC03 | Horizontal cell boundary → `x-line-drag-handle` +; `onAddRow` | Yes/T: table row count adjustment | Yes/O | Insert before/after boundary row; header-row insertion handle is suppressed |
| PC04 | Vertical cell boundary → `y-line-drag-handle` +; `onAddCol` | Yes/T: table column count adjustment | Yes/O | Insert before/after chosen boundary column |
| PC05 | Column handle → first alignment icon; `onAlign('left')` | Yes/T: table text alignment | Yes/O | Left-align selected column |
| PC06 | Column handle → second alignment icon; `onAlign('center')` | Yes/T | Yes/O | Centre selected column |
| PC07 | Column handle → third alignment icon; `onAlign('right')` | Yes/T | Yes/O | Right-align selected column |
| PC08 | Column handle → final icon; `deleteSelected` | Yes/T: reducing table dimensions; selection-specific authority differs | Yes/O | Remove selected column cells, leaving other document content |
| PC09 | Body-row handle → deletion icon; `deleteSelected` | Yes/T: reducing table dimensions; selection-specific authority differs | Yes/O | Remove selected body row; header deletion submenu is not offered |
| PC10 | Drag column handle; `useDragHandlers::dragCol` | Unverified: dimensions are not reordering evidence | Yes/O | Reorder selected column; source-only gesture consequence |
| PC11 | Drag row handle; `useDragHandlers::dragRow` | Unverified | Yes/O | Reorder selected row; source-only gesture consequence |

Row/column insertion positions share a decision only within the same operation: before/after are target positions, not separate authoring capabilities. Left/centre/right remain separate choices because independent alignment modes can be removed while retaining the others. The source forbids mutation when the editor is not editable; rendered editable openings do not prove every read-only state.

## Link and block-menu reconciliation

PF05 remains link authoring; separate capabilities beside it are below. Installed `link-tooltip/edit/component.tsx` supplies URL input, conditional confirm icon, Enter confirmation and Escape cancellation. App `PadRichEditor` disables hover preview handlers; do not count an installed preview’s Copy/Edit/Remove buttons as offered just because its source exists. The fixed Link toolbar invokes the edit route. Unsafe/native link opening and preview reachability remain unresolved; a successful inserted link is not a native-open proof.

| Row | Entry point / implementation | Q1 | Q2 | Q3 action |
| --- | --- | --- | --- | --- |
| PF05 | Link toolbar → URL field → confirm icon/Enter, Escape cancels; `EditLink`, `linkTooltipPlugin` | Unverified: same shared Markdown identity/safe-link behavior not established | Yes/O | Insert/edit URL or cancel without applying it; same decision, explicit entry points |
| PC12 | Slash Heading 4; installed `getGroups` h4 | Unverified: same Markdown heading/source action not compared | Yes/O | Change current block to level four; absent from fixed Heading toolbar |
| PC13 | Slash Heading 5; `getGroups` h5 | Unverified | Yes/O | Change current block to level five; absent from fixed toolbar |
| PC14 | Slash Heading 6; `getGroups` h6 | Unverified | Yes/O | Change current block to level six; absent from fixed toolbar |
| PC15 | Slash Text; `getGroups` text | Unverified: plain editing alone is not conversion comparison | Yes/O | Convert current block to ordinary paragraph |

Slash menu exact registrations: Text; Heading 1–6; Quote; Bullet List; Ordered List; Task List; Code; Table; Toggle; For Agents; `! NOTE`; `! TIP`; `! IMPORTANT`; `! WARNING`; `! CAUTION` (the leading icon is part of the observed option name). Text/Heading 1–3 map to PF01/PC15; Quote PF09; lists PF06–PF08; Code PF10; Table PF11; Toggle PF21; For Agents PF22; callouts PF14–PF18. PC12–PC14 cover the additional headings. App sets `textGroup.divider=null`, so Divider is absent. Image and Math require disabled Crepe feature flags, so they are not offered by this configuration. Mermaid and Drawing are not slash catalogue entries here: PF23/PF24 remain authored-fence and `/drawing` Enter paths. The block handle and slash keyboard discovery remain PF25. No additional decision row is created merely for another entry point to the same inseparable operation.

## Direction and remaining coverage

Accepted owner direction is retained in the earlier exact direction archives: #2544 (2026-10-17, Orca-style editing/slash and source retention), #4698 (2026-10-28, toolbar), #5561 (2026-11-01, human-readable findings and editable folded Agent detail) and #5562 (2026-11-01, formats). The previous Pad report and `direction.md` retain Orca/Paseo/Bise distinctions; no new dated reversal is invented. Removing these controls can reverse active acceptance even when Q2 is yes. Search each candidate’s complete linked direction again during final reconciliation; a library default alone is not accepted owner direction.

Still unfinished: complete table insertion/deletion/drag and read-only observations, generic Toggle insertion, library navigation/formatting, drawing canvas controls, visual-block failures, conditional Pad recovery, exact vendor comparisons, shared Todo editor controls, both current runtime role offers and one-current-revision all-App reconciliation. Real Agent Terminals, native continuation and Ask stay protected. Overview (#5730) and Reactions (#5740) remain excluded. No owner answer or deletion is inferred; every later persisted retirement must reopen older owner Projects with retained identities and work.

## Rendered result

Ten retained openings: loaded table/fold; asserted expanded For Agents; edited label; edited body with fake write; collapsed fold; focused table cell; Link URL editor; inserted link; full slash catalogue; rejected save retaining exact draft. Nine openings pass every recorded Check. The Link URL editor fails D2 (1px top padding), D6 (21px input height), D8 (2px native input border) and aggregate D10. These are observed on the unchanged audited production source, not regressions introduced by this documentation slice. No all-Checks pass is claimed. The rejected-save PNG visibly retains the complete actionable cause, Resume and Dismiss, and the exact unsubmitted text.

The column-handle submenu wait timed out after normal hover/click; no successful column/row menu, insertion, deletion, alignment or drag observation is claimed. The source mapping remains useful evidence of the configured implementation, but reachability/consequences need a corrected independent observer. Link insertion is observed; editing an existing destination, cancel, confirm-icon activation and native opening remain unobserved. The slash catalogue opening proves registrations, not each insertion consequence. Full drawing-canvas inventory remains separate work.

Revision comparison: all eight inspected `pads/` modules are byte-identical between the earlier Pad audit and this main revision; `padRevisionComparison` retains both hashes for each. This proves only that local implementation delta, not a current whole-App or public-offer census.

Manifest `focus` and `tables` retain lossless JSON archives (base64 → zlib → JSON), each with a SHA-256 of decoded bytes, to stay within the repository blob cap. Other readings and snapshots retain their original representations.
