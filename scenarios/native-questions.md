# Native questions and permissions

Work order: [#3564](https://github.com/saadshahd/roundup/issues/3564). Ids: A3564a–A3564f. This is acceptance for implementation; merging this specification delivers no runtime change and leaves the Issue open.

Scope (policy): remove roundup's question/permission interception and presentation across App, Daemon, agents, CLI, MCP, contracts, generated bindings, documentation and proofs in one Contract change. The owner authorizes the module-directory exception. Prefer one implementation PR; if split, each PR removes a complete layer with all its callers, and the next follows immediately. No removed method may retain a caller. #3563 owns removal of every hold, Takeover, ask-first Routes and input guards; this Issue owns removal of automatic question bubbling and its final wait for the user. Keep Agent-to-Agent questions and replies as ordinary Messages. Coordinate shared edits on the Issues; do not expand this work into a replacement conversation UI or transport. No new RPC or question protocol is requested.

The first journey's Intervene stage is satisfied here by selecting the requesting Agent's Terminal, answering there and observing it continue. This supersedes the custom-answer requirement in that stage, without claiming a new journey audit. The implementation updates the active principles and domain documentation to agree; frozen loop files remain user-owned.

**A3564a the user answers in the requesting Agent's Terminal.** Given a user-started Agent, a Door, a scout and an ordinary Subagent, each with its own Terminal, when each invokes Claude Code's native `AskUserQuestion`, then the question remains in that Agent's vendor conversation, the user answers using the vendor control in that Terminal, and the waiting call receives that answer once. roundup provides no question form, permission form, answer buttons, preview card, answer history, folded answer line or revoke action in the centre, Inbox, Rail or timeline. Selecting the Agent still opens its Terminal; an attention entry opens and focuses that same Terminal rather than an App form. An Agent's question or permission prompt cannot be answered by another Agent through roundup, including through Terminal-write/prompt capabilities. User typing remains available. Do not replace the removed tools with keystrokes or another MCP elicitation form (policy).

Observers: `a3564a_native_question_uses_only_the_requesting_terminal` in `crates/rupd/tests/` drives a fake vendor through the production launch and public Daemon seams, observes its native question/answer exchange and continuation, and asserts one returned answer and zero roundup-authored answer bytes. `a3564a_attention_opens_the_requesting_terminal` in `apps/desktop/src/testing/` mounts the actual App with the existing fake App seam to observe Rail pointer selection and keyboard opening focus the requesting Terminal. The real native prompt, user answer and continuation stay in `a3564a_native_question_uses_only_the_requesting_terminal`; A3564e retains the real rendered Rail and Inbox attention activation, Terminal answering and continuation observer. Repeating the real vendor/Daemon startup in the Rail focus observer is not required. Parameterize Agent roles at the launch seam; do not multiply expensive browser runs. `a3564a_native_prompt_accepts_only_user_input` probes authenticated Agent and user calls at the existing input-authorization seam while a native question or permission prompt is active: Agent prompt/write attempts fail with zero input bytes, while user input reaches the requesting Terminal. It introduces no vendor-screen parser. The critic observes the absence of the removed presentation on the rendered densest seed, rather than a test asserting layout or copy. Fake-vendor success proves wiring, not Claude Code's renderer (A3564e).

**A3564b native permissions keep the user's configuration.** Given the user's settings, hooks, environment, configured auto mode and allow/ask/deny rules, when any of those four Agent roles starts or resumes, then roundup preserves A3507's configuration precedence and adds no permission interception or auto-allow workaround. It neither changes the user's source settings nor installs a permission-answer hook, prompt tool, permission rule or environment override to replace the removed path. Existing explicit user-selected permission modes and YOLO remain their own contracts; this Issue adds no permission choice. A lean tool allowlist includes `AskUserQuestion` with and without roundup MCP, retaining its other role restrictions. Routine state hooks may observe a native request but cannot hold it, answer it or change its outcome. The vendor's own prompt/auto behavior determines whether a particular tool needs user input (policy).

Observer: extend the production-command construction fixtures in `crates/agents/tests/launch/lean.rs` as `a3564b_native_questions_preserve_each_roles_setup`, covering all production roles, MCP on/off, start/resume, an auto default, conflicting allow/ask/deny entries and a user-owned permission hook. Assert effective user settings and source-file equality, native question availability, absence of roundup interception and absence of new allow/bypass defaults without spawning a program. Reuse A3507a's gateway guard and A3507b's precedence assertions; do not duplicate them. Retain state-hook Status tests with their custom-store dependencies removed. A native request can produce `needs-you` without a roundup-owned question record; answering and subsequent normal observations resume working/idle without one (assert in A3564a's fake-vendor exchange). The implementation amends P3's one-record-per-needs-you rule accordingly (policy).

**A3564c Agents ask and reply through their inboxes.** Given two fake Agents in one Project with working Claude inboxes and auto Routes, when the first sends the second a `question` Message through its authenticated public MCP tool and the second sends a `note` reply naming that Message in `replyTo`, then the second receives the exact question and original sender/id through its inbox, and the first receives the exact reply, reply link and answering identity through its own inbox once. Neither delivery types Terminal input, opens a user question/permission view, nor invokes the native user-question tool. Passing the former hop bound and replaying idle edges creates no forwarded question, parent notification or Message to the user. Native user questions and permission prompts remain exclusively the user's channel. Each role's Brief directs peer questions to Messages and user questions to `AskUserQuestion`, including the no-roundup-MCP Brief's existing CLI route for peer Messages (policy).

Observer: `a3564c_two_agents_exchange_a_question_and_reply_without_a_view` in `crates/rupd/tests/` uses the real Daemon, authenticated public MCP calls and two fake inbox peers; inspect the actual peer entries and transcript receipts plus durable Message records, count both deliveries and Terminal writes, and drive the old timeout as an injected clock event. Extend the existing B50 question-identity fixture instead of writing another transport harness. `a3564c_each_brief_separates_peer_and_user_questions` in `crates/agents/tests/launch/guidance.rs` asserts the two instructions in each production role/MCP variant's delivered Brief. No App is started for the peer exchange.

**A3564d the removed machinery has no callers or stored authority.** Given an existing Project data folder from before removal, including past custom answers, remembered permission scopes and a pending bubbling question, when the new Daemon opens it, then it opens successfully, starts no vendor program by itself, grants no permission from roundup's former records and produces no forwarded question or user-answer wait. Existing unrelated Agents, Todos, Pads, Routes and ordinary Message bodies/identities remain readable. A pending old hop is terminally dropped with a cause, never silently delivered to a new receiver; an already delivered Message remains final. Do not silently erase unrelated Project data or modify the user's Claude Code configuration. Observe these outcomes in `a3564d_existing_project_opens_without_custom_question_authority` in `crates/rupd/tests/` using a pre-removal database fixture and the actual migration/open path. Old answer-only storage may be removed (policy); A3564b proves that the user's own vendor rules survive.

Contracts, generated bindings, runtime stores, event variants, App seam commands, CLI commands, MCP offerings, proof models and callers are removed together (policy). `a3564d_removed_question_methods_are_not_offered_or_dispatched` in `crates/rup/tests/mcp/` uses the real MCP/CLI dispatch and Daemon method lookup: the retired methods/tools in the retirement inventory are absent from discovery and calls fail as unknown, with zero effects. This is a contract probe, not only a source-text check. Regenerate `contracts/generated/` from `crates/contracts`; do not hand-edit it. Preserve other caller identity, Reach and Terminal authority checks when moving shared code out of the deleted store (policy).

The Message contract touches M1 (no duplicate delivery), M2 (removing the final user wait), M4 (order), M5 (final states), M6 (no silent loss), M8 (removing bubbling), M9 (replay) and M10 (delivery); M3's removal belongs to #3563 and M7's receiver-gone behavior remains. Update `docs/messages.md`, Rust transitions, model, laws, proof runner and mutants together. Preserve the surviving laws and retire the obsolete bubbling law explicitly by name; do not keep a trivially true placeholder. V3/V7's blanket prohibition on deleting a law is superseded only for the behavior the owner removes here and in #3563; independent Contract review still applies. `just proofs` exits 0 and prints `ALL PROOFS CHECK`; the surviving law mutants still fail (policy: implementation review's proof observer). Retirement names are recorded below, not left as active proof obligations.

**A3564e the rendered intervention continues through the native tool.** Policy observer: at implementation head, use the isolated headless real-Daemon harness in dark mode at 1512×950 with ten Agents, long names and a visible seeded failure. Select a Workstream Door and a child, trigger each native question and a permission prompt with the fake vendor, answer through each Terminal, and observe work continue. Open Inbox and timeline: their attention actions select the requesting Terminal; no removed answer view remains. Capture before/after with `just capture A3564a A3564e` under `artifacts/ux/<id>/`, including D2, D5 and D6 readings and the visible failure cause/action. Only Tokens style remaining App controls; every Check passing on main still passes. These are rendered observers, not layout assertions in UI tests. No images/videos are committed.

Policy: on the user's Mac at the implementation commit, compare plain Claude Code and an Agent in the same Project with the same login, settings and installed version. Ask a native question, answer it, and observe the same conversation continue; exercise a tool that prompts under those settings and verify the user's permission choice applies. If auto/allow rules skip that prompt in plain Claude Code, matching non-interruption in roundup is success; do not change settings to manufacture a prompt. Record commit, vendor version and outcomes on #3564, without credentials. This observes real vendor/native behavior; Linux fake-vendor evidence does not claim it. The specification run requires no Mac observation.

**A3564f CI prevents reintroducing the custom path.** Given any tracked source under `apps/desktop/src`, `crates/*/src` or `crates/contracts`, when it contains any forbidden literal in the retirement inventory, then a required CI lint or test exits nonzero and names each violating file/token. A clean scan exits 0. Include generated or untracked files only where the implementation's chosen scanner already treats them as source; the tracked boundary above is mandatory. Observe the scanner with a clean fixture and one row per forbidden token/path family, each independently failing with exit 1; unreadable/missing scan roots fail with exit 2 rather than a clean result. `a3564f_custom_question_guard_rejects_each_token` is the scanner's fixture test. Wire it into an existing required lint/test entry outside frozen loop machinery; no workflow, loop script or agent-prompt change is authorized. The scanner must not match its own token definitions; represent those definitions without a contiguous banned literal in scanned source (policy).

Policy: the implementation also scans all tracked non-frozen source, bindings, tests, docs, glossary and active scenarios for the retirement patterns below, removing or renaming each live occurrence and retaining old names only in explicitly labelled scenario retirement notes. A matching unrelated identifier is renamed with its callers and glossary entry while preserving behavior, not deleted merely to satisfy a search. Remove dead fixtures, CSS, imports, tests and seed data; adapt mixed observers to native intervention. Each removed test records its scenario retirement or the surviving test proving its remaining clause. This broad cleanup is not satisfied by deleting only the view.

## Retirement inventory (policy; old names appear here to identify removal)

Retirement patterns: case-sensitive `Decision`, `ask_user`, `Grant`, and case-insensitive `escalat`. CI-forbidden literals: `ask_user`, `DecisionCard`, `decision.answer`. The definitions here are scenario retirement notes, outside the guard's source roots.

Guard fixture matrix (each row is independent; the failing result includes the file and matched token):

| Fixture input | Exit |
|---|---:|
| Clean source in all three root families | 0 |
| `ask_user` in App source | 1 |
| `DecisionCard` in App source | 1 |
| `decision.answer` in App source | 1 |
| `ask_user` in a crate source | 1 |
| `DecisionCard` in a crate source | 1 |
| `decision.answer` in a crate source | 1 |
| `ask_user` in contracts | 1 |
| `DecisionCard` in contracts | 1 |
| `decision.answer` in contracts | 1 |
| Missing scan root | 2 |
| Unreadable scan root | 2 |

Remove `apps/desktop/src/decisions/` completely: AskCard, DecisionCard, FoldedLine, decisions.ts, permission.ts, fixtures, CSS and tests; remove connectedProject's decisions state and renderers in Inbox, Rail, timeline and folded lines. Remove Decision, Answered Decision, Failed answer, Prompt identity where exclusive to this path, Grant, Escalated question and exclusive Card kinds from `GLOSSARY.md`; remove references in Reach, Touch, measurement, Ask and Agent scope definitions without deleting their unrelated meaning.

Remove the `ask_user`, `decision_list`, `decision_answer` MCP tools, `rup agent ask`, `rup permission`, `agent.ask`, `agent.permission`, `decision.list`, `decision.answers`, `decision.capture`, `decision.answer`, `decision.revoke`, their type/event families, proof/stdin/App-seam plumbing used only by these answers, and Agent-on-Agent Decision answering. Remove the Brief's H14b guidance and all other custom question tool mentions, Decision notices and grant advice. Remove hooks that convert permissions/tool calls into Decisions, remembered Grant storage and roundup's permission reply synthesis. Keep native `AskUserQuestion`; no Agent may use it to answer another Agent. Delete bubbling timers/hops/pass handling and escalated-question state/reasons, retaining ordinary question Messages and replyTo.

Retire each whole scenario below by id/name, replacing its active text with a retirement note pointing to A3564a–f. Old historical observations may be retained only without active acceptance or dead-code instructions:

| File | Scenarios retired completely |
|---|---|
| Permission scenarios (canonical retired headings below) | H1 reply recording; H1b remaining observations; H2 opening; H3 answering; H4 proof/Reach; H5 reload; H6 Agent end; H7 Terminal clearing; H8 hook failure; H9 permission routing; H10 permission chain; H18 App proof; H21 Agent answers; H22 formatted args; H23 scopes and revoke |
| `scenarios/control.md` | H14 MCP question; H14b Brief question rules |
| `scenarios/ui-decisions.md` | U113 selected answer; U194 uncovered answers; U383 answer distinction; U434 Allow leads; U400 native-question Card; U406 custom-question Card; U3750 unavailable question; U3794 permission Card; U3795 folded answer/revoke |
| `scenarios/door-terminal.md` | U468a App question answer |
| `scenarios/messages.md` | B13 hops; B14 hop bound; B15 escalated question; B16 skipped hops; B17 bubble answer; B18 permission bubble exclusion; B31 end-of-bubble terminology; B38 Decision notice wait |
| `scenarios/daemon.md` | D13 atomic Decision publication |
| `scenarios/unfinished-input.md` | U2773d original custom-answer authority |
| `scenarios/journey.md` | J9 Decision-button audit |

Amend only the obsolete clauses in these mixed scenarios; retain their unrelated acceptance and observers:

| File | Clauses replaced/removed |
|---|---|
| `scenarios/agents.md`, `scenarios/awareness.md`, `scenarios/control.md` | A1/A2 native-request Status without a custom store; A4 normal state hooks; A11 custom tool offering; E1 old Brief tool; H13 custom clearing; H16 answer-path exclusions; H15 fixed state-event inventory if interception removal changes it |
| `scenarios/door-terminal.md`, `scenarios/ui-first-journey.md` | M16 Agent answers/answer keystrokes; U468 Door-answer records and old permission hook; U166 App permission response; U351 custom-store-backed needs-you fixture; retain selection, Status and continuation with native observers |
| `scenarios/ui-inbox.md` | U3770a custom-answer row source; U3770b quick answers/Open card; U3770c answer confirmation/fold/next-question; retain grouping, terminal attention and Retry |
| `scenarios/unfinished-input.md` | U2773a/b custom-answer category/note/settlement clauses; retain every remaining editable surface; no vendor-editor reconstruction |
| `scenarios/messages.md` | B10 escalated exception; B12 message.pass; B26 final-wait logging; B37 Decision notice fixture; B45 retired-tool inventory; B50–B52 bubbling/final-wait clauses; retain question inbox delivery, receipts, replay and identity |
| `scenarios/mcp.md`, `scenarios/lean-child-start.md`, `scenarios/plain-text.md` | M1/M4/M5/M7/M9/M11/M17 retired tools, Reach and acknowledgements; LC1–LC4/LC6/LC11 native question availability/custom tools; Q2/Q6/Q7/Q10 custom-question output |
| `scenarios/proofs.md` | V3's `m2_held_leaves_only_by_its_owner` escalated branch and `m8_escalation_terminates`; V4b's bubbling model/replay/mutant obligations; retain restart proof; coordinate all-hold law removal with #3563 |

All other citations in active scenarios, domain/architecture docs, `docs/permission-decisions.md`, `docs/control-channel.md`, `docs/messages.md`, evidence and fixtures are cleaned by the broad scan in A3564f. Mixed visual audits lose only the removed sites. Repeated ids in prose are not retained as live requirements. P3 becomes native attention/continuation with no Decision invariant; P11's replacement-question/draft clauses lose only the removed App form. The shared journey and harness data may be updated to native intervention under their allowed paths; no other frozen machinery is edited.

## Checks on origin/main (baselines, not implementation evidence)

1. `crates/agents/src/claude_code/profiles.rs`, `DOOR_TOOLS`, `DOOR_TOOLS_NO_MCP`, `SCOUT_TOOLS`, `SCOUT_TOOLS_NO_MCP` and `PROFILES` hold the current lean tool restrictions. `crates/agents/src/claude_code/launch.rs`, `Launcher::settings_json`, builds the permission hook.
2. `crates/agents/src/claude_code/brief.rs`, `text` and `with_tools`, assemble role/MCP guidance. `crates/agents/tests/launch/guidance.rs`, `h14b_the_brief_carries_the_ask_user_rules`, proves the retired instructions.
3. `crates/rupd/tests/b50_note_inbox.rs`, `b50_an_inbox_question_preserves_its_message_and_reply_identity`, already proves question envelope/receipt identity; it does not prove the two-Agent reply exchange. `crates/agents/tests/inbox.rs`, `b50_a_question_carries_kind_and_reply_id_in_the_peer_entry`, proves encoding.
4. `crates/agents/src/decision.rs`, `Decisions::list`, `Shared::permission` and `Shared::ask`, hold the custom store/call lifetimes. `crates/contracts/src/methods.rs`, `METHODS`, declares its methods; the canonical retired headings below, H2–H10/H18/H21–H23, and `scenarios/control.md`, H14/H14b, hold the acceptance being retired.
5. `scenarios/messages.md`, B13–B18 and B50–B52, specify bubbling and inbox transport. `crates/messages/src/hops.rs`, `settle`, handles the chain; `scenarios/proofs.md`, V3 and V4b, and `docs/messages.md` hold its laws/model agreement requirements.
6. `docs/design-system.md`, **The checks**, defines D2/D5/D6; `scenarios/door-terminal.md`, U467/U468/U468a, and `scenarios/ui-inbox.md`, U3770a–c, hold the current intervention surfaces. `scenarios/agents.md`, A3507a–e, holds preservation of the user's setup.

Applicable gates (policy): P3 — can routine progress interrupt, or can native attention fail to lead to the requesting Terminal and continuation? Observe A3564a/e. P4 — does launch replace the user's setup or expose vendor parsing outside its Adapter? Observe A3564b and the Adapter diff. P9 — is an answer/prompt typed automatically, or does cached launch material change mid-Attempt? Observe zero answer writes and retained launch immutability. P11 — does removing the App form lose work on a surviving editable surface or reconstruct vendor input? Retain its affected navigation/draft observers. P1/P6 — can a stopped Door delete its Workstream or make another Agent inaccessible? Retain existing direct-selection and stopped-Door observers. Message safety/replay is A3564c/d's Contract observer. These gates cover changed paths, not unrelated product gaps.

## Finished-work retirement entries (policy)

**T5402 retired.** Completed engineering order #5402; retired after completion. Its behavioral scenarios and surviving test observers remain required.

**T5381 retired.** Completed engineering order #5381; retired after completion. Its behavioral scenarios and surviving test observers remain required.

**T3209 retired.** Completed engineering order #3209; retired after completion. Its behavioral scenarios and surviving test observers remain required.

**U4983 retired.** Completed engineering order #4983; retired after completion. Its behavioral scenarios and surviving test observers remain required.

**U3119a retired.** Measurement collection and storage were removed by U4454d (`scenarios/remove-time-timeline.md`); their tests retired with the code.

**U3119b retired.** Measurement collection and storage were removed by U4454d (`scenarios/remove-time-timeline.md`); their tests retired with the code.

**N9 retired.** Retired by N20 (`scenarios/project-store.md`): pre-release historical schema adoption and recovery are not required; current-schema persistence and transaction guarantees remain.

**N10 retired.** Retired by N20 (`scenarios/project-store.md`): pre-release historical schema adoption and recovery are not required; current-schema persistence and transaction guarantees remain.

**N11 retired.** Retired by N20 (`scenarios/project-store.md`): pre-release historical schema adoption and recovery are not required; current-schema persistence and transaction guarantees remain.

**U3748 retired.** Replaced by U3530a–c (`scenarios/ui-scrollbar-overflow.md`): scrolling activity replaces hover; overlay, containment and no-resize acceptance remains there.

**U3749 retired.** Replaced by U3530a–c (`scenarios/ui-scrollbar-overflow.md`): scrolling activity replaces hover; overlay, containment and no-resize acceptance remains there.

**H1 retired.** Retired by A3564a–f in this file: the user answers in the requesting Agent’s Terminal; roundup keeps no custom question/permission store, answer path or view.

**H1b retired.** Retired by A3564a–f in this file: the user answers in the requesting Agent’s Terminal; roundup keeps no custom question/permission store, answer path or view.

**H2 retired.** Retired by A3564a–f in this file: the user answers in the requesting Agent’s Terminal; roundup keeps no custom question/permission store, answer path or view.

**H3 retired.** Retired by A3564a–f in this file: the user answers in the requesting Agent’s Terminal; roundup keeps no custom question/permission store, answer path or view.

**H4 retired.** Retired by A3564a–f in this file: the user answers in the requesting Agent’s Terminal; roundup keeps no custom question/permission store, answer path or view.

**H5 retired.** Retired by A3564a–f in this file: the user answers in the requesting Agent’s Terminal; roundup keeps no custom question/permission store, answer path or view.

**H6 retired.** Retired by A3564a–f in this file: the user answers in the requesting Agent’s Terminal; roundup keeps no custom question/permission store, answer path or view.

**H7 retired.** Retired by A3564a–f in this file: the user answers in the requesting Agent’s Terminal; roundup keeps no custom question/permission store, answer path or view.

**H8 retired.** Retired by A3564a–f in this file: the user answers in the requesting Agent’s Terminal; roundup keeps no custom question/permission store, answer path or view.

**H9 retired.** Retired by A3564a–f in this file: the user answers in the requesting Agent’s Terminal; roundup keeps no custom question/permission store, answer path or view.

**H10 retired.** Retired by A3564a–f in this file: the user answers in the requesting Agent’s Terminal; roundup keeps no custom question/permission store, answer path or view.

**H18 retired.** Retired by A3564a–f in this file: the user answers in the requesting Agent’s Terminal; roundup keeps no custom question/permission store, answer path or view.

**H21 retired.** Retired by A3564a–f in this file: the user answers in the requesting Agent’s Terminal; roundup keeps no custom question/permission store, answer path or view.

**H22 retired.** Retired by A3564a–f in this file: the user answers in the requesting Agent’s Terminal; roundup keeps no custom question/permission store, answer path or view.

**H23 retired.** Retired by A3564a–f in this file: the user answers in the requesting Agent’s Terminal; roundup keeps no custom question/permission store, answer path or view.

**U3016a retired.** Measurement collection and storage were removed by U4454d (`scenarios/remove-time-timeline.md`); their tests retired with the code.

**U3016b retired.** Cost and token accounting were removed by #3574 and P14; U4454d (`scenarios/remove-time-timeline.md`) removes the remaining measurement collection and storage.

**U3016d retired.** Measurement collection and storage were removed by U4454d (`scenarios/remove-time-timeline.md`); their tests retired with the code.

**U3016e retired.** The Time view, including its weekly limit line, was removed by U4454a–b (`scenarios/remove-time-timeline.md`); its tests retired with it.

**U3016f retired.** The Time view, including its weekly limit line, was removed by U4454a–b (`scenarios/remove-time-timeline.md`); its tests retired with it.

**U3016g retired.** The Time view, including its weekly limit line, was removed by U4454a–b (`scenarios/remove-time-timeline.md`); its tests retired with it.

**U3016h retired.** The Time view, including its weekly limit line, was removed by U4454a–b (`scenarios/remove-time-timeline.md`); its tests retired with it.

**U3016k retired.** The Time view, including its weekly limit line, was removed by U4454a–b (`scenarios/remove-time-timeline.md`); its tests retired with it.

**U3016l retired.** Measurement collection and storage were removed by U4454d (`scenarios/remove-time-timeline.md`); their tests retired with the code.

**U3016m retired.** Measurement collection and storage were removed by U4454d (`scenarios/remove-time-timeline.md`); their tests retired with the code.

**A2961 retired.** Completed engineering order #2961; retired after completion. Its behavioral scenarios and surviving test observers remain required.

**A2961b retired.** Completed engineering order #2961; retired after completion. Its behavioral scenarios and surviving test observers remain required.

**T4982a retired.** Completed engineering order #4982; retired after completion. Its behavioral scenarios and surviving test observers remain required.

**T4982b retired.** Completed engineering order #4982; retired after completion. Its behavioral scenarios and surviving test observers remain required.

**T3421a retired.** Completed engineering order #3421; retired after completion. Its behavioral scenarios and surviving test observers remain required.

**T3421b retired.** Completed engineering order #3421; retired after completion. Its behavioral scenarios and surviving test observers remain required.

**T3421c retired.** Completed engineering order #3421; retired after completion. Its behavioral scenarios and surviving test observers remain required.
