# U5741 settings decision evidence

Audited product: `092fcafbf910f292d7180c97d35bd381aff984b3`. This continues [settings.md](settings.md); it does not complete U5741 or request owner decisions. Stable S identifiers refer to that table. No deletion, acceptance retirement or owner usage claim follows from candidacy.

## Evidence boundary

[Source provenance](catalogues/settings-source.json) hashes the inspected owning files and records the actual 60-row shortcut configuration catalogue. [Rendered observations](rendered-settings.json) record actions, mounted control values and D Checks (lazy-mounted hidden tabs can remain in the value census; paired accessibility snapshots identify the visible controls). Their paired raw accessibility snapshots and PNG files stay under `artifacts/ux/U5741/settings/`. Real keys/clicks open the surfaces; fixture handlers supply only the named conditional server states. Engine/model fixture ids are not a production Adapter offer.

The report retains the old product revision deliberately. The source catalogue separately lists every changed product file through continuation main `b0562bd815f4f986b981b1c024e989328dd1489f`. That delta includes Pad width settings, keyboard offers, native Dock and other App changes. Before the complete ask, reconcile that delta, refresh the runtime offers/renders where changed and pin the resulting complete inventory to one main revision. Old census totals cannot stand for current main. This list is a continuation worklist, not evidence those changes have been audited.

## Equivalence comparisons

Q1 asks for the same action or result, allowing a different scope where stated. A vendor primitive capable of running arbitrary shell commands is not evidence it already supplies roundup's state policy, guide or key-override record. These comparisons concern existing behavior, never a proposed replacement Adapter.

| Evidence | Settings / implementation and result | External evidence and scope | Q1 disposition |
| --- | --- | --- | --- |
| E1 | S01/S03: `preferences.ts::withAppSettings` passes permission/model defaults on user launches; saved Door resume retains its engine/model | Retained Claude Code 2.1.300 help in `catalogues/public-seams.json`, `--permission-mode` and `--model`; [settings precedence](https://code.claude.com/docs/en/settings) and [model configuration](https://code.claude.com/docs/en/model-config), consulted 2026-11-03 | yes for choosing vendor launch permissions/model. Roundup stores its own app-wide defaults and may pin a selected Model above environment settings; changing a vendor default does not edit that App record. Running-Agent Model controls remain a separate feature, governed by P8. |
| E2 | S02: `AppSettings::chooseEngine`, `models.rs::list`, `claude_code/models.rs::engines`: optional engine id for new launches | The inspected Adapter has only `claude-code`; neither Codex nor an unimplemented Adapter is a current replacement. Same-revision rebuilt Daemon `models.list` reply in catalogues/settings-source.json: only `claude-code`, models fable/opus/sonnet/haiku, efforts low/medium/high/xhigh/max | no equivalent multi-engine result exists on this revision: default and explicit Claude Code select the sole current Adapter. A future Codex engine is not a replacement. |
| E3 | S04/S05: `NamingSettings::save` writes `daemon.setNaming`; `launch.rs` passes a frozen guide in the roundup MCP environment; `mcp.rs::tools` uses it in spawn instructions for roundup Rail names | [Claude interactive reference](https://code.claude.com/docs/en/interactive-mode), consulted 2026-11-03; session interaction is not the owned Rail naming policy. Source `agent-naming.md` A4688a–d distinguishes first-prompt fallback, explicit names and the launch-frozen guide | no equivalent global roundup Rail automatic-naming switch or launch guide established in the vendor reference. Manual naming a vendor session does not set either value. Q2 remains yes; both controls act on names, so Q3=no. |
| E4 | S22/S25/S28/S31/S34: `stateAlerts.ts::createStateAlerts` dispatches a selected Kind's alert when App is behind; `watch.tsx::watchProject` routes that Agent's transitions. Alert click targets its original Agent | [Claude hooks reference](https://code.claude.com/docs/en/hooks#notification), consulted 2026-11-03: Notification is a vendor-session event, with permission/idle timing and hook side effects. [Apple Notifications](https://support.apple.com/en-ie/guide/mac-help/mh40583/mac): channel controls apply per app | no same per-roundup-Kind switch or original-Agent route in those controls. Similar alert presentation is partial overlap, not equivalent state/identity selection. |
| E5 | S23/S26/S29/S32/S35: `createStateAlerts` selects sound by Kind; needs-you/error chime comes from Toast dispatch, ordinary states from the App seam, with selected/front and rate-limit rules | Same E4 vendor hook and Apple sources. A session notification hook can trigger a side effect; Apple's app sound switch cannot choose Working vs Done | no same per-Kind sound policy. No claim that every sound is controlled by the macOS notification-sound permission. |
| E6 | S24/S27/S30/S33/S36: `DockBadge.tsx::DockBadge` counts current Agents under roundup's state/quiet policy across open Projects | Same Apple source exposes an app badge switch; a Claude session notification is not roundup's live cross-Project Agent count | no same state-selective count. Turning an app badge off is partial overlap, not a way to choose the counted Kind. |
| E7 | Individual binding controls below write `roundup:app-settings.shortcuts` through `saveAppSettings`; defaults/owner refusal resolve in `chords.ts` and `shortcutRules.ts` | [Apple App Shortcuts](https://support.apple.com/guide/mac-help/create-keyboard-shortcuts-for-apps-mchlp2271/mac), consulted 2026-11-03, can rebind existing menu commands. Native menu construction is reconciled in native-menus.md; roundup additionally owns webview physical presses, scope, hints and export | unverified per row: menu-command rebinding may give the same user result despite different storage. Reconcile each menu title, raw/Leader scope and native/webview dispatch before deciding; different persistence alone is no reason to answer no. The underlying action remains a separate feature. |

E4–E6 apply separately to each of the fifteen switches. In every such row Q2=yes: Understand requires distinguishable Agent states and Intervene requires the original Terminal continuation (`journey.md`, What must work), both retained through Rail/direct attention without this optional channel. Q3=no: each switch changes a concrete channel/count rule; `alerts-switches` renders all fifteen controls. P3 and U5232 still require their current behavior until the owner authorizes a precise retirement. A sound/badge default being on does not authorize removing it.

For S07–S16, typography, appearance and markers affect roundup's host renderer and input regions rather than vendor output; their original Q1=no statements mean no same host control in the compared vendor settings. Terminal/appearance previews support choosing those values (Q3=no), rather than being inert records. Current screen evidence is `terminal-controls` and `appearance-controls`; original S17/S18 Project cap evidence remains `project-settings` in `rendered.json` and `ProjectSettingsBody`. No new native rendering claim is made.

## Shortcut configuration is separate from the action

`ShortcutSettings` iterates all 60 `ACTION_ROWS`. A `todo.capture` row expands to S12 and S13, not an additional general action recorder. For other rows, `CHORDS.some(recordable)` determines whether there is a recording button; Leader/multi-press rows can be read-only. Only a saved override mounts Reset. The table below enumerates exact ids and defaults; the owning action's target/scope and acceptance remain in [keyboard.md](keyboard.md). No action retirement is proposed by a binding row.

For each **Record / Reset** row: Q1=unverified (E7, native menu remapping must be compared per action); Q2=yes (Enter still chooses a Project and starts its Door; Request still sends Ask; Understand still selects state-bearing rows; Intervene still reaches the native Terminal; Review still opens work and reopens the Project, all with the retained default keys, Help/menu references and pointer controls rather than needing a changed binding); Q3=no (Record changes the binding, Reset restores it). Acceptance is `ui-shortcut-settings.md` U5239b/d, persistence U3806, and native-menu hints U5247. `action-recording` exercises an actual New Agent recorder without starting an Agent. The attempted key did not create an override; conditional Reset/export behavior is source-confirmed and remains unverified by this observer. Other rows' recording affordances are reconciled against the runtime configuration table; they have not each been rebound.

For each **Reference** row: Q1=unverified (E7, compare native menu shortcut discovery and raw/Leader scope per reference); Q2=yes (the stage uses the underlying action/default key rather than needing its duplicate Settings reference); Q3=no (the key tells the user how to invoke the specific action in keyboard.md, an information-based navigation decision). These are independent shortcut-reference presentations, not inert merely because they have no editor. Acceptance U5239a requires the reference; removal would require its explicit retirement. Rendered `shortcut-settings` in `rendered-keyboard.json` establishes the page; per-row offscreen references remain source-confirmed, not a claim that each was visible in one viewport.

| Stable row | Action / reference entry | Default | Independent Settings offer |
| --- | --- | --- | --- |
| K01 | `agent.new` — New Agent | ⌘N | Record / Reset |
| K02 | `agent.new-with-prompt` — Agent with prompt | ⇧⌘N | Record / Reset |
| K03 | `workstream.new` — New Workstream | ⌥⌘N | Record / Reset |
| K04 | `mode.new` — New Mode | ⇧⌘M | Record / Reset |
| K05 | `leader.assign` — Assign / Ask | A | Reference |
| K06 | `leader.project` — Switch Project | P | Reference |
| K07 | `leader.changes` — Review changes | C | Reference |
| K08 | `leader.attention` — Next needs you | J | Reference |
| K09 | `leader.attention-other-project` — Needs you elsewhere | ⇧J | Reference |
| K10 | `leader.row` — Find row | K | Reference |
| K11 | `leader.bubble-minimise` — Minimise Bubble | M | Reference |
| K12 | `leader.bubble-close` — Close the Bubble | W | Reference |
| K13 | `leader.shelf` — Open the Bench | B | Reference |
| K14 | `leader.capture` — Capture a Todo | T | Reference |
| K15 | `leader.inbox` — Open the Inbox | I | Reference |
| K16 | `terminal.new` — New Terminal | ⌘T | Record / Reset |
| K17 | `leader.open` — More keys… | ⌘K | Record / Reset |
| K18 | `switcher.open` — Find anything | ⇧⌘P | Record / Reset |
| K19 | `attention.jump` — Next needs you | ⌃⌘J | Record / Reset |
| K20 | `todo.capture` — Capture a Todo | ⇧⌘T | S12 / S13: quick-add recorders |
| K21 | `terminal.switch` — Switch Agent / Terminal | ⌘B | Record / Reset |
| K22 | `rail.collapse-expand` — Collapse / expand | ← → | Reference |
| K23 | `rail.move` — Move to… | M | Record / Reset |
| K24 | `rail.rename` — Rename | F2 | Record / Reset |
| K25 | `help.open` — Help | ? | Reference |
| K26 | `agent.restart-mode` — Restart Mode | R | Record / Reset |
| K27 | `rail.remove` — Remove | ⌘⌫ | Record / Reset |
| K28 | `ask.open` — Focus Ask bar | ⌘/ | Record / Reset |
| K29 | `todo.assign-slot` — Assign | 1–9 | Reference |
| K30 | `todo.open-draft` — Open | ⏎ | Record / Reset |
| K31 | `todo.add` — Add Todo | N | Record / Reset |
| K32 | `todo.assign` — Assign | O | Record / Reset |
| K33 | `shelf.maximise` — Maximise | M | Record / Reset |
| K34 | `todo.delete` — Delete row | D | Record / Reset |
| K35 | `todo.export` — Export .md | E | Record / Reset |
| K36 | `shelf.close` — Close | Esc | Record / Reset |
| K37 | `terminal.text-larger` — Larger Terminal text | ⌘= | Record / Reset |
| K38 | `terminal.text-smaller` — Smaller Terminal text | ⌘- | Record / Reset |
| K39 | `terminal.text-reset` — Reset text size | ⌘0 | Record / Reset |
| K40 | `editor.quote` — Quote | ⇧⌘B | Record / Reset |
| K41 | `editor.bullet-list` — Bullet list | ⌥⌘8 | Record / Reset |
| K42 | `editor.numbered-list` — Numbered list | ⌥⌘7 | Record / Reset |
| K43 | `editor.code-block` — Code block | ⌥⌘C | Record / Reset |
| K44 | `editor.italic` — Italic | ⌘I | Record / Reset |
| K45 | `editor.inline-code` — Inline code | ⌘E | Record / Reset |
| K46 | `terminal.find` — Find… | ⌘F | Record / Reset |
| K47 | `edit.undo` — Undo | ⌘Z | Record / Reset |
| K48 | `edit.redo` — Redo | ⇧⌘Z | Record / Reset |
| K49 | `settings.open` — Settings | ⌘, | Record / Reset |
| K50 | `settings.forward` — Forward → | ⌘] | Record / Reset |
| K51 | `todo.triage-enter` — Triage Todos | T | Record / Reset |
| K52 | `todo.triage-move` — Move | J K | Reference |
| K53 | `todo.triage-assign` — Assign | A | Record / Reset |
| K54 | `todo.triage-workstream` — Workstream | W | Record / Reset |
| K55 | `todo.triage-nest` — Nest | Tab | Record / Reset |
| K56 | `todo.triage-unnest` — Un-nest | ⇧Tab | Record / Reset |
| K57 | `todo.triage-done` — Done | X | Record / Reset |
| K58 | `todo.triage-comment` — Comment | C | Record / Reset |
| K59 | `todo.triage-leave` — Leave | Esc | Record / Reset |
| K60 | `project.choose-folder` — Choose Project… | ⌘O | Record / Reset |

S19 Find a key and S20 Save to file retain their separate decision rows: lookup supports selecting a free press, export saves the owner's overrides. A lookup is not the New Agent recorder. S21 search filters Settings controls, not the command switcher. These distinctions prevent deleting a retained action through a superficially similar configuration row.

## Conditional controls and recovery

| Row / state | Actual available action and evidence | Decision boundary |
| --- | --- | --- |
| S02/S03 picker | Engine/Model buttons open filtered offered choices; `engine-choices` / `model-choices` | Fixture proves opening, not real engine catalogue or launch. |
| S05 empty guide | Save refuses a blank guide; `naming-refusal` | Cause supports fixing and resaving the guide; Q3=no. Draft/retention recovery remains P11, separate from optional naming. |
| S06 outdated | Update calls `skill.setup`; `skill-outdated` | Update is an independently available conditional entry of the installation feature, not a second permission to remove unrelated vendor skills. |
| S06 foreign | Actual cause/recovery text; `skill-foreign`; `SkillSetting::failureOf` | Manual ownership recovery is actionable. No observer writes a real user's skill files. |
| Binding with override | Source: `ActionShortcut` shows Reset only for an override, and `ShortcutSettings` enables export only for nonempty overrides; the attempted recording saved none | Conditional render remains unverified. No override capture is accepted. |

## Owner direction

Creation dates below date the owner's work order, not every subsequently edited detail. The source catalogue retains author, creation timestamp and current-body hash so future runs do not silently substitute a different body. These are reversals to include if the final all-candidate request includes these features; they are not current keep/delete answers.

| Rows | Required reversal wording / accepted outcome |
| --- | --- |
| S01–S03, S07/S09, S12/S14 | Reverses owner direction: 2026-10-22 — [#3281](https://github.com/roundup-app/roundup/issues/3281), App-wide Settings and permission/engine/model, Terminal family/size, quick-add chord and System/Dark/Light choice; `ui-app-settings.md` U3799–U3806. The original engine request mentioning Codex does not make that Adapter implemented. |
| S07–S11, S14–S16 and their previews | Reverses owner direction: 2026-10-28 — [#4687](https://github.com/roundup-app/roundup/issues/4687), fitting controls/live appearance and Terminal preview; U4687a–d. Specific later clauses retain their own acceptance; creation time alone does not date each clause. |
| S04/S05 | Reverses owner direction: 2026-10-28 — [#4688](https://github.com/roundup-app/roundup/issues/4688), global automatic Rail naming and owner guide; `agent-naming.md` U4688a/b and A4688a–d. |
| S22–S36 | Reverses owner direction: 2026-10-31 — [#5232](https://github.com/roundup-app/roundup/issues/5232), state-specific Alert/Sound/Dock badge choice and original-Agent alert click; U5232. Rex is comparison background, not blanket deletion approval. |
| Binding/reference rows, S19/S20 | Reverses owner direction: 2026-10-31 — [#5239](https://github.com/roundup-app/roundup/issues/5239), list action keys, record a key, find its owner and export overrides; U5239a–e. |

Searched the owning settings, shortcut and naming scenarios, Principles, wireframes, the recovered direction report, and all body/comments of the five linked owner work orders. Further linked direction for S06, S13, S17/S18 and S21 remains to reconcile before the final ask. [direction.md](direction.md) retains Orca/Paseo/Bise accepted outcomes: none is superseded by these Settings findings. No dated direction is invented for a row without a verified owner source.

## Remaining work

Resolve E7 per row without confusing internal storage with the user result; complete configured widget/recording variants and settings recovery openings; reconcile new-main settings and actions (including Pad width); complete each underlying action and every other App/CLI/MCP feature on Q1/Q2/Q3 and linked direction. Then present every candidate together in batches of at most ten in the one owner ask. No partial batch is sent. Older-Project reopening remains mandatory before any chosen retirement, with store-open and real-Daemon behavior proofs and the applicable N5467 amendments.
