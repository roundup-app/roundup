# Product continuity

Policy specification for #2772. Canonical rules and gates: `PRINCIPLES.md`, P11–P13. P1–P10 retain their meanings. This file records acceptance and probes, not implementation or a new software abstraction. No RPC, schema, UI layout, Agent runtime or event bus is chosen here.

## Owner direction — 2026-10-19 (Europe/London)

> I like -> respect for unfinished input
> I like -> what they made
> I like -> named schedules -> but i think we should go event driven as a reaction not only time driven
> I think you should $widen $reframe $anchor and add these concepts as rules to the loop and open issues for the loop to deliver these features in a way tthat fits the core project goals and values - you could $shape any with me

The owner's words and the confirmed scopes below are acceptance authority. Bise is background evidence, not a specification. Preserve the black-box Agent/Terminal boundary and the recorded no-browser/no-splits/no-dictation direction.

## Confirmed scopes — owner answers, 2026-10-19

> All roundup-owned drafts, plus protecting live Terminal input. Preview: switching views, reloads, incoming events and failed sends preserve unsent work; roundup does not reconstruct a vendor’s editor after its process dies.

> Project events plus time. Preview: “when these Agents finish,” “when this PR’s checks pass,” or “at 9am” delivers a named instruction once when its declared condition holds.

> Product Principles and review gates. Preview: builders and reviewers must preserve unfinished work, make outputs findable, and require explicit bounded reactions; keep the loop’s scheduling machinery.

## Policy acceptance

**PC1 unfinished input.** Policy: add P11 with its Gate and Observer in `PRINCIPLES.md`. Independent review applies that gate to every unfinished-input case and probe below: each forced answer must be permitted and each stated wrong outcome rejected, including exact revisions, original identities, declared secrets and the live vendor boundary. Failure of any row rejects the policy. Implementation behavior remains the outcome of #2773, not evidence supplied by this document.

**PC2 published work.** Policy: add P12 with its Gate and Observer in `PRINCIPLES.md`. Independent review applies that gate to every deliverable case and probe below: each forced answer must be permitted and each stated wrong outcome rejected, including removal/revocation and deliberate publication. Failure of any row rejects the policy. Implementation behavior remains the outcome of #2774.

**PC3 bounded reactions.** Policy: add P13 with its Gate and Observer in `PRINCIPLES.md`. Independent review applies that gate to every reaction case and probe below: each forced answer must be permitted and each stated wrong outcome rejected, including durable firing-to-Message identity rather than external side effects. Failure of any row rejects the policy. Implementation behavior remains the outcome of #2775.

**PC4 reachable review gates.** Policy: `AGENTS.md` requires reading `PRINCIPLES.md` before specifying, implementing or reviewing product behavior and deriving applicable Gates and Observers from the scenario and diff. Builders follow `.agents/data/pr.md`, “Title and body”, to `PRINCIPLES.md` and name applicable ids. Reviewers receive the named scenarios from main through `.agents/data/gates.md`, “Merge”; PC1–PC3 explicitly point to the canonical rules. `PRINCIPLES.md`'s opening paragraph requires reviewers to answer the gates from the diff. Applicability is mechanical: a diff changing an editable surface or its submit/retention/delivery path invokes P11; a publication/discovery/open/send/removal path invokes P12; a condition, authorization, lifecycle or firing/delivery path invokes P13. A path touching multiple categories invokes every applicable gate. The reviewer records yes/no and the changed path or behavioral evidence for each applicable gate; a yes on new behavior rejects. Goal gates remain advisory for unmet implementation goals and unrelated baseline gaps; existing P4/P6/P9/P10 and Message contracts remain binding. This uses existing read paths and changes no frozen prompt, scheduler or gate machinery.

## Regression checks on main

1. Preserve `PRINCIPLES.md`, headings P1–P10, especially P4's opaque vendor boundary, P6's user-controlled Home, P9's usage/start rules and P10's batching.
2. Preserve `scenarios/messages.md`, headings B32, B39, B40, B41, B42, B43, B44 and B45: unsent input/Takeover, acknowledged delivery and existing event-wake/replay contracts. A new policy grants no exception to them.
3. Preserve `scenarios/ui-persist.md`, heading U100; `scenarios/ask-bar.md`, headings U504–U506; `scenarios/ui-diff-notes.md`, headings U2540a–U2540d; and `scenarios/door-terminal.md`, headings U467/U468. These are existing contracts, not claims that all draft or publication goals already pass.
4. Preserve `.agents/data/pr.md`, “Title and body”, and `.agents/data/gates.md`, “Merge” and “Scope”; do not edit the loop read paths. Existing links (#2692) and context-menu sending (#2694) retain their separate contracts; neither alone delivers a published-work catalogue.

## Behavioral evidence required in implementation

All acceptance above is policy, judged independently against the record below; no test rereads this prose. Implementing specifications name behavioral tests at existing App, Daemon and public MCP/CLI seams for each then-clause, using real temporary Project data and deterministic fake vendor programs where needed. Record fixture inputs, actions, exact expected identities/data, actual outputs and pass/fail for every applicable row. Check call counts and authority, including negative effects; UI tests assert behavior, roles, focus and contracts, while the critic owns looks. Tests that already prove a clause are reused. A policy/spec merge closes no feature Issue. #2773–#2775 retain the owner's dated words and are natively blocked on #2772 until this policy merges; no duplicate work Issue is needed.

No browser, Terminal splits, dictation, vendor transcript/editor reconstruction or duplicate authoring UI is introduced. Loop scheduling and machinery stay unchanged.

## Case and probe record

The following closed probe set is policy evidence, not a claim of passing software. Bise references supply background only; the owner's confirmed scope determines the outcomes. Each numbered arrow is the expected pass outcome; its negation fails. Each “wrong” outcome fails. The credential, removal/revocation and accepted-work counterexamples below delimit the rule without narrowing ordinary drafts, published work or future firing protection.

### Unfinished input — P11

Cases:
- Ask field starts as a local empty signal: wrong = Switching/reloading loses an unfinished Ask; forced answer = Restore the same Project draft; do not send.
- An Ask send fails while the next Ask is being typed: wrong = Restore old text over newer text, or forget the failed Ask; forced answer = Retain both revisions with their original recipients.
- A Pad is changed by another Actor during editing: wrong = Replace the user draft; forced answer = Keep the user edit and expose the conflict.
- A Message arrives while Terminal input is unsent: wrong = Inject into the user draft; forced answer = Existing unsent-input/Takeover holds win.

Ten additional situations:
1. User renames a Todo, then changes Project → Recover text against the same Todo, not the newly selected one.
2. A diff note is open when a file read completes → Keep note text and its original comparison identity.
3. The recipient of an open Ask draft is replaced → Keep recoverable text but refuse delivery to the replacement recipient.
4. User edits the next draft before the prior send acknowledgement → Consume the acknowledged revision only.
5. Emoji, composed text and non-Latin input are interrupted by a view change → Keep exact text; do not normalize or truncate it.
6. Restoring Project A while Project B is active → No cross-Project draft or send.
7. Draft storage refuses a write → Visible failure and recoverable in-memory draft.
8. User explicitly discards one recovered draft → Remove that draft only; later restoration must not revive it.
9. A future credential/password field loses focus → Do not introduce disk persistence of that declared secret.
10. Vendor process dies with its own editor open → Report its lifecycle honestly; do not synthesize vendor editor restoration.

Counterexample hunt:
Persist-every-field would persist credentials. Narrowed only declared credential fields; ordinary drafts and Terminal protection remain covered. Reprobed all ten situations: no remaining counterexample found in this set.

### What they made — P12

Cases:
- Bise registered outputs survive the source folder through retained versions: wrong = Publish a dead path as if it still opens; forced answer = Keep the named revision available or explain unavailability.
- roundup Pads/links already have identity and Home: wrong = Build a duplicate editor or global file scan; forced answer = Reuse existing owners and apply output discovery to published work.
- Each Agent owns its Worktree and diff: wrong = Show another Agent's or root's contents under the selected maker; forced answer = Bind target/maker/Project and the named revision.
- Source/output streams and test artifacts already have different meanings: wrong = Catalogue every byte or test capture as a deliverable; forced answer = Only declared user-facing publication enters the catalogue.

Ten additional situations:
1. An Agent stops after publishing a PDF → The PDF record remains findable without restarting the Agent.
2. Two Agents publish files with the same title → Keep distinct identities, maker attribution and targets.
3. The user moves a deliverable to another Home → The user placement wins; the former Home does not duplicate it.
4. The user opens a published report after its source Worktree was deleted → Open the retained named revision or show why it is unavailable.
5. An external URL is revoked → Keep honest unavailable state; do not fabricate a replacement.
6. A Pad changes after publication of a named revision → Distinguish published revision from a link requesting current content.
7. User intentionally removes a published output → Honor removal; a background refresh cannot recreate it.
8. A different Project has an identically named output → It is not used as a fallback target.
9. A secret or scratch intermediate exists in an Agent directory → Do not publish it by directory scanning.
10. A binary, deck or sheet is opened → Use existing native/default-app paths; do not require a new in-app editor.

Counterexample hunt:
Retain-everything would defeat explicit removal/access revocation and publish scratch or private intermediates. Narrowed to deliberately published user-facing deliverables and retained explicit removal/revocation. Reprobed all ten situations: no remaining counterexample found in this set.

### Named reactions — P13

Cases:
- B41-B44 wake on Agent-status Events and replay once: wrong = Poll the Agent or send the same completion twice; forced answer = Reuse authoritative events and durable delivery identity.
- Bise timers fire only when eligible and do not stack: wrong = Build a fresh backlog on every tick while busy; forced answer = Bound firings and use existing guarded delivery.
- PR checks can be stale or unavailable: wrong = Treat missing/currently cached facts as success; forced answer = Match only a verified source fact/revision.
- P9/P10 and the real-Terminal boundary already govern starts and prompts: wrong = Start a model to inspect each trigger or bypass user control; forced answer = Evaluate declared conditions without a Model; deliver via normal Message guards.

Ten additional situations:
1. A GitHub check-completed notification is delivered twice → One accepted firing identity and one Message.
2. The Daemon crashes between event observation and firing commit → Replay recovers one firing, not zero by forgetting or two by duplication.
3. The receiver is taken over or has unsent input → Normal delivery holds; never type through the draft.
4. An Agent name is reused after the original target was removed → No silent retargeting to the new identity.
5. A PR cache shows an old passing revision while the head failed → Do not match the new-head-success condition.
6. The user stops a reaction after one Message was accepted → No later firing; show the accepted Message honestly rather than promise undo.
7. A condition stays true across multiple refreshes → No repeated firing without declared re-arm and remaining bound.
8. Two event clauses of one condition become true simultaneously → One firing identity, not one per observer.
9. The machine sleeps through a scheduled time → Apply the declared missed-time policy once; do not invent an unbounded catch-up backlog.
10. An Agent is stopped when the Daemon reopens → Opening starts no program; retained reactions follow authorized lifecycle/delivery rules.

Counterexample hunt:
Exactly-once-work would overpromise external side effects; cancellation cannot undo an already delivered prompt. Narrowed the guarantee to accepted firing-to-Message identity and distinguished accepted work from future firings. Reprobed all ten situations: no remaining counterexample found in this set.
