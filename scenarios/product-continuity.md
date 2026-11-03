# Product continuity

Policy specification for #2772. Canonical rules and gates: `PRINCIPLES.md`, P11–P12. P1–P10 retain their meanings. This file records acceptance and probes, not implementation or a new software abstraction. No RPC, schema, UI layout, Agent runtime or event bus is chosen here.

## Owner direction — 2026-10-19 (Europe/London)

> I like -> respect for unfinished input
> I like -> what they made
> I think you should $widen $reframe $anchor and add these concepts as rules to the loop and open issues for the loop to deliver these features in a way tthat fits the core project goals and values - you could $shape any with me

The owner's words and the confirmed scopes below are acceptance authority. Bise is background evidence, not a specification. Preserve the black-box Agent/Terminal boundary and the recorded no-browser/no-splits/no-dictation direction.

## Confirmed scopes — owner answers, 2026-10-19

> All roundup-owned drafts, plus protecting live Terminal input. Preview: switching views, reloads, incoming events and failed sends preserve unsent work; roundup does not reconstruct a vendor’s editor after its process dies.

Product Principles and review gates retain unfinished work and discoverable outputs, while keeping the loop’s scheduling machinery. The retired part of the owner’s direction is recorded in #5740.

## Policy acceptance

**PC1 unfinished input.** Policy: add P11 with its Gate and Observer in `PRINCIPLES.md`. Independent review applies that gate to every unfinished-input case and probe below: each forced answer must be permitted and each stated wrong outcome rejected, including exact revisions, original identities, declared secrets and the live vendor boundary. Failure of any row rejects the policy. Implementation behavior remains the outcome of #2773, not evidence supplied by this document.

**PC2 published work.** Policy: add P12 with its Gate and Observer in `PRINCIPLES.md`. Independent review applies that gate to every deliverable case and probe below: each forced answer must be permitted and each stated wrong outcome rejected, including removal/revocation and deliberate publication. Failure of any row rejects the policy. Implementation behavior remains the outcome of #2774.

**PC4 reachable review gates.** Policy: `AGENTS.md` requires reading `PRINCIPLES.md` before specifying, implementing or reviewing product behavior and deriving applicable Gates and Observers from the scenario and diff. Builders follow `.agents/data/pr.md`, “Title and body”, to `PRINCIPLES.md` and name applicable ids. Reviewers receive the named scenarios from main through `.agents/data/gates.md`, “Merge”; PC1–PC2 explicitly point to the canonical rules. `PRINCIPLES.md`'s opening paragraph requires reviewers to answer the gates from the diff. Applicability is mechanical: a diff changing an editable surface or its submit/retention/delivery path invokes P11; a publication/discovery/open/send/removal path invokes P12. A path touching multiple categories invokes every applicable gate. The reviewer records yes/no and the changed path or behavioral evidence for each applicable gate; a yes on new behavior rejects. Goal gates remain advisory for unmet implementation goals and unrelated baseline gaps; existing P4/P6/P9/P10 and Message contracts remain binding. This uses existing read paths and changes no frozen prompt, scheduler or gate machinery.

## Regression checks on main

1. Preserve `PRINCIPLES.md`, headings P1–P10, especially P4's opaque vendor boundary, P6's user-controlled Home, P9's usage/start rules and P10's batching.
2. Preserve `scenarios/messages.md`, headings B32, B39, B40, B41, B42, B43, B44 and B45: acknowledged delivery and existing event-wake/replay contracts. A new policy grants no exception to them.
3. Preserve `scenarios/ui-persist.md`, heading U100; `scenarios/ask-bar.md`, headings U504–U506; `scenarios/ui-diff-notes.md`, headings U2540a–U2540d; and `scenarios/door-terminal.md`, headings U467/U468. These are existing contracts, not claims that all draft or publication goals already pass.
4. Preserve `.agents/data/pr.md`, “Title and body”, and `.agents/data/gates.md`, “Merge” and “Scope”; do not edit the loop read paths. Existing links (#2692) and context-menu sending (#2694) retain their separate contracts; neither alone delivers a published-work catalogue.

## Behavioral evidence required in implementation

All acceptance above is policy, judged independently against the record below; no test rereads this prose. Implementing specifications name behavioral tests at existing App, Daemon and public MCP/CLI seams for each then-clause, using real temporary Project data and deterministic fake vendor programs where needed. Record fixture inputs, actions, exact expected identities/data, actual outputs and pass/fail for every applicable row. Check call counts and authority, including negative effects; UI tests assert behavior, roles, focus and contracts, while the critic owns looks. Tests that already prove a clause are reused. A policy/spec merge closes no feature Issue. #2773–#2774 retain the owner's dated words and are natively blocked on #2772 until this policy merges; no duplicate work Issue is needed.

No browser, Terminal splits, dictation, vendor transcript/editor reconstruction or duplicate authoring UI is introduced. Loop scheduling and machinery stay unchanged.

## Case and probe record

The following closed probe set is policy evidence, not a claim of passing software. Bise references supply background only; the owner's confirmed scope determines the outcomes. Each numbered arrow is the expected pass outcome; its negation fails. Each “wrong” outcome fails. The credential, removal/revocation and accepted-work counterexamples below delimit the rule without narrowing ordinary drafts or published work.

### Unfinished input — P11

Cases:
- Ask field starts as a local empty signal: wrong = Switching/reloading loses an unfinished Ask; forced answer = Restore the same Project draft; do not send.
- An Ask send fails while the next Ask is being typed: wrong = Restore old text over newer text, or forget the failed Ask; forced answer = Retain both revisions with their original recipients.
- A Pad is changed by another Actor during editing: wrong = Replace the user draft; forced answer = Keep the user edit and expose the conflict.
- A Message arrives while Terminal input is unsent: wrong = Inject into the user draft; forced answer = Messages go to the inbox only (B3563c).

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
