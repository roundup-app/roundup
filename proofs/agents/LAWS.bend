# PROPOSED OPEN LAWS: owner review required (Issue #3795; A3795a).
# Read `proofs/.tools/bend/bin/bend guide`, Laws and Proofs, before editing.
# This is a specification proposal, not owner approval or a checked Bend module.
# Event, trace projections and predicates below are mathematical specification
# notation, defined here in prose, awaiting formal encoding in A3795f. They are
# not public implementation names. No model is imported or implemented here.
# No proof body, placeholder proof or lifecycle proof-gate pass is supplied.
# Preserve the existing Message laws and their proof gate unchanged.
# Once approved, no law or predicate may be deleted, weakened or made trivial
# (V3). Formal encoding must preserve these domains and claims.
# All four laws are safety: fairness/fuel none. They promise no eventual exit.
# A later liveness law must state fair completion delivery and finite fuel,
# and explain that withholding completion or exhausting fuel prevents progress.

# SHARED DOMAINS AND NOTATION (applies to every declaration below).
# Event ranges over payload-shaped authorized requests and I/O results:
# spawn/start Door/resume, launch success/refusal/unknown, acknowledgement,
# Signal/title/Tick/exit, stop/remove/discard and shutdown results, enrollment,
# assignment/reservation/preparation/readiness results, clean/landed checks,
# crash/reopen with stored records, and authoritative reconciliation results.
# Each targeted event/effect carries (Project identity, Agent identity, Attempt
# ordinal); Worktree events also carry their recorded owner/path/branch/Base.
# Ordinals are per Agent, start at 1 and are never reused across reopen.
# Workstream identity and Home are independent of Attempt and Terminal identity.
# Time and randomness, if needed, are event payloads; step performs no I/O and
# reads no clock or random source. The Daemon interprets ordered effects.
#
# evs ranges over ALL finite List<Event>, with no trace length/identity bound.
# well_formed(evs) checks payload shapes ONLY, not admission or successful
# execution. Thus refused and conflicting requests, duplicate results, stale
# Observations, unknown outcomes and arbitrary crash/reopen cuts remain in the
# domain. Correlation/authority guards are obligations inside the future step,
# never assumptions used to exclude an inconvenient event trace.
# k ranges over Nat; prefix(evs,k) is the first k events when k <= length(evs).
# S_0 is the empty initial lifecycle state (no Agents, Attempts or reservations;
# Project default worktrees off). Stored records supplied on reopen include
# retained records and uncertain provisioning at crash cuts. Reopen
# normalizes them by A8/A12/G6/G2542d, never by silently dropping established work.
# S_i and E_i are state and ordered newly emitted effects after event i,
# obtained by folding the future pure step from S_0. Reachable means one of
# these states; it is not an input filter. implies(P,Q) is false only when
# P is true and Q false. Every predicate below returns Bool.

# A3795b -- launch_once(evs,k) means BOTH conditions hold for every j <= k:
# (1) For every target t = (Project, Agent, Attempt), the cumulative count of
# Terminal-start effects targeted exactly at t in E_1 ++ ... ++ E_j is <= 1.
# Each such effect has one earlier or same-step durable admission of that exact
# target from an explicit authorized start/resume/spawn, with its persisted
# next/current ordinal. No missing/duplicate acknowledgement creates admission.
# (2) For every (Project, Agent), at most one Attempt occupies it in S_j.
# Occupancy means starting, resuming, actually live, or unresolved possibly-live
# launch. It ends only on authoritative ending/refusal establishing that no
# program remains, including after a failed rollback kill. Status done, timeout,
# lost acknowledgement, unlinking a Terminal and reopen alone do not establish
# this fact. Crash recovery keeps unknown occupancy unavailable to new starts
# until authoritative reconciliation. A later admitted request uses a greater
# ordinal; arbitrary fresh RPC requests are not deduplicated across crashes.
# Duplicate results cannot repeat start or submit the eligible initial Steer
# twice. A stale Observation cannot change the current Attempt (fence below).
# Refused concurrent admissions emit no start; cover both orderings.
# Fairness/fuel: none (safety).
# Without admission and actual-liveness guards, repeated/concurrent completion
# can start two programs, even when only one Terminal link survives.
law a3795b_launch_once:
  for evs: +List<Event>
  for k: Nat
  {implies(well_formed(evs) and k <= length(evs), launch_once(evs, k)) == True{} : Bool}

# A3795c -- restart_is_replay(evs,k) means at each reopen among the first k
# events, its result equals normalized replay of the records supplied to that
# event, and that event's effects contain no Terminal start or prompt submission.
# Equality is field-for-field, not merely equal counts: Project identity;
# Rail Agent/Workstream ids, names, Home/parent, order and membership; last
# allocated/current and next Attempt ordinals; saved conversation id and cwd;
# Worktree path, branch, Base, mode, reservation owner and provisioning/readiness
# facts. Established assignments and uncertain ownership are retained.
# Only these normalizations are permitted: A8's legacy Workstream/root migration
# and done Status for a Door/Agent with no live Terminal; A12's unlinking of all
# old-run Terminal ids and dropping stored Kind terminal nodes; G6's recovery
# of unfinished never-used fresh provisioning; and G2542d's keeping enrolled or
# uncertain assignments unavailable until reconciled. Unlinking does not invent
# proof that an unresolved external program ended. Status normalization cannot
# release that occupancy. No original prompt is replayed; later explicit resume
# uses the saved conversation/cwd and follows A22 acknowledgement rules.
# G6 rollback may be requested only under cleanup authority below. Until its
# authoritative completion the record remains unresolved, not freely available.
# On completion it removes the unfinished spawn node or retains the stopped
# Door's Workstream and children. It never deletes established or enrolled work.
# Reopening normalized retained records again, with no intervening completion,
# yields exactly the same restored projection (idempotence). Old-run Terminal
# links remain empty; no unrelated new Terminal may be substituted.
# Fairness/fuel: none (safety).
# Without retained identity and stale-link normalization, restart can attach an
# unrelated Terminal, duplicate work or delete another directory.
law a3795c_restart_is_replay:
  for evs: +List<Event>
  for k: Nat
  {implies(well_formed(evs) and k <= length(evs), restart_is_replay(evs, k)) == True{} : Bool}

# A3795d -- ended_attempt_is_fenced(evs,k) means for every j <= k:
# An Attempt authoritatively ended in S_(j-1) receives no newly issued program
# input or Terminal-start effect in E_j. Ending is an Attempt fact, not Status
# done; closing still follows A7's three interrupts 100 ms apart and 5 s fallback
# kill, and A17's attached-child guarantee. No vendor parsing leaves the Adapter.
# Observation/acknowledgement/effect-completion target equality requires ALL of
# Project, Agent and current Attempt ordinal to match; Terminal attachment also
# requires that Attempt's acknowledged Terminal identity. A missing, removed or
# noncurrent target never resolves to a successor, even if conversation ids or
# numeric Terminal ids coincide. A stale result may settle only original-target
# bookkeeping or authorized cleanup, never emit input/stop/launch to a successor.
# For stale Signals/titles/Ticks/exits or completions, the current Attempt's
# projection before/after is exactly equal: ordinal, Terminal identity/link,
# launch/acknowledgement facts, actual liveness, Status and revision, conversation,
# cwd, files/ownership, pending input/initial Steer and membership. For an ended
# current Attempt, such Observations cannot change its final Status/revision.
# Already-issued physical effects are not undone; results stay on their original
# target. Final bookkeeping, honest pending-input settlement and authorized
# cleanup remain possible. Stop/natural exit retain Workstream id/name/parent/
# order and every child's parent and liveness. Only explicit A16 removal changes
# membership. A later authorized start/resume allocates a new Attempt of the
# same Agent, which is not permanently banned by its predecessor ending.
# Fairness/fuel: none (safety); neither this fence nor a timeout proves exit.
# Without target equality a delayed callback can write to or stop a successor.
law a3795d_no_input_after_end:
  for evs: +List<Event>
  for k: Nat
  {implies(well_formed(evs) and k <= length(evs), ended_attempt_is_fenced(evs, k)) == True{} : Bool}

# A3795e -- cleanup_requires_ended_owner(evs,k) means for every j <= k:
# Each destructive cleanup/release in E_j targets exactly its durable exclusive
# owner (Project, Agent, owning Attempt) AND recorded canonical path/branch/Base.
# No unowned path is touched. All relevant users of that directory must be
# authoritatively ended before cleanup: owner Attempt, its attached children,
# every roundup-managed Terminal using it and preparation commands. Unknown
# liveness fails this condition. A recorded running/stopped Agent retains its
# assignment until authorized release; uncertain ownership stays unavailable.
# Persist reservation before branch mutation and require readiness success
# before launch. Never give two active assignments one enrolled directory;
# moving Home changes no assigned path. Default worktrees-off stays unchanged.
#
# Cleanup authority is exactly one of these, checked for the same recorded
# owner/path/branch/Base, never inferred from Status or directory cleanliness:
# - Ordinary removal: explicit authorization and two successful clean/landed
#   checks, first before stopping, second after all users end and before cleanup.
#   Each says no staged/unstaged/untracked nonignored work and no commits absent
#   from Base; both identify the same captured owner/path/branch/Base and Git
#   revision/check facts. A failed, dirty, ahead or changed second check emits no
#   cleanup/release; keep the stopped Agent, its assignment and every file.
# - Explicit discard: authorizes loss of that owner's unlanded Agent work only,
#   after all users end. Never authorization for another owner or directory.
# - G6 rollback: recorded unfinished, never-used FRESH legacy provisioning only,
#   no Agent work/commits or changed/unowned resources; all preparation users
#   ended. Never an established assignment or enrolled directory. Rollback keeps
#   Door Workstream/children; only the fresh spawn node may be removed.
#
# Preservation by mode: legacy G5 removal/discard may remove the matching
# directory and Agent branch (missing directory permits pruning its git record,
# not skipping branch protection). Enrolled G2542d release parks at a detached
# commit, may remove that owner's Agent branch/node, and retains the enrolled
# directory and ignored dependency roots with their identities and bytes.
# Discard may remove tracked/untracked Agent work but never those roots;
# unenrollment/recovery never deletes the enrolled directory. No reset, stash,
# clean or force-switch makes dirty/ahead work available under ordinary removal.
# Enrolled rollback is never fresh-directory deletion. A missing/uncertain owner
# cannot authorize any destructive effect; report recovery instead.
# Fairness/fuel: none (safety).
# Without ownership, ended-user and mode guards, cleanup loses live, dirty,
# unlanded or another owner's work.
law a3795e_cleanup_only_after_end:
  for evs: +List<Event>
  for k: Nat
  {implies(well_formed(evs) and k <= length(evs), cleanup_requires_ended_owner(evs, k)) == True{} : Bool}
