import Base

# Pure model of `step` in crates/messages for ONE receiver (docs/messages.md; B1 to B9, B37). A Message is its id.
# Its status is the list its id sits in. A question is an ordinary Message: nothing passes it on.

type Route is Data:
  Auto{}
  AskFirst{}
  RouteDrop{}

# B37 projection (docs/messages.md, lifecycle-to-model mapping): Idle/World.idle denote
# delivery readiness, not the literal Kind. A current Attempt with a running Terminal at
# idle or error after StopFailure supplies Idle; live error is not Exit. Send uses that
# readiness for new Messages; Idle flushes pending ones in their existing ranks. Routes
# still hold/drop, and Takeover/UserInput still prevent automatic typing until their own
# release; UserDeliver retains the explicit user override, not new TakeoverBegin consent.
# A Busy typing refusal supplies no Type effect and preserves pending/takeover-held work:
# Rust rolls back its pre-typing record, whereas this model records and types atomically.
# Busy clears readiness until a subsequent Idle. Actual current-Attempt ending (even with
# last Kind error), done or removal supplies Exit; gone blocks later Idle and Send.
# Filter older-Attempt/stale-revision observations before step: they supply no event for
# the current receiver and cannot reopen it or end a resumed Attempt. A new Attempt has
# a new receiver generation; final Message ids never revive. A35 projections below apply
# after this classification. M1/M4/M6/M7/M10 keep their guards and fair-Idle assumption;
# perpetual Busy cannot guarantee progress. These proofs cover the model, not the Rust
# lifecycle projection: #1847 owns its B37 repair and runtime observers.
# No event, transition or law is added to represent a vendor hook name.
type Ev is Data:
  Send{from_user: Bool, route: Route}
  Idle{}
  Busy{}
  Exit{}
  TakeoverBegin{}
  TakeoverEnd{}
  UserInput{}
  UserSubmit{}
  UserClear{}
  UserDeliver{id: Nat}
  UserDrop{id: Nat}
  Restart{alive: Bool}

# queue: `pending` ids, in the order they became deliverable (B7).
# held_af: `held` for ask-first. held_tk: `held` for takeover.
# typed: `delivered` ids, in the order they were written. dropped: `dropped` ids.
# users: ids the user sent. takeover and unsent are independent Terminal holds (B6/B32).
# next: the next id. idle: delivery readiness. gone: the receiver has ended.
# tk_typed is a proof-only record of the ids typed while either Terminal hold was active; released holds the ids the user delivered
# by hand (B6: the user's call wins even during a Takeover). The Rust derives both by replay.
type World is Data:
  W{queue: +List<Nat>, held_af: +List<Nat>, held_tk: +List<Nat>, typed: +List<Nat>, dropped: +List<Nat>, users: +List<Nat>, tk_typed: +List<Nat>, released: +List<Nat>, next: Nat, takeover: Bool, unsent: Bool, idle: Bool, gone: Bool}

def init() -> World:
  W{[], [], [], [], [], [], [], [], 1n, False{}, False{}, False{}, False{}}

def mem(+x: Nat, xs: +List<Nat>) -> Bool:
  match xs:
    case Nil{}:
      False{}
    case Con{+y, rest}:
      Bool.or(Nat.is_eq(x, y), mem(x, rest))

def remove_step(b: Bool, +y: Nat, tail: +List<Nat>) -> +List<Nat>:
  match b:
    case True{}:
      tail
    case False{}:
      y <> tail

def remove(+x: Nat, xs: +List<Nat>) -> +List<Nat>:
  match xs:
    case Nil{}:
      []
    case Con{+y, rest}:
      remove_step(Nat.is_eq(x, y), y, remove(x, rest))

def snoc(xs: +List<Nat>, +x: Nat) -> +List<Nat>:
  List.append(&2, Nat, xs, [x])

def record(tk: Bool, +x: Nat, tt: +List<Nat>) -> +List<Nat>:
  match tk:
    case True{}:
      snoc(tt, x)
    case False{}:
      tt

# B2, B7, B30: an idle receiver outside a Takeover is typed every Message pending, in queue order, as one prompt, and is then busy.
# The model leaves the byte cap out: the cap only leaves a tail pending, which the next idle types.
def flush_go(q: +List<Nat>, s: World) -> World:
  match q:
    case Nil{}:
      s
    case Con{+x, +rest}:
      match s:
        case W{+q0, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +us, +i, +g}:
          flush_go(rest, W{[], haf, htk, snoc(t, x), d, u, record(Bool.or(tk, us), x, tt), rl, n, tk, us, False{}, g})

def flush_b(i: Bool, s: World) -> World:
  match i:
    case False{}:
      s
    case True{}:
      match s:
        case W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +us, +i, +g}:
          flush_go(q, W{[], haf, htk, t, d, u, tt, rl, n, tk, us, i, g})

def flush(s: World) -> World:
  match s:
    case W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +us, +i, +g}:
      flush_b(i, W{q, haf, htk, t, d, u, tt, rl, n, tk, us, i, g})

def keep_step(b: Bool, +x: Nat, tail: +List<Nat>) -> +List<Nat>:
  match b:
    case True{}:
      x <> tail
    case False{}:
      tail

def drop_step(b: Bool, +x: Nat, tail: +List<Nat>) -> +List<Nat>:
  match b:
    case True{}:
      tail
    case False{}:
      x <> tail

def keep_users(q: +List<Nat>, +u: +List<Nat>) -> +List<Nat>:
  match q:
    case Nil{}:
      []
    case Con{+x, rest}:
      keep_step(mem(x, u), x, keep_users(rest, u))


def drop_users(q: +List<Nat>, +u: +List<Nat>) -> +List<Nat>:
  match q:
    case Nil{}:
      []
    case Con{+x, rest}:
      drop_step(mem(x, u), x, drop_users(rest, u))

def owned(fu: Bool, +n: Nat, u: +List<Nat>) -> +List<Nat>:
  match fu:
    case True{}:
      snoc(u, n)
    case False{}:
      u

# B6, B32: while the user holds the Terminal, by a Takeover or by unsent input, a Message from any Actor, the user included, is held.
def send_route(fu: Bool, tk: Bool, s: World) -> World:
  match fu:
    case True{}:
      match tk:
        case True{}:
          match s:
            case W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +us, +i, +g}:
              W{q, haf, snoc(htk, n), t, d, snoc(u, n), tt, rl, 1n+n, tk, us, i, g}
        case False{}:
          match s:
            case W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +us, +i, +g}:
              flush(W{snoc(q, n), haf, htk, t, d, snoc(u, n), tt, rl, 1n+n, tk, us, i, g})
    case False{}:
      match tk:
        case True{}:
          match s:
            case W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +us, +i, +g}:
              W{q, haf, snoc(htk, n), t, d, u, tt, rl, 1n+n, tk, us, i, g}
        case False{}:
          match s:
            case W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +us, +i, +g}:
              flush(W{snoc(q, n), haf, htk, t, d, u, tt, rl, 1n+n, tk, us, i, g})

def send_auto(fu: Bool, s: World) -> World:
  match s:
    case W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +us, +i, +g}:
      send_route(fu, Bool.or(tk, us), W{q, haf, htk, t, d, u, tt, rl, n, tk, us, i, g})

def send_live(r: Route, fu: Bool, s: World) -> World:
  match r:
    case Auto{}:
      send_auto(fu, s)
    case AskFirst{}:
      match s:
        case W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +us, +i, +g}:
          W{q, snoc(haf, n), htk, t, d, owned(fu, n, u), tt, rl, 1n+n, tk, us, i, g}
    case RouteDrop{}:
      match s:
        case W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +us, +i, +g}:
          W{q, haf, htk, t, snoc(d, n), owned(fu, n, u), tt, rl, 1n+n, tk, us, i, g}

# B9: a later send to a gone receiver is CONFLICT and changes nothing.
def send(r: Route, fu: Bool, g: Bool, s: World) -> World:
  match g:
    case True{}:
      s
    case False{}:
      send_live(r, fu, s)

# B6, B32: the user takes hold of the Terminal, by a Takeover or by typing: every pending Message waits, whoever sent it
# (the users whose Messages are kept pending are none: `keep_users(q, [])` is empty and `drop_users(q, [])` is `q`).
def takeover_begin(s: World) -> World:
  match s:
    case W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +us, +i, +g}:
      W{keep_users(q, []), haf, List.append(&2, Nat, htk, drop_users(q, [])), t, d, u, tt, rl, n, True{}, us, i, g}

# B6/B32: only the last release makes held Messages pending.
def release(held: Bool, s: World) -> World:
  match held:
    case True{}:
      s
    case False{}:
      match s:
        case W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +us, +i, +g}:
          flush(W{List.append(&2, Nat, q, htk), haf, [], t, d, u, tt, rl, n, tk, us, i, g})

def takeover_end(s: World) -> World:
  match s:
    case W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +us, +i, +g}:
      release(us, W{q, haf, htk, t, d, u, tt, rl, n, False{}, us, i, g})

def user_input(s: World) -> World:
  match s:
    case W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +us, +i, +g}:
      W{keep_users(q, []), haf, List.append(&2, Nat, htk, drop_users(q, [])), t, d, u, tt, rl, n, tk, True{}, i, g}

def user_submit(s: World) -> World:
  match s:
    case W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +us, +i, +g}:
      release(tk, W{q, haf, htk, t, d, u, tt, rl, n, tk, False{}, i, g})

# B9: a receiver that is gone has no pending Message; what a Takeover held is dropped with it.
def exit_(s: World) -> World:
  match s:
    case W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +us, +i, +g}:
      W{[], haf, [], t, List.append(&2, Nat, d, List.append(&2, Nat, q, htk)), u, tt, rl, n, tk, us, False{}, True{}}

def deliver_if(b: Bool, +id: Nat, s: World) -> World:
  match b:
    case False{}:
      s
    case True{}:
      match s:
        case W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +us, +i, +g}:
          flush(W{snoc(q, id), remove(id, haf), htk, t, d, u, tt, snoc(rl, id), n, tk, us, i, g})

def drop_if(b: Bool, +id: Nat, s: World) -> World:
  match b:
    case False{}:
      s
    case True{}:
      match s:
        case W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +us, +i, +g}:
          W{q, remove(id, haf), htk, t, snoc(d, id), u, tt, rl, n, tk, us, i, g}

def deliver_tk(b: Bool, +id: Nat, s: World) -> World:
  match b:
    case False{}:
      s
    case True{}:
      match s:
        case W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +us, +i, +g}:
          flush(W{snoc(q, id), haf, remove(id, htk), t, d, u, tt, snoc(rl, id), n, tk, us, i, g})

def deliver_pick(a: Bool, b: Bool, +id: Nat, s: World) -> World:
  match a:
    case True{}:
      deliver_if(True{}, id, s)
    case False{}:
      deliver_tk(b, id, s)

# B3, B6: the user can deliver a Message held for ask-first or for a Takeover, and not once the receiver is gone (B9).
def user_deliver(+id: Nat, s: World) -> World:
  match s:
    case W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +us, +i, +g}:
      deliver_pick(Bool.and(mem(id, haf), Bool.not(g)), Bool.and(mem(id, htk), Bool.not(g)), id, W{q, haf, htk, t, d, u, tt, rl, n, tk, us, i, g})

def drop_tk(b: Bool, +id: Nat, s: World) -> World:
  match b:
    case False{}:
      s
    case True{}:
      match s:
        case W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +us, +i, +g}:
          W{q, haf, remove(id, htk), t, snoc(d, id), u, tt, rl, n, tk, us, i, g}

# U3782: a `pending` Message the user sent, with no in-flight record (the model types atomically), is dropped (reason `removed`): it leaves the queue, nothing is typed.
def drop_q(b: Bool, +id: Nat, s: World) -> World:
  match b:
    case False{}:
      s
    case True{}:
      match s:
        case W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +us, +i, +g}:
          W{remove(id, q), haf, htk, t, snoc(d, id), u, tt, rl, n, tk, us, i, g}

def drop_pick(a: Bool, b: Bool, c: Bool, +id: Nat, s: World) -> World:
  match a:
    case True{}:
      drop_if(True{}, id, s)
    case False{}:
      match b:
        case True{}:
          drop_tk(True{}, id, s)
        case False{}:
          drop_q(c, id, s)

# B3, B6 as amended in #222 (a dependency: merge #222 first): the user can drop a Message held for ask-first or for a Takeover; the Takeover goes on.
# U3782, B39: the user can also drop a `pending` Message the user sent that has no in-flight record.
def user_drop(+id: Nat, s: World) -> World:
  match s:
    case W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +us, +i, +g}:
      drop_pick(mem(id, haf), mem(id, htk), Bool.and(mem(id, q), mem(id, u)), id, W{q, haf, htk, t, d, u, tt, rl, n, tk, us, i, g})

def set_idle(b: Bool, s: World) -> World:
  match s:
    case W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +us, +i, +g}:
      W{q, haf, htk, t, d, u, tt, rl, n, tk, us, b, g}

def idle_ev(s: World) -> World:
  match s:
    case W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +us, +i, +g}:
      match g:
        case True{}:
          W{q, haf, htk, t, d, u, tt, rl, n, tk, us, i, g}
        case False{}:
          flush(W{q, haf, htk, t, d, u, tt, rl, n, tk, us, True{}, g})

def busy_ev(s: World) -> World:
  set_idle(False{}, s)

def send_ev(fu: Bool, r: Route, s: World) -> World:
  match s:
    case W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +us, +i, +g}:
      send(r, fu, g, W{q, haf, htk, t, d, u, tt, rl, n, tk, us, i, g})

# B8: the Daemon is killed and started again. Nothing is typed: a Message is recorded `delivered` before it is typed, so what
# was typed stays typed and is never typed again. If the Terminal did not survive (A12), the receiver is gone and every
# `pending` Message and every one `held` for a Takeover is `dropped` as B9 says (and no Takeover survives, B6); if it did, no Takeover survives (B6), so what
# one held becomes `pending` behind what already waits, and the receiver is not yet known to be idle.
def restart(alive: Bool, s: World) -> World:
  match alive:
    case True{}:
      match s:
        case W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +us, +i, +g}:
          W{List.append(&2, Nat, q, htk), haf, [], t, d, u, tt, rl, n, False{}, False{}, False{}, g}
    case False{}:
      match s:
        case W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +us, +i, +g}:
          W{[], haf, [], t, List.append(&2, Nat, d, List.append(&2, Nat, q, htk)), u, tt, rl, n, False{}, False{}, False{}, True{}}

# The whole transition table: one pure, total function of the world and one event.
def step(e: Ev, s: World) -> World:
  match e:
    case Send{fu, r}:
      send_ev(fu, r, s)
    case Idle{}:
      idle_ev(s)
    case Busy{}:
      busy_ev(s)
    case Exit{}:
      exit_(s)
    case TakeoverBegin{}:
      takeover_begin(s)
    case TakeoverEnd{}:
      takeover_end(s)
    case UserInput{}:
      user_input(s)
    case UserSubmit{}:
      user_submit(s)
    case UserClear{}:
      user_submit(s)
    case UserDeliver{id}:
      user_deliver(id, s)
    case UserDrop{id}:
      user_drop(id, s)
    case Restart{alive}:
      restart(alive, s)
    case _:
      s

# A schedule is a list of events; every law quantifies over every such list.
def run(evs: +List<Ev>, s: World) -> World:
  match evs:
    case Nil{}:
      s
    case Con{e, rest}:
      run(rest, step(e, s))

# A35: durable reservation projects temporary stop/error, next Attempt and reopen to Busy,
# never Exit (final receiver ending). A final removal bypasses the reservation. Releasing
# after matching SessionStart/first-prompt acknowledgement supplies Idle when ready,
# including B37 live error. A reopened Takeover releases via Restart{True} first.
# Ask-first holds are unchanged.
# This projection is shared with Rust's restart_event; ordinary step and all laws stay intact.
def restart_event(reserved: Bool, e: Ev) -> Ev:
  match reserved:
    case False{}:
      e
    case True{}:
      match e:
        case Idle{}:
          Busy{}
        case Exit{}:
          Busy{}
        case Restart{alive}:
          Busy{}
        case _:
          e

def restart_schedule(+reserved: Bool, evs: +List<Ev>) -> +List<Ev>:
  match evs:
    case Nil{}:
      []
    case Con{e, rest}:
      restart_event(reserved, e) <> restart_schedule(reserved, rest)

# Every reservation window begins Busy, so user release/send cannot flush an earlier Idle.
def restart_window(before: +List<Ev>, during: +List<Ev>, after: +List<Ev>) -> +List<Ev>:
  List.append(&2, Ev, before, Busy{} <> List.append(&2, Ev, restart_schedule(True{}, during), after))

# The lifecycle has already typed the first prompt. Acknowledgement appends one delivered
# record using the shared id supply, never an Idle/Type effect or a queue flush.
type PromptRecord is Data:
  Unrecorded{}
  Recorded{id: Nat}

type PromptJournal is Data:
  Journal{record: PromptRecord, world: World}

def record_prompt(j: PromptJournal) -> PromptJournal:
  match j:
    case Journal{record, world}:
      match record:
        case Recorded{id}:
          Journal{Recorded{id}, world}
        case Unrecorded{}:
          match world:
            case W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +us, +i, +g}:
              Journal{Recorded{n}, W{q, haf, htk, snoc(t, n), d, snoc(u, n), tt, rl, 1n+n, tk, us, i, g}}

def journal_world(j: PromptJournal) -> World:
  match j:
    case Journal{record, world}:
      world

# The reservation bit and prompt journal belong to the stored frame, not to the Terminal's
# memory. Reopen replays that bit before it interprets receiver loss, retaining the journal.
type ReservationStore is Data:
  Stored{reserved: Bool, journal: PromptJournal}

# B6/B32 memory vanishes on reopen. Reserved takeover-held records wait for explicit release;
# clearing memory here must not promote them early or put a new auto Message under a lost hold.
def reopen_reserved(world: World) -> World:
  match world:
    case W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +us, +i, +g}:
      W{q, haf, htk, t, d, u, tt, rl, n, False{}, False{}, False{}, g}

def reopen_world(reserved: Bool, world: World, alive: Bool) -> World:
  match reserved:
    case True{}:
      reopen_reserved(world)
    case False{}:
      step(Restart{alive}, world)

def reopen_store(s: ReservationStore, alive: Bool) -> ReservationStore:
  match s:
    case Stored{+reserved, journal}:
      match journal:
        case Journal{record, world}:
          Stored{reserved, Journal{record, reopen_world(reserved, world, alive)}}

def store_reserved(s: ReservationStore) -> Bool:
  match s:
    case Stored{reserved, journal}:
      reserved

def store_journal(s: ReservationStore) -> PromptJournal:
  match s:
    case Stored{reserved, journal}:
      journal

# A35 retirement is distinct from ordinary final Exit and a retained restart. The durable
# selected state never becomes eligible again, even after completion/reopen. It gives no
# Takeover consent. Authorized Takeover end clears memory separately, preserving its records.
type Retirement is Data:
  Removing{}
  Removed{}

def complete_retirement(r: Retirement) -> Retirement:
  Removed{}

def retirement_eligible(r: Retirement) -> Bool:
  False{}

# Mirrors Rust retirement_event: both retirement states block new send/manual delivery and
# project automatic lifecycle events to Busy. Explicit Drop/Pass retain their existing Actor permissions.
def retirement_event(r: Retirement, e: Ev) -> Ev:
  match e:
    case Send{from_user, route}:
      Busy{}
    case UserDeliver{id}:
      Busy{}
    case TakeoverBegin{}:
      Busy{}
    case TakeoverEnd{}:
      Busy{}
    case UserInput{}:
      Busy{}
    case UserSubmit{}:
      Busy{}
    case UserClear{}:
      Busy{}
    case _:
      restart_event(True{}, e)

# Durable frame replay keeps the same selection and completion, regardless of Rail presence.
type RetirementStore is Data:
  Retained{retirement: Retirement, world: World}

def reopen_retirement(s: RetirementStore) -> RetirementStore:
  match s:
    case Retained{r, w}:
      Retained{r, reopen_reserved(w)}

def retirement_world(s: RetirementStore) -> World:
  match s:
    case Retained{r, w}:
      w

# Consent was checked by the coordinator; this ends only the in-memory Takeover, not its hold.
def retirement_takeover_end(w: World) -> World:
  match w:
    case W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +us, +i, +g}:
      W{q, haf, htk, t, d, u, tt, rl, n, False{}, us, False{}, g}

def retirement_state(s: RetirementStore) -> Retirement:
  match s:
    case Retained{r, w}:
      r

# ---- the in-flight step (B39, B40), one receiver
# `World` above records and types a Message in one step. The Rust types it first and records `delivered` only when the Agent's
# `UserPromptSubmit` Signal confirms the prompt (B39), so this model has the step between: `FIdle` types every Message pending as one
# batch (B30) and leaves it in flight, `FConfirm` is the Signal that confirms the batch, and `FKill` is a Daemon killed (B8) and started again,
# which returns what was in flight to the front of the queue to be typed again (B40). The Daemon types a batch only while none is in flight
# and the user does not hold the Terminal (B6, B32, the `typing` guard). A repeated prompt that the hook drops (B39(d)) changes no state, so it
# is no event. `FExit` is B9: the receiver is gone and what waits or is in flight is dropped.
type FEv is Data:
  FSend{}
  FIdle{}
  FConfirm{}
  FKill{}
  FHold{}
  FRelease{}
  FExit{}

type Fl is Data:
  F{queue: +List<Nat>, inflight: +List<Nat>, delivered: +List<Nat>, dropped: +List<Nat>, next: Nat, hold: Bool, gone: Bool}

def finit() -> Fl:
  F{[], [], [], [], 1n, False{}, False{}}

# B30: the whole queue is one batch, in queue order. Nothing is typed while a batch is in flight or the user holds the Terminal.
def fidle_go(inf: +List<Nat>, +q: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, hold: Bool, g: Bool) -> Fl:
  match inf:
    case Nil{}:
      F{[], q, t, d, n, hold, g}
    case Con{+x, +rest}:
      F{q, x <> rest, t, d, n, hold, g}

def fidle_live(hold: Bool, s: Fl) -> Fl:
  match hold:
    case True{}:
      s
    case False{}:
      match s:
        case F{+q, +inf, +t, +d, +n, +hold, +g}:
          fidle_go(inf, q, t, d, n, hold, g)

def fidle(s: Fl) -> Fl:
  match s:
    case F{+q, +inf, +t, +d, +n, +hold, +g}:
      match g:
        case True{}:
          s
        case False{}:
          fidle_live(hold, s)

# B9: a later send to a gone receiver is CONFLICT and changes nothing.
def fsend(s: Fl) -> Fl:
  match s:
    case F{+q, +inf, +t, +d, +n, +hold, +g}:
      match g:
        case True{}:
          s
        case False{}:
          F{snoc(q, n), inf, t, d, 1n+n, hold, g}

# B39(c): the Signal records every Message of the batch `delivered`, in order, in one write.
def fconfirm(s: Fl) -> Fl:
  match s:
    case F{+q, +inf, +t, +d, +n, +hold, +g}:
      F{q, [], List.append(&2, Nat, t, inf), d, n, hold, g}

# B40, B8: what was in flight is `pending` again, ahead of what was sent after it; no Takeover survives a restart.
def fkill(s: Fl) -> Fl:
  match s:
    case F{+q, +inf, +t, +d, +n, +hold, +g}:
      F{List.append(&2, Nat, inf, q), [], t, d, n, False{}, g}

def fhold(b: Bool, s: Fl) -> Fl:
  match s:
    case F{+q, +inf, +t, +d, +n, +hold, +g}:
      F{q, inf, t, d, n, b, g}

def fexit(s: Fl) -> Fl:
  match s:
    case F{+q, +inf, +t, +d, +n, +hold, +g}:
      F{[], [], t, List.append(&2, Nat, d, List.append(&2, Nat, q, inf)), n, hold, True{}}

def fstep(e: FEv, s: Fl) -> Fl:
  match e:
    case FSend{}:
      fsend(s)
    case FIdle{}:
      fidle(s)
    case FConfirm{}:
      fconfirm(s)
    case FKill{}:
      fkill(s)
    case FHold{}:
      fhold(True{}, s)
    case FRelease{}:
      fhold(False{}, s)
    case FExit{}:
      fexit(s)

def frun(evs: +List<FEv>, s: Fl) -> Fl:
  match evs:
    case Nil{}:
      s
    case Con{e, rest}:
      frun(rest, fstep(e, s))
