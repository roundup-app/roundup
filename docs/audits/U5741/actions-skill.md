# U5741 Named action and skill decisions

Audited main: `01299e96848802dc5b4d7999453a0ffb0ebd89a9`. This continues the inventory with methods `daemon-project-pad.md` leaves undecided: `action.serve`, `action.list`, `action.userList`, `action.run`, `skill.status`, `skill.setup` and `skill.remove`. It is a source, declaration and scenario reconciliation: no fresh App rendering, runtime call or vendor probe is claimed. Candidate status authorizes no deletion. Real Agent Terminals, direct Agent access, native request continuation, the Ask and older-Project reopening stay required until the owner answers.

## Entry points and decisions

Declarations are in `crates/contracts/src/declarations.rs`, all `none(...)`: no MCP tool for either role. A production App caller is a non-test, non-fixture file under `apps/desktop/src` or `crates/desktop/src`, found by exact-string search.

| Row | Independent control and exact public entry points | App caller | Implementation / acceptance |
| --- | --- | --- | --- |
| AK01 | Register the open App as the answerer of named actions: `action.serve`; no `rup` command, no MCP tool (NA6) | `app/tauri.ts`, `app/seam.ts`, `crates/desktop/src/state.rs` (`action.serve`) | `scenarios/named-actions.md` NA6. |
| AK02 | List the open App's named actions: `action.list`; `rup actions` | `keys/actions.ts` (answers the relayed call), `app/seam.ts` (schema); `rup` in `crates/rup/src/cli/actions.rs` | NA5, NA6, NA11. |
| AK03 | List the User actions the owner's Extensions declared: `action.userList`; no `rup` command, no MCP tool | `switcher/Switcher.tsx` | NA6; Switcher scenarios. |
| AK04 | Run a named action with arguments: `action.run`; `rup do <name> [key=value…]` | `keys/actions.ts` (answers), `switcher/Switcher.tsx` (runs a User action), `app/seam.ts`; `rup` in `crates/rup/src/cli/actions.rs` | NA3, NA7, NA8, NA9, NA10, NA12. |
| SK01 | Read what skill and hook are installed: `skill.status`; `rup skill status` is the Adapter call by `rup`, not this method (`crates/rup/src/skill.rs` has no `skill.` RPC) | `settings/SkillSetting.tsx` | `scenarios/skill-setup.md` SK4, SK10. |
| SK02 | Install or update the skill and hook: `skill.setup`; `rup skill setup` as above | `settings/SkillSetting.tsx` | SK1, SK2, SK6, SK10. |
| SK03 | Remove the installed skill and hook: `skill.remove`; `rup skill remove` as above | `settings/SkillSetting.tsx` | SK5, SK10. |

## All three candidate criteria

Q1: vendor equivalence. Q2: no required five-stage journey action needs this independently offered control. Q3: information/setting with no action on or because of it. A yes on all three makes a candidate, never retirement permission.

| Row | Q1 | Q2 | Q3 | Disposition |
| --- | --- | --- | --- | --- |
| AK01 | **Not established.** | **No.** Without it no named action reaches the App: `rup do` and native request continuation fail. | **No.** | Not a candidate. Protected. |
| AK02 | **Not established.** | **No.** `rup actions` and the Switcher list depend on it. | **Yes:** a read. | Not a candidate: fails Q2. |
| AK03 | **Not established.** | **Yes on this evidence:** the journey names no User action; the Switcher only lists what an Extension declared. | **No.** Its rows run actions. | Not a candidate: fails Q3 and Q1. |
| AK04 | **Not established.** | **No.** Every key, menu and Switcher row, and `rup do`, runs through it (NA2). | **No.** | Not a candidate. Protected. |
| SK01 | **Not established.** | **Yes on this evidence:** the journey needs no skill state. | **Yes:** a read; but the Settings switch (SK10) is an action on it. | Not a candidate: fails Q1 and shares its owning control with SK02/SK03. |
| SK02 | **Not established.** | **Yes on this evidence.** | **No.** It writes the user's config folder. | Not a candidate: fails Q3 and Q1. |
| SK03 | **Not established.** | **Yes on this evidence.** | **No.** It deletes only what roundup installed (SK5). | Not a candidate: fails Q3 and Q1. |

No row is a candidate on this evidence. The Settings switch and `rup skill` commands are the `settings.md` and `public-commands.md` rows; this file adds only the Daemon methods.

## Dependencies

AK01 to AK04 are one chain: `rup do`, `rup actions`, shortcuts and Switcher rows meet in the App's answerer (NA2). Removing any would change native request continuation. SK01 to SK03 serve one Settings switch and read user-owned files; dropping the methods leaves the files, and any change to their representation needs an older-Project reopening proof only if Project data changes (none is stored per Project).

## Remaining

Vendor Q1 comparisons, a fresh runtime role census, a User-action Extension caller census for AK03, and the other undecided methods (`ask.*`; `rail.*` deletion/group/redo/restore/tree/removeSelection; `todo.*` references/history/reorder/deletion; `workstream.*` queue methods) stay unfinished. No owner choice or deletion is made.
