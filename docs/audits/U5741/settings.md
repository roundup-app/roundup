# U5741 settings inventory

This subsection records individual controls, not a broad keep/delete choice for Settings. It is not the final owner request. Q1 is equivalent action/result in a current external product; Q2 is no required journey action/result needing this control; Q3 is information without an action. Any yes is a candidate, pending completion of the whole audit and owner direction search.

Sources: `settings/AppSettings.tsx::AppSettings` (`controls`, `entries`, Alerts loops), `settings/preferences.ts::schema`, `settings/NamingSettings.tsx::NamingSettings`, `settings/SkillSetting.tsx::SkillSetting`, `settings/ShortcutSetting.tsx::ShortcutSettings`, `rail/ProjectSettings.tsx::ProjectSettingsBody`. Paths are under `apps/desktop/src/`. Render names below identify entries in the rendered evidence.

Journey evidence for Q2: `.agents/data/journey.md`, “What must work”. Enter requires choosing a Project, creating a Workstream and starting its Door; Request requires the Door action and resulting Todo; Understand requires distinguishable states; Intervene requires direct Terminal continuation; Review requires inspecting and reopening work. None specifies changing these App defaults or choosing notification channels. Retained default controls and the Rail can perform those actions without these customization controls. This is a connection analysis, never a claim that the owner does not use them. Existing acceptance still applies until explicitly retired.

External evidence: installed Claude Code `2.1.300` `--help` (retained) names `--model`, `--permission-mode`, `--settings` and `--resume`; [vendor settings documentation](https://code.claude.com/docs/en/settings) describes defaults and precedence. The roundup controls affect its new launches and do not replace vendor credentials or override higher-precedence setup. No unimplemented Codex Adapter is treated as a replacement. A vendor setting does not itself change the App's Terminal renderer or shortcuts.

Every Q3=no below names the concrete action or decision it supports. A preview changes with its related setting and supports choosing typography or appearance; it is not classified as inert merely because it is read-only.

| ID | Control, default and condition | Action / render | Owning acceptance | Q1 | Q2 | Q3 |
| --- | --- | --- | --- | --- | --- | --- |
| S01 | Permission mode: vendor default; default / acceptEdits / plan / auto | Changes permission flag on subsequent launches; settings-agents | U3801, B2706 | yes: installed vendor --permission-mode / settings | yes: optional configuration; stages use the retained defaults/actions described above | no: Changes permission flag on subsequent launches |
| S02 | Engine: unset; only with open Project; offered ids from models.list | Changes new-launch engine and clears prior model on change; settings-agents | U3802, P4 | unverified: actual engine catalogue needs a recorded models.list | yes: optional configuration; stages use the retained defaults/actions described above | no: Changes new-launch engine and clears prior model on change |
| S03 | Model: unset; only with open Project; offered model ids | Select new-launch model; settings-agents | U3802, P8 | yes: installed vendor --model / settings | yes: optional configuration; stages use the retained defaults/actions described above | no: Select new-launch model |
| S04 | Automatic renaming: on in seeded render; global value from daemon.getNaming | Toggle Agents naming themselves; settings-agents | U4688a/b, A4688a–d | unverified: vendor manual naming is not yet proven equivalent to automatic naming | yes: optional configuration; stages use the retained defaults/actions described above | no: Toggle Agents naming themselves |
| S05 | Naming guide: current server text; nonempty required | Edit and Save daemon.setNaming; settings-agents | U4688a/b, A4688a–d | unverified: no external equivalent established | yes: optional configuration; stages use the retained defaults/actions described above | no: Edit and Save daemon.setNaming |
| S06 | Teach other Claude Code sessions about roundup: installation-derived, not saved toggle | skill.setup / skill.remove; conditional Update when outdated; settings-agents | SK7–SK10 | no: vendor skill loader does not install roundup's owned skill and status hook | yes: optional configuration; stages use the retained defaults/actions described above | no: skill.setup / skill.remove |
| S07 | Font family: bundled default; Default / Fira Code / Menlo / Monaco / monospace / saved choice | Changes actual emulator font; settings-terminal | U3803 | no: vendor settings do not choose the host xterm font | yes: optional configuration; stages use the retained defaults/actions described above | no: Changes actual emulator font |
| S08 | Font weight: 300; 300 / 400 / 500 / 600 | Changes actual emulator and preview; settings-terminal | U4687a/b | no: host typography | yes: optional configuration; stages use the retained defaults/actions described above | no: Changes actual emulator and preview |
| S09 | Font size: 11 px; min 9, max 21 (Tokens) | Changes open/new Terminals and preview; settings-terminal | U3803 | no: host typography | yes: optional configuration; stages use the retained defaults/actions described above | no: Changes open/new Terminals and preview |
| S10 | Line height: 1.7; min 1, max 2, step 0.1 | Changes emulator/preview spacing; settings-terminal | U4687a/b | no: host typography | yes: optional configuration; stages use the retained defaults/actions described above | no: Changes emulator/preview spacing |
| S11 | Letter spacing: 0 px; min 0, max 3, step 0.1 | Changes emulator/preview spacing; settings-terminal | U4687a/b | no: host typography | yes: optional configuration; stages use the retained defaults/actions described above | no: Changes emulator/preview spacing |
| S12 | Quick add Todo: meta+shift+KeyT; modifier required; clashes refused | Record in-App capture chord; settings-shortcuts | U3804 | no: opens roundup's Todo capture, not vendor task creation | yes: optional configuration; stages use the retained defaults/actions described above | no: Record in-App capture chord |
| S13 | Quick add from any app: none; native global registration only when picked | Record / Clear Mac-wide capture chord; settings-shortcuts | U3737, U3804 | no: macOS shortcut registration is infrastructure, not this Project-targeted capture result | yes: optional configuration; stages use the retained defaults/actions described above | no: Record / Clear Mac-wide capture chord |
| S14 | Appearance: System; Dark / Light / System | Change App scheme and inspect preview; settings-appearance | U3805 | no: host colour scheme affects roundup, not merely the vendor renderer | yes: optional configuration; stages use the retained defaults/actions described above | no: Change App scheme and inspect preview |
| S15 | Interface scale: Default; Small / Default / Large | Change App text scale and inspect preview; settings-appearance | U4687a/c | no: host interface | yes: optional configuration; stages use the retained defaults/actions described above | no: Change App text scale and inspect preview |
| S16 | Show focus markers: true | Choose focus-region marks; settings-appearance | U4687d | no: host focus-region presentation | yes: optional configuration; stages use the retained defaults/actions described above | no: Choose focus-region marks |
| S17 | Workstreams at once: stored Project cap, 1 shown before read | Edit cap on Enter/blur via project.setWorkstreamCap; project-settings | U3765, U3745 | no: vendor session settings do not cap this Project's roundup Workstreams | yes: optional configuration; stages use the retained defaults/actions described above | no: Edit cap on Enter/blur via project.setWorkstreamCap |
| S18 | No limit: Project cap null, mutually controls numeric cap | Toggle unlimited/null vs numeric cap; project-settings | U3765, U3745 | no: roundup Queue policy | yes: optional configuration; stages use the retained defaults/actions described above | no: Toggle unlimited/null vs numeric cap |
| S19 | Find a key: no saved value | Capture press, report conflict/free, escape recording; settings-shortcuts | U5239c | no: consults this App action registry and overrides | yes: optional configuration; stages use the retained defaults/actions described above | no: Capture press, report conflict/free, escape recording |
| S20 | Save to file: only active when overrides exist | Choose path and shortcuts.export; settings-shortcuts | U5239e | no: exports roundup action names and physical presses | yes: optional configuration; stages use the retained defaults/actions described above | no: Choose path and shortcuts.export |
| S21 | Search settings: blank initially; engine/model conditional entries absent before Project | Filter controls by label, description, group and page; settings-agents | U5243a/b | no: searches this App's controls | yes: optional configuration; stages use the retained defaults/actions described above | no: Filter controls by label, description, group and page |
| S22 | working alert: false | Enables a macOS banner whose click opens the original Agent; settings-alerts | U5232a–h, P3 | unverified: vendor Notification hooks and macOS settings need per-channel equivalence/authority comparison | yes: Rail state and direct attention route satisfy Understand/Intervene without this optional channel | no: Enables a macOS banner whose click opens the original Agent |
| S23 | working sound: false | Enables one sound on this state transition; settings-alerts | U5232a–h, P3 | unverified: vendor Notification hooks and macOS settings need per-channel equivalence/authority comparison | yes: Rail state and direct attention route satisfy Understand/Intervene without this optional channel | no: Enables one sound on this state transition |
| S24 | working badge: false | Changes Dock counting for Agents currently in this state; settings-alerts | U5232a–h, P3 | unverified: vendor Notification hooks and macOS settings need per-channel equivalence/authority comparison | yes: Rail state and direct attention route satisfy Understand/Intervene without this optional channel | no: Changes Dock counting for Agents currently in this state |
| S25 | blocked alert: false | Enables a macOS banner whose click opens the original Agent; settings-alerts | U5232a–h, P3 | unverified: vendor Notification hooks and macOS settings need per-channel equivalence/authority comparison | yes: Rail state and direct attention route satisfy Understand/Intervene without this optional channel | no: Enables a macOS banner whose click opens the original Agent |
| S26 | blocked sound: false | Enables one sound on this state transition; settings-alerts | U5232a–h, P3 | unverified: vendor Notification hooks and macOS settings need per-channel equivalence/authority comparison | yes: Rail state and direct attention route satisfy Understand/Intervene without this optional channel | no: Enables one sound on this state transition |
| S27 | blocked badge: false | Changes Dock counting for Agents currently in this state; settings-alerts | U5232a–h, P3 | unverified: vendor Notification hooks and macOS settings need per-channel equivalence/authority comparison | yes: Rail state and direct attention route satisfy Understand/Intervene without this optional channel | no: Changes Dock counting for Agents currently in this state |
| S28 | needs-you alert: false | Enables a macOS banner whose click opens the original Agent; settings-alerts | U5232a–h, P3 | unverified: vendor Notification hooks and macOS settings need per-channel equivalence/authority comparison | yes: Rail state and direct attention route satisfy Understand/Intervene without this optional channel | no: Enables a macOS banner whose click opens the original Agent |
| S29 | needs-you sound: true | Enables one sound on this state transition; settings-alerts | U5232a–h, P3 | unverified: vendor Notification hooks and macOS settings need per-channel equivalence/authority comparison | yes: Rail state and direct attention route satisfy Understand/Intervene without this optional channel | no: Enables one sound on this state transition |
| S30 | needs-you badge: true | Changes Dock counting for Agents currently in this state; settings-alerts | U5232a–h, P3 | unverified: vendor Notification hooks and macOS settings need per-channel equivalence/authority comparison | yes: Rail state and direct attention route satisfy Understand/Intervene without this optional channel | no: Changes Dock counting for Agents currently in this state |
| S31 | error alert: false | Enables a macOS banner whose click opens the original Agent; settings-alerts | U5232a–h, P3 | unverified: vendor Notification hooks and macOS settings need per-channel equivalence/authority comparison | yes: Rail state and direct attention route satisfy Understand/Intervene without this optional channel | no: Enables a macOS banner whose click opens the original Agent |
| S32 | error sound: true | Enables one sound on this state transition; settings-alerts | U5232a–h, P3 | unverified: vendor Notification hooks and macOS settings need per-channel equivalence/authority comparison | yes: Rail state and direct attention route satisfy Understand/Intervene without this optional channel | no: Enables one sound on this state transition |
| S33 | error badge: true | Changes Dock counting for Agents currently in this state; settings-alerts | U5232a–h, P3 | unverified: vendor Notification hooks and macOS settings need per-channel equivalence/authority comparison | yes: Rail state and direct attention route satisfy Understand/Intervene without this optional channel | no: Changes Dock counting for Agents currently in this state |
| S34 | done alert: false | Enables a macOS banner whose click opens the original Agent; settings-alerts | U5232a–h, P3 | unverified: vendor Notification hooks and macOS settings need per-channel equivalence/authority comparison | yes: Rail state and direct attention route satisfy Understand/Intervene without this optional channel | no: Enables a macOS banner whose click opens the original Agent |
| S35 | done sound: false | Enables one sound on this state transition; settings-alerts | U5232a–h, P3 | unverified: vendor Notification hooks and macOS settings need per-channel equivalence/authority comparison | yes: Rail state and direct attention route satisfy Understand/Intervene without this optional channel | no: Enables one sound on this state transition |
| S36 | done badge: false | Changes Dock counting for Agents currently in this state; settings-alerts | U5232a–h, P3 | unverified: vendor Notification hooks and macOS settings need per-channel equivalence/authority comparison | yes: Rail state and direct attention route satisfy Understand/Intervene without this optional channel | no: Changes Dock counting for Agents currently in this state |

Each Alert, Sound and Dock badge switch is independent: 15 rows above, not one “notifications” choice. The row-level alert policy menu (`all / default / quiet`) is another feature and still needs its own assessment. P3 and native attention remain effective regardless of any optional channel choice.

## Individual shortcut settings and named actions

These are separate controls in `ShortcutSettings`, not hidden in a single “rebind keys” row. Exact default presses/scopes also need reconciliation against local registrations (listed in the App source catalogue). `recordable` allows one own press except quick add; Leader/multi-key rows are read-only references. A saved override adds Reset, subject to conflict refusal. The same named action is callable through `rup do`; no MCP tool bypasses its captured target or availability.

| Setting/action id | Label | Default keys | Arguments | Assessment status |
| --- | --- | --- | --- | --- |
| `agent.new` | New Agent | ⌘N | `[]` | Q1/Q2/Q3 per action pending; do not count unverified as no |
| `agent.new-with-prompt` | Agent with prompt | ⇧⌘N | `[{"key": "prompt", "type": "string"}]` | Q1/Q2/Q3 per action pending; do not count unverified as no |
| `workstream.new` | New Workstream | ⌥⌘N | `[]` | Q1/Q2/Q3 per action pending; do not count unverified as no |
| `mode.new` | New Mode | ⇧⌘M | `[]` | Q1/Q2/Q3 per action pending; do not count unverified as no |
| `leader.assign` | Assign / Ask | ⌘K A | `[]` | Q1/Q2/Q3 per action pending; do not count unverified as no |
| `leader.project` | Switch Project | ⌘K P | `[]` | Q1/Q2/Q3 per action pending; do not count unverified as no |
| `leader.changes` | Review changes | ⌘K C | `[]` | Q1/Q2/Q3 per action pending; do not count unverified as no |
| `leader.attention` | Next needs you | ⌘K J | `[]` | Q1/Q2/Q3 per action pending; do not count unverified as no |
| `leader.attention-other-project` | Needs you elsewhere | ⌘K ⇧J | `[]` | Q1/Q2/Q3 per action pending; do not count unverified as no |
| `leader.row` | Find row | ⌘K K | `[{"key": "query", "type": "string"}]` | Q1/Q2/Q3 per action pending; do not count unverified as no |
| `leader.bubble-minimise` | Minimise Bubble | ⌘K M | `[]` | Q1/Q2/Q3 per action pending; do not count unverified as no |
| `leader.bubble-close` | Close the Bubble | ⌘K W | `[]` | Q1/Q2/Q3 per action pending; do not count unverified as no |
| `leader.shelf` | Open the Bench | ⌘K B | `[]` | Q1/Q2/Q3 per action pending; do not count unverified as no |
| `leader.capture` | Capture a Todo | ⌘K T | `[]` | Q1/Q2/Q3 per action pending; do not count unverified as no |
| `leader.inbox` | Open the Inbox | ⌘K I | `[]` | Q1/Q2/Q3 per action pending; do not count unverified as no |
| `terminal.new` | New Terminal | ⌘T | `[]` | Q1/Q2/Q3 per action pending; do not count unverified as no |
| `leader.open` | More keys… | ⌘K | `[]` | Q1/Q2/Q3 per action pending; do not count unverified as no |
| `switcher.open` | Find anything | ⇧⌘P | `[]` | Q1/Q2/Q3 per action pending; do not count unverified as no |
| `attention.jump` | Next needs you | ⌃⌘J | `[]` | Q1/Q2/Q3 per action pending; do not count unverified as no |
| `todo.capture` | Capture a Todo | ⇧⌘T | `[]` | Q1/Q2/Q3 per action pending; do not count unverified as no |
| `terminal.switch` | Switch Agent / Terminal | ⌘B | `[]` | Q1/Q2/Q3 per action pending; do not count unverified as no |
| `rail.collapse-expand` | Collapse / expand | ← → | `[]` | Q1/Q2/Q3 per action pending; do not count unverified as no |
| `rail.move` | Move to… | M | `[]` | Q1/Q2/Q3 per action pending; do not count unverified as no |
| `rail.rename` | Rename | F2 | `[]` | Q1/Q2/Q3 per action pending; do not count unverified as no |
| `help.open` | Help | ? | `[]` | Q1/Q2/Q3 per action pending; do not count unverified as no |
| `agent.restart-mode` | Restart Mode | R | `[]` | Q1/Q2/Q3 per action pending; do not count unverified as no |
| `rail.remove` | Remove | ⌘⌫ | `[]` | Q1/Q2/Q3 per action pending; do not count unverified as no |
| `ask.open` | Focus Ask bar | ⌘/ | `[]` | Q1/Q2/Q3 per action pending; do not count unverified as no |
| `todo.assign-slot` | Assign | 1–9 | `[{"key": "slot", "type": "integer", "min": 1, "max": 9, "required": true}]` | Q1/Q2/Q3 per action pending; do not count unverified as no |
| `todo.open-draft` | Open | ⏎ | `[]` | Q1/Q2/Q3 per action pending; do not count unverified as no |
| `todo.add` | Add Todo | N | `[]` | Q1/Q2/Q3 per action pending; do not count unverified as no |
| `todo.assign` | Assign | O | `[]` | Q1/Q2/Q3 per action pending; do not count unverified as no |
| `shelf.maximise` | Maximise | M | `[]` | Q1/Q2/Q3 per action pending; do not count unverified as no |
| `todo.delete` | Delete row | D | `[]` | Q1/Q2/Q3 per action pending; do not count unverified as no |
| `todo.export` | Export .md | E | `[]` | Q1/Q2/Q3 per action pending; do not count unverified as no |
| `shelf.close` | Close | Esc | `[]` | Q1/Q2/Q3 per action pending; do not count unverified as no |
| `terminal.text-larger` | Larger Terminal text | ⌘= | `[]` | Q1/Q2/Q3 per action pending; do not count unverified as no |
| `terminal.text-smaller` | Smaller Terminal text | ⌘- | `[]` | Q1/Q2/Q3 per action pending; do not count unverified as no |
| `terminal.text-reset` | Reset text size | ⌘0 | `[]` | Q1/Q2/Q3 per action pending; do not count unverified as no |
| `editor.quote` | Quote | ⇧⌘B | `[]` | Q1/Q2/Q3 per action pending; do not count unverified as no |
| `editor.bullet-list` | Bullet list | ⌥⌘8 | `[]` | Q1/Q2/Q3 per action pending; do not count unverified as no |
| `editor.numbered-list` | Numbered list | ⌥⌘7 | `[]` | Q1/Q2/Q3 per action pending; do not count unverified as no |
| `editor.code-block` | Code block | ⌥⌘C | `[]` | Q1/Q2/Q3 per action pending; do not count unverified as no |
| `editor.italic` | Italic | ⌘I | `[]` | Q1/Q2/Q3 per action pending; do not count unverified as no |
| `editor.inline-code` | Inline code | ⌘E | `[]` | Q1/Q2/Q3 per action pending; do not count unverified as no |
| `terminal.find` | Find… | ⌘F | `[]` | Q1/Q2/Q3 per action pending; do not count unverified as no |
| `edit.undo` | Undo | ⌘Z | `[]` | Q1/Q2/Q3 per action pending; do not count unverified as no |
| `edit.redo` | Redo | ⇧⌘Z | `[]` | Q1/Q2/Q3 per action pending; do not count unverified as no |
| `settings.open` | Settings | ⌘, | `[]` | Q1/Q2/Q3 per action pending; do not count unverified as no |
| `settings.forward` | Forward → | ⌘] | `[]` | Q1/Q2/Q3 per action pending; do not count unverified as no |
| `todo.triage-enter` | Triage Todos | T | `[]` | Q1/Q2/Q3 per action pending; do not count unverified as no |
| `todo.triage-move` | Move | J K | `[{"key": "direction", "type": "choice", "options": ["up", "down"], "required": true}]` | Q1/Q2/Q3 per action pending; do not count unverified as no |
| `todo.triage-assign` | Assign | A | `[]` | Q1/Q2/Q3 per action pending; do not count unverified as no |
| `todo.triage-workstream` | Workstream | W | `[]` | Q1/Q2/Q3 per action pending; do not count unverified as no |
| `todo.triage-nest` | Nest | Tab | `[]` | Q1/Q2/Q3 per action pending; do not count unverified as no |
| `todo.triage-unnest` | Un-nest | ⇧Tab | `[]` | Q1/Q2/Q3 per action pending; do not count unverified as no |
| `todo.triage-done` | Done | X | `[]` | Q1/Q2/Q3 per action pending; do not count unverified as no |
| `todo.triage-comment` | Comment | C | `[]` | Q1/Q2/Q3 per action pending; do not count unverified as no |
| `todo.triage-leave` | Leave | Esc | `[]` | Q1/Q2/Q3 per action pending; do not count unverified as no |
| `project.choose-folder` | Choose Project… | ⌘O | `[]` | Q1/Q2/Q3 per action pending; do not count unverified as no |

## Direction still to reconcile

[Settings work order #3281](https://github.com/roundup-app/roundup/issues/3281), created 2026-10-22, records the owner's App-wide Settings and dark/light/system request; the current body was updated 2026-10-23. Retiring requested settings requires naming that direction; creation time alone does not date every later body clause. [State choices #5232](https://github.com/roundup-app/roundup/issues/5232), created 2026-10-31, records the accepted per-state choice outcome. Neither is proof of usage. Exact owner-comment dates and further linked direction remain to be checked before the final ask.
