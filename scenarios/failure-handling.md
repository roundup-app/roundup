# Failure handling

Module: `apps/desktop/src` with the link reader's callers, and `crates/desktop/src/state.rs` for U6249b's reopen delays. Ids: U3791a–U3791c, U6249a–U6249e.

Policy amendment — owner decision of 2026-11-05 (#6249, below): U6249b replaces U3791a's one-retry-with-no-delay for automatic reads with four backed-off retries, and its 250 ms / 500 ms Daemon reopen waits with 1, 3 and 9 s. Every other U3791a clause stands: local writes repeat once, and a remote mutation, Message, Agent launch, Terminal write, clipboard action or native confirmation is never replayed. U3791c's one-line-per-scope ownership stands; U6249d adds what the line holds.

Acceptance for Issue #3791, using its owner-approved E1–E3. This specification delivers no runtime behavior. Implementation work and dependencies live on GitHub Issues, not here. The referenced `docs/quality-target.md` is absent on main; the Issue's Acceptance is the authority.

## Ownership and seams

Policy: recover at the existing owner, not in each rendering caller. App reads cross `apps/desktop/src/app/seam.ts`; local persistence belongs to `apps/desktop/src/state/storage.ts`. Native `crates/desktop/src/state.rs` (`AppState::start_daemon`, `AppState::mark_exited`) owns Project processes, using `crates/desktop/src/daemon.rs` (`start`, `watch_exit`). The webview does not become a second process supervisor. Test App behavior through its existing seam and native process behavior through the desktop owner; use fake time for delays. New RPC fields, typed refusal causes or App seam notifications follow the Contract recipe, updating every caller and generating contracts from Rust. No new domain entity is required.

**U3791a recover once before showing a failure.** Given an open Project and a read or local persistence operation, when its first attempt rejects or returns a failure, then:

- Retry the same captured operation once automatically, with no failure text, Retry control, toast, attention or focus change between attempts. The retry uses the original Project, target, revision and value. A successful retry returns the real result and exposes no new failure. Assert in planned `u3791a_read_recovers_once` and `u3791a_local_write_recovers_once` through the App/storage seams, checking underlying call counts and retained data.
- If both attempts fail, stop at two calls and expose the second failure with its recovery action. Preserve the last valid read result, exact recoverable input and stored records; never report an empty result or successful save. A later explicit Retry starts a new two-attempt operation, and acknowledged recovery clears only its owned failure. Assert in planned `u3791a_second_failure_is_actionable` and `u3791a_retention_failure_keeps_revisions`.
- Local write means replace/remove of captured local persistence state, such as `localStorage.setItem`/`removeItem`, not a Daemon mutation. A read may be reissued; a local write may be repeated only against the same captured state without overwriting a newer revision. Domain validation failures (invalid saved JSON/schema or the draft size bound) remain actionable without repeating parsing or validation. Assert in planned `u3791a_retry_keeps_original_revision`; retain the existing invalid-record and capacity observers in Check 4.
- A remote mutation, Message delivery, Agent launch, Terminal write, clipboard permission action or native confirmation is never replayed by this policy. In particular, an unknown remote outcome stays unknown and keeps its submitted draft; retrying a failed read must not resubmit the command that led to it. Assert in planned `u3791a_remote_commands_are_not_replayed` using known refusals, INTERNAL, UNKNOWN_OUTCOME and an untyped disconnect, checking one mutation call and exact retained drafts.
- Policy: use one additional attempt at the owning seam, not nested retries in transport and view. Synchronous storage remains synchronous. Retain `storageRetry` and other Retry labels/callers only for exhausted failures or existing explicit command recovery; remove dead copy and callers, not useful recovery after two failures. Audit every current caller, not a fixed count of labels.

Given an open Project whose Daemon unexpectedly exits, then:

- Count that exit as failure 1; automatically attempt restart after 250 ms. If startup fails before readiness, count failure 2 and retry after 500 ms. On failure 3 stop automatic attempts and show one Project-owned cause and Reopen action. No failure line appears for failures 1 or 2. Assert in planned native `u3791a_daemon_restart_has_bounded_backoff` with controlled readiness failures and time, and App `u3791a_daemon_third_failure_is_visible` through the seam. No zero-delay loop or continuing retries after exhaustion.
- A restart succeeds only after `daemon.ping` and replacement connection/subscription setup succeed. It clears the failure count and owned failure, refreshes the Rail, Terminals, Todos and Pads, and replaces the old connection as a whole. The next unexpected exit starts again at failure 1. Reopen after exhaustion uses the same bounded recovery policy. Assert in planned `u3791a_daemon_success_resets_count` and `u3791a_reconnected_project_refetches`.
- During recovery keep the last known content and drafts; disconnected Terminal writes/resizes and Agent launch/stop remain disabled. Starting a Daemon alone starts no Agent, replays no command or Message and reconstructs no vendor editor. Closing the Project or App cancels pending restarts, including a late startup; an old exit cannot replace a newer connection. Counts and cancellation are per Project. Assert in planned `u3791a_close_cancels_restart`, `u3791a_restart_is_project_scoped` and `u3791a_recovery_sends_no_agent_input`.

Policy: this narrows U25 and U37 (`scenarios/ui.md`) only in automatic recovery and exit-line timing: their disconnected-input protection, retained Rail and whole-connection/refetch behavior remain. Their immediate-exit-text tests are replaced by the third-failure observer, not left asserting the old timing. Other tests affected only by the extra read/storage attempt inject two failures when they intend to exercise an exhausted failure; retain their original identity, mutation-count and draft assertions.

**U3791b codes determine copy and outcomes.** Given an error from the Daemon or desktop adapter, then:

- Every integer constant in `rpc::code` has an explicit App copy entry; the table's domain is derived from `crates/rpc/src/error.rs`, never a hand-copied count. Planned `u3791b_every_rpc_code_has_copy` extracts that module's constants and fails for any missing entry, including a newly added constant. Unknown codes have actionable generic copy without being treated as known refusal. Detailed diagnostics stay available without controlling classification.
- No production App module, including `copy.ts`, selects behavior or copy by matching an error/reason/cause string with a regex, equality, `startsWith`, `includes`, case folding or another text classifier. Typed Daemon codes/discriminants determine the result. Replace `importRowRefusal`, `importExcludedReason` and any other error-text classifier discovered by the same scan; do not rename a string match to hide it. Planned `u3791b_copy_depends_on_codes_not_messages` varies diagnostic text with the same code/cause and checks the same behavior, then holds text constant and varies codes/causes to check different behavior. Policy: review and the App source audit cover every classifier, including extraction helpers and `orders/WorkProgress.tsx` (`sentence`). Ordinary user text search is unaffected.
- One exported function maps a thrown value to `failed` or `unknown`. PARSE_ERROR, METHOD_NOT_FOUND, INVALID_PARAMS, NOT_FOUND, FORBIDDEN, CONFLICT, BUSY, NOT_RUNNING, EVENTS_EXPIRED and INBOX_UNAVAILABLE map to failed. INTERNAL, UNKNOWN_OUTCOME, NOT_ACCEPTED and NOT_ACKED map to unknown: a missing acknowledgment does not prove that input had no effect. Untyped throws and unrecognized codes also map to unknown. A timeout is never evidence of refusal. Planned `u3791b_thrown_outcome_preserves_uncertainty` covers every existing RPC code plus unknown code, Error, primitive and null throws at this function; connected submit tests retain submitted revisions for unknown outcomes.
- All ten files listed in the baseline below call this function instead of classifying INTERNAL or -32004 inline, including both checks in PadDrawer. Other App thrown-outcome classifiers, including Project rename and model-menu handling, use it where they classify the same uncertainty; preserve operation-specific reconciliation. Policy: the source audit finds no duplicate generic classifier, and every changed public function has a caller or behavioral test.

Policy: keep error identity from Daemon to App. If prose-only rejection causes need typed contract data, add it and migrate all producers, consumers, schemas, generated contracts and fixtures in the same contract PR; do not fabricate a code by reading the old message at either end. Message/Route/Held/Takeover changes must state touched M1–M10 laws and keep proofs and documentation agreeing; no delivery law is weakened to achieve retry.

**Import failure** (`ImportFailure`, `ImportOutcome.error`): The original RPC error of one imported source, with its `code`, diagnostic `message` and Import disposition.

**Import disposition** (`ImportDisposition`, `outcome`): Whether a per-source result proves refusal (`failed`) or leaves completion unconfirmed (`unknown`).

**Thrown outcome** (`outcomeOf`): The App seam’s classification of a thrown value: `failed` only for a known RPC refusal; `unknown` for INTERNAL, lost replies, missing acknowledgments, foreign throws and unrecognized codes. Operation-specific authoritative reconciliation still decides what happened. Diagnostics never select the outcome.

**U3791c one owned failure line, no swallowed rejection.** Given two open Projects, then:

- A failure is keyed by its original Project, scope and kind. Scope is the existing owning surface: Project connection, Rail, Shelf collection, item editor/Drawer, Terminal, Ask, import or draft recovery; item-scoped surfaces also retain the original item identity for clearing. Kind is read, local persistence, command, connection or clipboard. For the same Project/scope/kind at most one line renders across that scope's views: a later failure replaces its cause and owned target rather than appending a line or repeating it in a toast and inline. Independent scopes/kinds remain independent. Planned `u3791c_same_scope_failure_replaces` exercises two sources and two items of the same kind, then distinct scopes/kinds and Projects through connected App owners, asserting roles and failure counts, not exact prose or layout.
- Acknowledged recovery, deletion of the line's current item or explicit dismissal clears only that owned failure. A late success/deletion for the item replaced by a newer failure clears nothing belonging to the newer item. A failed delete stays actionable; collection/connection failures are not cleared by unrelated item deletion. Replacement/dismissal never discards a draft. Planned `u3791c_replacement_keeps_failure_ownership` extends existing P3557c owner observers rather than duplicating their proofs.
- All production swallowed catches in ItemDrawer and Terminal scheme synchronization are removed. A final failure reaches its owning line after any eligible read/local-write retry; scheme synchronization is a remote command, not a safe local write. Planned `u3791c_rejected_actions_reach_their_owner` rejects those actual operations and checks the user can recover without losing input. Keep scheme synchronization and its subscription disposal (Check 5).
- A lint run exits nonzero for `.catch(() => undefined)` and `.catch(console.warn)` under `apps/desktop/src` production files. Exclude `*.test.*`, `src/testing/**` and explicitly identified test-only browser helpers such as `todos/laneBrowser.ts`; never exclude a production directory merely to make lint pass. Planned `u3791c_swallowed_catch_lint` runs the real lint rule on temporary production-path fixtures for both forbidden forms, a handled rejection and the test-helper exclusions. Policy: extend the installed oxlint plugin/configuration; frozen loop machinery stays untouched.

## Links resolve what roundup can (#6249, audit rows B1 to B5)

Policy: this section is U6249c of Issue #6249. Its verdicts: B1 RESOLVE, B2 MERGE into B1, B3 KEEP for a closed Project and HIDE for a malformed link, B4 RESOLVE, B5 RESOLVE then HIDE. The Daemon parser (`crates/rupd/src/link.rs`, `parse`) keeps requiring `project`: an OS link has no surface, and `watchNativeOpen` in `apps/desktop/src/app/nativeOpen.tsx` offers it to every running Project, so a default there would let the first Project claim it. The App completes the link, not the Daemon. Mutations and the user's send never retry (P11).

**U6249c1 a project-less link opens in its surface's Project.** Given a `roundup://agent/4`, `roundup://workstream/…`, `roundup://pad/…` or `roundup://todo/…` link with no `project` parameter, clicked in a Terminal, an Ask row, an Inbox row or a Bubble of Project P, then:

- The link opens that object in P through the same route as a link carrying `?project=<P's key>`; no failure line shows on any surface. Planned `u6249c_projectless_link_opens_in_surface_project` clicks the link in each of the four surfaces over a fake App and asserts the `link.read` URL sent, the selected object and a failure count of 0.
- One App helper adds the surface's Project key before routing; `apps/desktop/src/terminal/screens.ts` (`open`), `apps/desktop/src/ask/AskRows.tsx`, `apps/desktop/src/inbox/InboxRow.tsx` and `apps/desktop/src/bubbles/tab.tsx` call it, so no surface keeps its own copy of the failure. A link that already names a `project` is routed unchanged, even when it names another Project. Planned `u6249c_named_project_is_kept` asserts the URL sent is byte-equal.
- An OS-opened link (no surface) with no `project` still fails as a malformed link (U6249c3). Planned `u6249c_os_link_without_project_stays_malformed`.

**U6249c2 a published link opens Made.** Given a `roundup://deliverable/…` link, then the Made panel opens on that deliverable and no failure line shows; the `published` copy in `apps/desktop/src/app/copy.ts` goes. Planned `u6249c_deliverable_link_opens_made` asserts the open panel and its deliverable id.

**U6249c3 a link failure is told once, calmly, and only when the user can act.** Given a link no running Project accepts, then:

- A link naming a Project that is not open shows one dismissable line with one action, "Open {Project}", that opens the Project and retries the link once. Planned `u6249c_closed_project_link_offers_open` asserts the action's role, that it calls `projects.open` then `link.read` once more, and that dismiss clears the line.
- A malformed link (wrong scheme, a Project mismatch with no running owner, a Todo id that is not a whole number, a stray parameter) shows nothing and goes to the App log with its cause. Planned `u6249c_malformed_link_is_logged_not_shown` asserts no failure line and one log entry carrying the Daemon's message.
- The classification reads the typed `RpcError` discriminant (`error.data.kind`, as `other-project` does today), never the message text (U3791b). The Ask, Inbox and Bubble per-surface link failure lines (`target-failure` in `AskRows.tsx`, `onFailure` in `InboxRow.tsx` and `tab.tsx`) are removed, so a failed link shows on one surface only. Planned `u6249c_link_failure_has_one_surface` clicks a failing link in each surface and asserts exactly one line in the document.

**U6249c4 a printed path tries its likely homes.** Given a path printed in a Terminal that `openTarget` answers NOT_FOUND for, then the App tries, in order, the path without a trailing `:line` or `:line:col`, the Project root, the Agent's worktree and the home folder, and opens the first that exists with the line kept. Only when none exists does it log the path to the App log and show nothing. Planned `u6249c_path_tries_likely_homes` asserts the `openTarget` calls in order and the first success; `u6249c_missing_path_is_logged_not_shown` asserts no line and one log entry. Policy: `openPrinted` in `apps/desktop/src/terminal/links.ts` keeps its existing bare-domain fallback (U365b) before these.

Policy: tests of `apps/desktop/src/terminal/u365_links.test.tsx` that assert the `doesNotExist` line or the centre notice for a project-less link are cut or rewritten to U6249c1 and U6249c4, each cut naming the test above that still proves its then-clause. Journey and Moves: no new Token; the one "Open {Project}" action and its dismiss use the existing failure line (U6249d), and the implementing PR names D2, D5 and D6.

## Main baseline and regression Checks

All baseline citations below exist on main. Planned test names above are implementation obligations, not claims of passing tests. Counts describe the inspected baseline, not a fixed acceptance limit.

1. Native ownership: `crates/desktop/src/state.rs`, `AppState::start_daemon` and `AppState::mark_exited`; `crates/desktop/src/daemon.rs`, `start` and `watch_exit`. App `apps/desktop/src/state/projects.ts`, `createProjectsState`, currently records exit immediately and reopens manually.
2. RPC constants: `crates/rpc/src/error.rs`, `code` module, has **14**, including INBOX_UNAVAILABLE, not the Issue's 13. `apps/desktop/src/app/seam.ts`, `RpcError` and `INTERNAL_CODE`, carries the numeric identity.
3. Existing exit assertions: `apps/desktop/src/app/u25_daemon_gone.test.tsx`, `u25_the_exit_shows_in_the_header_only` and `u25_the_spawn_actions_are_disabled`. Keep single placement and disconnected-action protection; change only the immediate-display precondition as U3791a orders.
4. Existing retention: `apps/desktop/src/state/u2773_storage.test.ts`, `u2773e_storage_failure_keeps_memory`, `u2773e_storage_failure_keeps_invalid_records_%s`, `u2773e_storage_failure_keeps_memory_at_utf8_bound` and `u2773e_credentials_keep_existing_policy`. `scenarios/unfinished-input.md`, **U2773b submissions consume one revision** and **U2773e retention failures are recoverable** retain their guarantees after bounded retry.
5. Scheme behavior: `apps/desktop/src/terminal/x17_scheme.test.ts`, `x17_connecting_tells_the_daemon_the_scheme_and_each_switch_tells_it_again` and `x17_ending_the_connection_stops_following_the_window`.
6. Failure lifetime: `scenarios/pads.md`, **P3557c item failure lifetime throughout the App**; `apps/desktop/src/toasts/p3557c_failure_lifetime.test.tsx`, `deleting the item clears its failure; another item's deletion does not`. Preserve ownership on replacement as well as deletion/recovery.
7. Numeric outcome duplication: `apps/desktop/src/changes/notes.ts` (`reply`), `orders/OrderDrawer.tsx` (`OrderDrawer`), `orders/WorkProgress.tsx` (`ProgressContent`), `pads/PadDrawer.tsx` (`PadBody`), `pads/Pads.tsx` (`Pads`), `rail/Rail.tsx` (`Rail`), `rail/RailRow.tsx` (`NameField`), `rail/clear.ts` (`createClearing`), `rail/importState.ts` (`createImport`), `todos/failureOf.ts` (`outcomeOf`) (paths after the first share `apps/desktop/src/`). These are ten production files, not eleven; PadDrawer contains two checks. The implementation source audit covers all of them.
8. Lint integration: `.oxlintrc.json`, `jsPlugins` and `rules`; `tools/oxlint/anti-slop/index.ts`, existing plugin; `justfile`, `lint-web` invokes `pnpm lint`. No workflow, loop script or agent-prompt change is needed.

## Reuse decision

Policy: preserve the existing storage owner, App seam and native supervisor. `apps/desktop/package.json` already supplies Solid, Valibot and `@solid-primitives/scheduled`; `crates/desktop/Cargo.toml` supplies Tokio. Web Storage provides synchronous replace/remove, and Tokio supplies process/time/cancellation primitives, but neither supplies the requested bounded retry policy. Reuse the current holders rather than add a second persistence or process store.

- Select [p-retry](https://github.com/sindresorhus/p-retry) for asynchronous App reads, with one retry and no delay; [v8.0.1, released 2026-09-01](https://github.com/sindresorhus/p-retry/releases/tag/v8.0.1), is maintenance evidence. Normalize foreign throws at the existing adapter so the library's non-network TypeError abort behavior cannot skip an eligible second read. Do not make synchronous Web Storage asynchronous to fit this library: its existing foreign-call adapter can perform one additional identical call, with no new scheduler or generic retry framework.
- Select [backon](https://github.com/Xuanwo/backon) for native restart delay generation, configured for the two specified waits and no jitter; [v1.6.0, released 2025-10-18](https://github.com/Xuanwo/backon/releases/tag/v1.6.0), documents its release history; its [2026-01-01 source update](https://github.com/Xuanwo/backon/commit/60d03488fd8fdeadcdcf2c9b1a6cb69c6c07f3c0) also confirms ongoing maintenance. It runs with Tokio and keeps process retry ownership in Rust. p-retry cannot supervise Rust-owned processes without a second webview owner; backon cannot run App reads in the webview. These are complementary selections, not custom retry libraries.
- The installed [scheduled primitive](https://github.com/solidjs-community/solid-primitives/tree/main/packages/scheduled) offers debounce/throttle, not failed-attempt counting or a result/retry contract. Keep its existing scheduling uses; do not build a retry framework on it. Policy: implementing PRs verify current compatibility, licensing and maintenance and carry their own rule 9 evidence before introducing machinery.

## Principles and rendered observation

Policy: P3 gate — can a recovered failure raise attention? Observer: successful retry/restart yields no attention entry. P9 gate — can recovery launch an Agent or replay a prompt? Observer: restart with zero Agent starts, Messages and Terminal writes. P11 gate — can retry/replacement lose input, target the wrong Project/revision or hide exhausted retention failure? Observer: exact identities/values, two-attempt counts and existing retained-revision/credential probes.

Policy: journey stages Enter, Intervene and Review remain usable through a transient failure and offer explicit recovery after exhaustion. The implementing UI PR names Moves D2, D5, D6 (`docs/design-system.md`, The checks), uses Tokens only and regresses no passing Check. Run `just capture U3791a U3791b U3791c` on dark `tree-40` at 1512×950 with the second read/storage failure and third restart failure visible. Leave PNG/video evidence under `artifacts/ux/<id>/`, uncommitted, per `.agents/data/harness.md`; observe before/after recovery and the same-kind replacement in a dedicated headless browser session with a fresh profile. Behavioral tests assert calls, roles, drafts and ownership; the critic judges looks, clipping and copy. No native Mac-only observation is required to merge this specification.

## Calm, retried, actionable failures (#6249)

Acceptance for Issue #6249 from the owner's words of 2026-11-05 ("errors that are recoverable shouldn't look that annoying and ugly", "we should only show errors the user could action", "not even dismissable"). The Daemon half (held Messages, redelivery backoff, resuming a turn Claude gave up) is #6248; this is the App's. Terms: Project, Rail, Terminal, Agent, Workstream (`GLOSSARY.md`). Journey stage: Intervene (`.agents/data/journey.md`): a failure the user meets there is calm, has one action and goes away.

**U6249a a failure shows only when the user can act on it and nothing automatic can fix it.** Given the 92 failure sites audited at `origin/main` on 2026-11-05, then each has one verdict in the table below: KEEP (shown, with one action), RETRY-FIRST (retried automatically; shown only on exhaustion), RESOLVE (roundup does the fix; nothing shown), HIDE (not shown; the App log holds the cause) or MERGE (shown once, by another row). Policy: the table is the acceptance of the child Issues below, which cite their rows; no test rereads it (rule 10). The audit's per-site file and line were checked against the code; the rows it got wrong are corrected here, not copied:

- Sites keep their audit ids, so a child names them. The audit counted KEEP 35, RETRY-FIRST 36, RESOLVE 8, HIDE 7, MERGE 6; after the corrections below the table counts KEEP 42, RETRY-FIRST 26, RESOLVE 9, HIDE 8, MERGE 7.
- A mutation is never retried or replayed (P11, P9, U3791a), so these audit verdicts change to KEEP: A3 (a Door start is a launch), A4b (the "continue" after 30 s, 2 and 10 min is a Message sent for the user, and resuming a turn is #6248), A6 and A10 (rename, move, stop, restart and a re-issued move are mutations), B8 (a Terminal write), D5 (the user's send), J1 (a save), and L2's -32005 "queue and send on idle" and -32007 "resume the Agent". B12 (the scheme push is a remote command, U3791c) becomes HIDE. E2 splits: the editor mount retries, a save does not.
- B1: the audit's second half, defaulting a missing `project` in `crates/rupd/src/link.rs` `parse`, is dropped. `app/nativeOpen.tsx` `open` asks every running Project's `link.read`, so a default would open an OS link in whichever Project answers first. The Daemon keeps requiring the key; the surface that holds the click supplies it.
- A21: the automatic reopen exists (`crates/desktop/src/state.rs` `open` and `recover` wait `250 * failure` ms, `apps/desktop/src/app/u3791a_recovery.test.tsx` `u3791a_daemon_third_failure_is_visible`). Only its waits change.
- A1: the Daemon sets `unreachable` (`crates/rupd/src/route.rs`); the grace before it shows is #6248's. The App half is one line, on the child's row.
- A reading of a read-only RETRY-FIRST row needs no per-site code: the seam of U6249b retries it. Local-write rows (A14, C5, G2, H3, I4, J5, K3) keep U3791a's one repeat.

| id | verdict | child | cause |
|---|---|---|---|
| A1 | MERGE | R | child row only, action Open Agent; the Daemon's grace before `unreachable` is #6248 |
| A2 | MERGE | R | folds into A1: a Workstream row shows nothing for a child whose row is visible |
| A3 | KEEP | R | a Door start is a launch (P9): no auto retry; Retry stays |
| A4a | KEEP | R | Rail row only; one action, Open Terminal |
| A4b | KEEP | R | Rail row only; Claude Code already retried; resuming the turn is #6248; unknown and empty causes HIDE the text and keep the error glyph |
| A5 | MERGE | R | folds into A4a: a dismissed error shows nothing |
| A6 | KEEP | R | Rail commands are mutations: no auto retry; one action, Retry |
| A7 | KEEP | R | one action, Open Project |
| A8 | KEEP | R | non-idempotent create |
| A9 | KEEP | R | outcome unknown |
| A10 | KEEP | R | re-issuing a move or rename replays a mutation (P11) |
| A11 | RETRY-FIRST | F | tree fetch is a read; the seam retries it |
| A12 | RESOLVE | R | drop the held row or entry when its Agent is gone |
| A13 | HIDE | R | log |
| A14 | RETRY-FIRST | F | local write; U3791a's repeat, then HIDE |
| A15 | KEEP | R | action Copy |
| A16 | KEEP | R | inline |
| A17 | KEEP | R | validation |
| A18 | RETRY-FIRST | F | git and gh reads; then one dash mark on the chip, no notice |
| A19 | KEEP | R |  |
| A20 | HIDE | R | poll continues |
| A21 | RETRY-FIRST | N | the existing automatic reopen waits 1, 3 and 9 s; its 250 ms and 500 ms waits retire |
| B1 | RESOLVE | L | a click in a Project's surface carries that Project's key |
| B2 | MERGE | L | folds into B1 |
| B3 | KEEP | L | closed Project: one action Open {Project}; malformed link HIDE |
| B4 | RESOLVE | L | open the Made panel on the deliverable |
| B5 | RESOLVE | L | try the Project root, the Agent's worktree and the path without `:line:col`; if none exist HIDE |
| B6 | RETRY-FIRST | T | resubscribe is a read |
| B7 | RETRY-FIRST | T | snapshot restore is a read |
| B8 | KEEP | T | a Terminal write is never replayed; one action, Retry by hand |
| B9 | KEEP | T |  |
| B10 | RESOLVE | N | image to a temp file and paste its path; native |
| B11 | RETRY-FIRST | T | local attach |
| B12 | HIDE | T | scheme push is a remote command, not replayed; cosmetic |
| B13 | HIDE | T |  |
| B14 | KEEP | T |  |
| B15 | RESOLVE | N | the App restarts its own Daemon; native, `scenarios/contract-match.md` |
| B16 | KEEP | T |  |
| C1 | RETRY-FIRST | R | native window call; Settings toggle KEEP |
| C2 | RETRY-FIRST | F | reads; writes KEEP |
| C3 | HIDE | R |  |
| C4 | KEEP | R |  |
| C5 | RETRY-FIRST | F | local write |
| C6 | KEEP | R | action Delete saved data, a button |
| C7 | RETRY-FIRST | F | chunk load |
| C8 | KEEP | R |  |
| C9 | KEEP | R | opening a Project is a start: no auto retry |
| C10 | RESOLVE | R | fall back to the in-App confirm; a native confirmation is never replayed |
| C11 | KEEP | R |  |
| C12 | HIDE | R | not user-visible |
| D1 | MERGE | R | toast keeps name and glyph, no label |
| D2 | KEEP | R | action Open the Extension's config |
| D3 | KEEP | R |  |
| D4 | RESOLVE | R | close silently for a deleted target |
| D5 | KEEP | P | the user's send is not retried |
| E1 | RETRY-FIRST | F | pad list read |
| E2 | RETRY-FIRST | P | editor mount remounts once; a save is a mutation, KEEP |
| E3 | KEEP | P | action Copy my text |
| E4 | KEEP | P |  |
| F1 | RETRY-FIRST | F | reads; drop Dismiss, the line clears itself |
| F2 | KEEP | P |  |
| F3 | RESOLVE | P | external delete closes the drawer; delete-refused KEEP |
| F4 | KEEP | P |  |
| F5 | KEEP | P |  |
| F6 | RETRY-FIRST | P | subscriptions; then HIDE |
| G1 | RETRY-FIRST | F |  |
| G2 | RETRY-FIRST | F | local write; "full" KEEP with action Discard old drafts |
| G3 | RETRY-FIRST | F |  |
| G4 | RETRY-FIRST | F |  |
| G5 | KEEP | P |  |
| G6 | HIDE | P |  |
| H1 | RETRY-FIRST | F |  |
| H2 | KEEP | P |  |
| H3 | RETRY-FIRST | F | local write; then HIDE |
| H4 | KEEP | P |  |
| H5 | KEEP | P |  |
| I1 | KEEP | P |  |
| I2 | MERGE | R | folds into A4a |
| I3 | RETRY-FIRST | F | list loads; a row failure KEEP |
| I4 | RETRY-FIRST | F | local write |
| J1 | KEEP | P | a save is not retried |
| J2 | KEEP | P |  |
| J3 | KEEP | P | validation KEEP; the load read is retried by the seam |
| J4 | KEEP | P |  |
| J5 | RETRY-FIRST | F | local write |
| J6 | KEEP | P |  |
| K1 | MERGE | R | folds into A4a |
| K2 | KEEP | P | add Dismiss |
| K3 | RETRY-FIRST | F | storage; clipboard KEEP |
| K4 | RETRY-FIRST | F | list read; a row failure KEEP |
| L1 | HIDE | R | keep `bypass_permissions_disabled` and `logout` with one action, Open Terminal |
| L2 | KEEP | F | reads retry at the seam; a mutation refusal (-32005, -32007) is never queued, resumed or replayed, and keeps its draft |

Children (one module each, rule 3): F foundation (`app/seam.ts` and `ink/`: U6249b reads, U6249e), L links (U6249c), R Rail, centre overlay and toasts (`rail/`, `toasts/`, `App.tsx`: U6249d for those rows), T Terminal (`terminal/`), P panels (`pads/`, `todos/`, `changes/`, `drawer/`, `importer/`, `ask/`, `settings/`, `switcher/`, `inbox/`: U6249d), N native (`crates/desktop/src`: A21's waits, B10, B15), D #6248.

**U6249b retry first.** Given an automatic read, then it goes through `p-retry` (already installed) at `apps/desktop/src/app/seam.ts` `retryRead`: up to 4 retries, waits of 250 ms doubling to 4 s, randomised. The last good data stays (U5558e, `scenarios/automatic-updates.md`) and no failure shows until the last retry fails. A mutation never retries (P11): a failing mutation shows at once and its call runs once. A Project Daemon that exits is reopened by the App at 1, 3 and 9 s (`crates/desktop/src/state.rs`, replacing U3791a's 250 ms and 500 ms), and "Disconnected" shows only after the third reopen fails; U3791a's other restart clauses (a reconnect refetches, no Agent input, per-Project counts, close cancels) stand. Test `u6249b_reads_retry_with_backoff_before_failing`, with fake timers: a read failing three times then succeeding shows its data and no failure; one failing five times shows one failure after the last retry, with the five calls; a failing mutation shows at once and runs once. Test `u6249b_daemon_reopens_at_1_3_9_seconds` (native, controlled readiness failures and time): three waits of 1, 3 and 9 s, then the failure. The tests `u3791a_read_recovers_once_without_intermediate_failure`, `u3791a_second_failure_is_actionable`, `u3791a_project_read_exhaustion_keeps_explicit_retry` and `u3791a_daemon_third_failure_is_visible` change their call counts and timings to this clause, and the child that lands it cuts what they then repeat (rule 10).

**U6249c roundup resolves what it can.** Given a `roundup://` link with no `project` clicked in a Terminal, Ask row, Inbox row or Bubble of Project P, then it opens in P: the click supplies P's key before `link.read`, and the Daemon's requirement of `project` is unchanged. Given a held entry, toast or menu item whose target is gone, then it drops without a message. The other RESOLVE rows follow their verdicts. Test `u6249c_projectless_link_opens_in_its_surface_project`: a click on `roundup://agent/4` in a Terminal of Project P selects Agent 4 of P, `link.read` is asked once of P, and no failure renders. Test `u6249c_gone_target_drops_silently`: a held entry whose Agent is removed disappears and no failure renders.

**U6249d a shown failure is calm, dismissable and on one row.** Given a failure that the table keeps, then its glyph (✕) is the only red; the cause is one `--grey` line in plain words with the raw message in its tooltip (U80, `scenarios/ui-surfaces.md`); it offers one action, in the UI font, the one that changes the outcome; it is dismissable (its × or Escape) or clears itself when its cause clears; and it shows on one surface and one row: the Agent's own row, with nothing added to a Workstream row while the child's row is visible. A HIDE failure goes to the App log with its cause and shows nothing. Motion: the line fades in over 150 ms on `--easing-out`, leaves at once and never animates height; reduced motion keeps the fade. Test `u6249d_failure_is_dismissable_and_on_one_row`: Escape and × each remove a shown failure; a child's failure renders on the child's row, and on the Workstream's row only while the Workstream is folded. Policy: no new colour Token; colour, size and copy are the design critic's (rule 10), at 1512×950 dark and light on a Rail failure, the Terminal top line and a Pads failure.

**U6249e the guard.** Given the shared failure line, then its props require an action and a dismissal (or the signal whose change clears it), so a failure line without them fails the type check. Proof: `pnpm --filter desktop exec tsc --noEmit` (the `check` lint); no test repeats it. Every existing failure line (`ink/ReservedLine.tsx` `ReservedLine` with a message, `ink/FailureLine.tsx` `Line`) either takes the new props or is not a failure line.

Policy — rendered observer: one isolated headless agent-browser session on the U26 harness, fresh profile, 1512×950, dark and light: a `rail.tree` failing and healing within its retries shows nothing; one that keeps failing shows one calm dismissable line with Retry; a project-less link opens its Agent. Captures go to run artifacts, linked from the PR. P3 gate: a healed failure raises no attention entry. P9 gate: no retry or reopen launches an Agent or sends a Message. P11 gate: no mutation call count above one.

## Checks on main (U6249)

1. `apps/desktop/src/app/seam.ts`, `retryRead`: one retry with no delay today.
2. `crates/rupd/src/link.rs`, `parse`: requires `project`; unchanged.
3. `apps/desktop/src/app/nativeOpen.tsx`, `open`: asks each running Project; the click's key joins the URL before it.
4. `apps/desktop/src/rail/RailRow.tsx`, `unreachable`: includes the direct child and, folded, every descendant.
5. `apps/desktop/src/ink/ReservedLine.tsx`, `ReservedLine`; `apps/desktop/src/ink/FailureLine.tsx`, `FailureLine`.
6. `scenarios/automatic-updates.md`, **U5558e automatic reads are bounded and recoverable**; `scenarios/ui-surfaces.md`, **U80 one failure line**.
7. `crates/desktop/src/state.rs`, `recover`: the reopen wait.
