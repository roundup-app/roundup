import Base
import ./model.bend as M
import ./spec.bend as S

# Laws of crates/messages for one receiver, stated over every schedule (a List<Ev>) of model.bend's pure `step`.
# A Builder changes this file only as V3 says (scenarios/proofs.md): review-approved, and a law may only become stronger.
# Stated in part only: M4 (the typed list only grows at its end; B7's ties-by-id is not), M5 (disjointness;
# that ids never change status and rise by one is only counted by M6).
# M2 (a Message waiting on its owner's release) and M3 (isolation of the user's Terminal) are retired with the delivery modes they
# guarded (#3563, scenarios/remove-message-holds.md): no Message waits on anyone but the receiver, and the model has no Terminal write to isolate.

# M1: a Message is delivered at most once, and a prompt that repeats a delivered Message is dropped (B39(e)); a Message sent to the inbox and not confirmed is sent again (B40), so "sent" is not what is counted.
# The model records and sends in one step, so M1 below counts its sent list; b39_delivered_at_most_once counts `delivered` where the receipt, not the send, records it.
law m1_final_and_at_most_once:
  for evs: +List<M.Ev>
  {S.nodup(S.typed(S.world(evs))) == True{} : Bool}

# M4 (the part stated so far): the typed list only grows at its end, so no Message is sent out of order.
law m4_typed_only_grows_at_the_end:
  for evs: +List<M.Ev>
  for e: M.Ev
  {S.is_prefix(S.typed(S.world(evs)), S.typed(M.step(e, S.world(evs)))) == True{} : Bool}

# M5: delivered and dropped Messages are disjoint, and no id is both delivered and still waiting.
law m5_terminal_states_are_absorbing:
  for evs: +List<M.Ev>
  {Bool.and(S.disjoint(S.typed(S.world(evs)), S.dropped(S.world(evs))), S.disjoint(S.typed(S.world(evs)), S.queue(S.world(evs)))) == True{} : Bool}

# M6: every id handed out is in exactly one of pending, delivered or dropped.
law m6_no_silent_loss:
  for evs: +List<M.Ev>
  {Nat.add(1n, Nat.add(S.len(S.queue(S.world(evs))), Nat.add(S.len(S.typed(S.world(evs))), S.len(S.dropped(S.world(evs)))))) == S.next_id(S.world(evs)) : Nat}

# M7: once the receiver is gone, nothing is pending, and a later send changes nothing (CONFLICT).
law m7_receiver_gone:
  for evs: +List<M.Ev>
  for fu: Bool
  for r: M.Route
  {Bool.and(S.implies(S.gone(S.world(evs)), S.is_nil(S.queue(S.world(evs)))), S.implies(S.gone(S.world(evs)), Nat.is_eq(S.next_id(M.step(M.Send{fu, r}, S.world(evs))), S.next_id(S.world(evs))))) == True{} : Bool}

# M10: under the fairness assumption that a live receiver turns idle again (cycle), every pending Message is sent to the inbox.
# Without the assumption nothing is sent to a receiver that stays busy. Nothing else is assumed: no input of the user's delays a Message.
law m10_pending_to_idle_is_eventually_typed:
  for evs: +List<M.Ev>
  {S.implies(Bool.not(S.gone(S.world(evs))), S.is_nil(S.queue(M.run(S.cycle(S.len(S.queue(S.world(evs)))), S.world(evs))))) == True{} : Bool}

# M8: a question follows its chain without looping: the sender is never a hop, no Agent is a hop twice, and every question
# that was asked ends answered or escalated within hops + 1 bounds. The bound is the fuel: one round of the chain is the
# next hop made (B13, B16), the live hop's bound passing (B14), and the Escalated question made when no hop is left (B15), and
# the question has settled after as many rounds as it has hops left, plus one (rest + 1). Fairness assumption: a live hop's bound
# does pass; without it a hop whose Agent never answers and never ends holds the question for ever. The question is answered
# only by the current hop's Agent (B17) or, once escalated, by the user's reply (B15).
law m8_escalation_terminates:
  for evs: +List<M.Ev>
  {Bool.and(S.nodup(S.q_hops(S.qworld(evs))), Bool.and(Bool.not(M.mem(S.q_origin(S.qworld(evs)), S.q_hops(S.qworld(evs)))), S.implies(Bool.not(S.is_noq(S.qworld(evs))), S.settled(M.qrun(S.qcycle(Nat.add(1n, S.len(S.q_rest(S.qworld(evs))))), S.qworld(evs)))))) == True{} : Bool}

# M9: a restart is a replay of the store. The stored records of a receiver are its Messages by status, their order, whose they are and
# the next id (B8); the state after a restart event has the records that the replay of the records from before it gives (B8: what
# the Terminal's loss drops, what was sent staying sent and never sent again). It
# sends nothing, so a Message recorded `delivered` before the kill is not sent twice.
law m9_restart_is_a_replay:
  for evs: +List<M.Ev>
  for alive: Bool
  {S.records(M.step(M.Restart{alive}, S.world(evs))) == S.replay(S.records(S.world(evs)), alive) : S.Rec}

# B39, B40, B30 over the in-flight step (model.bend, `FEv`): a batch is sent in one step, confirmed in one step, and returned to pending by a kill.
# M1 for the in-flight step: a Message is delivered at most once, though a kill sends it again.
law b39_delivered_at_most_once:
  for evs: +List<M.FEv>
  {S.nodup(S.f_delivered(S.fworld(evs))) == True{} : Bool}

# M1, M5: a delivered Message is neither pending nor in flight, so a retry after a kill (B40) never sends a delivered Message again.
law b39_a_retry_never_retypes_a_delivered_message:
  for evs: +List<M.FEv>
  {Bool.and(S.disjoint(S.f_delivered(S.fworld(evs)), S.f_queue(S.fworld(evs))), S.disjoint(S.f_delivered(S.fworld(evs)), S.f_inflight(S.fworld(evs)))) == True{} : Bool}

# M6: every id handed out is in exactly one of pending, in flight, delivered or dropped: a Message sent and not confirmed is never lost.
law b39_no_silent_loss_in_flight:
  for evs: +List<M.FEv>
  {Nat.add(1n, Nat.add(S.len(S.f_queue(S.fworld(evs))), Nat.add(S.len(S.f_inflight(S.fworld(evs))), Nat.add(S.len(S.f_delivered(S.fworld(evs))), S.len(S.f_dropped(S.fworld(evs))))))) == S.f_next(S.fworld(evs)) : Nat}
