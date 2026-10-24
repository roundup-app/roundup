import Base
import ./model.bend as M
import ./spec.bend as S

# Laws of crates/messages for one receiver, stated over every schedule (a List<Ev>) of model.bend's pure `step`.
# A Builder changes this file only as V3 says (scenarios/proofs.md): review-approved, and a law may only become stronger.
# Stated in part only: M4 (the typed list only grows at its end; B7's ties-by-id and held-never-blocks are not), M5 (disjointness;
# that ids never change status and rise by one is only counted by M6).

# M1: a Message is delivered at most once, and a prompt that repeats a delivered Message is dropped (B39(e)); a Message typed and not confirmed is typed again (B40), so "typed" is not what is counted.
# The model records and types in one step, so M1 below counts its typed list; b39_delivered_at_most_once counts `delivered` where the Signal, not the typing, records it.
law m1_final_and_at_most_once:
  for evs: +List<M.Ev>
  {S.nodup(S.typed(S.world(evs))) == True{} : Bool}

# M2: a Message held for ask-first leaves `held` only by the user's deliver or drop.
law m2_held_leaves_only_by_its_owner:
  for evs: +List<M.Ev>
  for e: M.Ev
  {S.implies(Bool.not(S.is_user_call(e)), S.all_in(S.held_af(S.world(evs)), S.held_af(M.step(e, S.world(evs))))) == True{} : Bool}

# M3: nothing typed while the user holds the Terminal, by a Takeover or by unsent input, came from any Actor, the user included, unless the user delivered it by hand (B6: the user's call wins; B32).
# The model records and types in one step, so the one prompt B6 lets through just after takeover.begin does not arise in it.
law m3_takeover_isolates:
  for evs: +List<M.Ev>
  {S.all_in(S.tk_typed(S.world(evs)), S.released(S.world(evs))) == True{} : Bool}

# M4 (the part stated so far): the typed list only grows at its end, so no Message is typed out of order.
law m4_typed_only_grows_at_the_end:
  for evs: +List<M.Ev>
  for e: M.Ev
  {S.is_prefix(S.typed(S.world(evs)), S.typed(M.step(e, S.world(evs)))) == True{} : Bool}

# M5: delivered and dropped Messages are disjoint, and no id is both typed and still waiting.
law m5_terminal_states_are_absorbing:
  for evs: +List<M.Ev>
  {Bool.and(S.disjoint(S.typed(S.world(evs)), S.dropped(S.world(evs))), Bool.and(S.disjoint(S.typed(S.world(evs)), S.queue(S.world(evs))), Bool.and(S.disjoint(S.typed(S.world(evs)), S.held_af(S.world(evs))), S.disjoint(S.typed(S.world(evs)), S.held_tk(S.world(evs)))))) == True{} : Bool}

# M6: every id handed out is in exactly one of pending, held, delivered or dropped.
law m6_no_silent_loss:
  for evs: +List<M.Ev>
  {Nat.add(1n, Nat.add(S.len(S.queue(S.world(evs))), Nat.add(S.len(S.held_af(S.world(evs))), Nat.add(S.len(S.held_tk(S.world(evs))), Nat.add(S.len(S.typed(S.world(evs))), S.len(S.dropped(S.world(evs)))))))) == S.next_id(S.world(evs)) : Nat}

# M7: once the receiver is gone, nothing is pending and nothing waits on a Takeover, and a later send changes nothing (CONFLICT).
law m7_receiver_gone:
  for evs: +List<M.Ev>
  for fu: Bool
  for r: M.Route
  {Bool.and(S.implies(S.gone(S.world(evs)), Bool.and(S.is_nil(S.queue(S.world(evs))), S.is_nil(S.held_tk(S.world(evs))))), S.implies(S.gone(S.world(evs)), Nat.is_eq(S.next_id(M.step(M.Send{fu, r}, S.world(evs))), S.next_id(S.world(evs))))) == True{} : Bool}

# M10: under the fairness assumption that a live receiver turns idle again (cycle), every pending Message is typed.
# Without the assumption nothing is typed from a receiver that stays busy. B32 adds to the assumption that the user's hold on the Terminal ends,
# by the end of a Takeover or by a submit or clear of unsent input (the model's one hold, `takeover_end`).
law m10_pending_to_idle_is_eventually_typed:
  for evs: +List<M.Ev>
  {S.implies(Bool.not(S.gone(S.world(evs))), S.is_nil(S.queue(M.run(S.cycle(S.len(S.queue(S.world(evs)))), S.world(evs))))) == True{} : Bool}

# M9: a restart is a replay of the store. The stored records of a receiver are its Messages by status, their order, whose they are and
# the next id (B8); the state after a restart event has the records that the replay of the records from before it gives (B8: what
# the Terminal's loss drops, what a Takeover held becoming `pending`, what was typed staying typed and never typed again). It
# types nothing, so a Message recorded `delivered` before the kill is not typed twice.
law m9_restart_is_a_replay:
  for evs: +List<M.Ev>
  for alive: Bool
  {S.records(M.step(M.Restart{alive}, S.world(evs))) == S.replay(S.records(S.world(evs)), alive) : S.Rec}

# B39, B40, B30 over the in-flight step (model.bend, `FEv`): a batch is typed in one step, confirmed in one step, and returned to pending by a kill.
# M1 for the in-flight step: a Message is delivered at most once, though a kill types it again.
law b39_delivered_at_most_once:
  for evs: +List<M.FEv>
  {S.nodup(S.f_delivered(S.fworld(evs))) == True{} : Bool}

# M1, M5: a delivered Message is neither pending nor in flight, so a retry after a kill (B40) never types a delivered Message again.
law b39_a_retry_never_retypes_a_delivered_message:
  for evs: +List<M.FEv>
  {Bool.and(S.disjoint(S.f_delivered(S.fworld(evs)), S.f_queue(S.fworld(evs))), S.disjoint(S.f_delivered(S.fworld(evs)), S.f_inflight(S.fworld(evs)))) == True{} : Bool}

# M6: every id handed out is in exactly one of pending, in flight, delivered or dropped: a Message typed and not confirmed is never lost.
law b39_no_silent_loss_in_flight:
  for evs: +List<M.FEv>
  {Nat.add(1n, Nat.add(S.len(S.f_queue(S.fworld(evs))), Nat.add(S.len(S.f_inflight(S.fworld(evs))), Nat.add(S.len(S.f_delivered(S.fworld(evs))), S.len(S.f_dropped(S.fworld(evs))))))) == S.f_next(S.fworld(evs)) : Nat}

# M3: while the user holds the Terminal a batch step puts nothing in flight.
law b39_a_hold_types_no_batch:
  for evs: +List<M.FEv>
  {S.implies(S.f_hold(S.fworld(evs)), S.all_in(S.f_inflight(M.fstep(M.FIdle{}, S.fworld(evs))), S.f_inflight(S.fworld(evs)))) == True{} : Bool}
