import Base

# Pure model of `step` in crates/messages for ONE receiver (docs/messages.md; B1, B2, B5 to B9, B37) and for ONE question's
# escalation chain (B13 to B17). A Message is its id. Its status is the list its id sits in.
# The chain's own state is the Question `Q`; `step` runs the delivery events on the World and `qstep` the chain
# events on the Question, and each leaves the other's state alone: a hop is an ordinary Message (B13), so its
# delivery is the World's M1 to M7, and what the chain adds is which Agent is the next hop and when.
# Every Message to an Agent goes to its Claude inbox once the receiver is idle: `typed` is the list of ids so sent.
# There is no other way into the receiver and no Message waits on anything but the receiver's readiness.

type Route is Data:
  Auto{}
  RouteDrop{}

# B37 projection (docs/messages.md, lifecycle-to-model mapping): Idle/World.idle denote
# delivery readiness, not the literal Kind. A current Attempt with a running Terminal at
# idle or error after StopFailure supplies Idle; live error is not Exit. Send uses that
# readiness for new Messages; Idle flushes pending ones in their existing ranks. Routes
# only deliver or drop.
# A Busy refusal supplies no Type effect and preserves pending work:
# Rust rolls back its pre-send record, whereas this model records and sends atomically.
# Busy clears readiness until a subsequent Idle. Actual current-Attempt ending (even with
# last Kind error), done or removal supplies Exit; gone blocks later Idle and Send.
# Filter older-Attempt/stale-revision observations before step: they supply no event for
# the current receiver and cannot reopen it or end a resumed Attempt. A new Attempt has
# a new receiver generation; final Message ids never revive. A35 projections below apply
# after this classification. M1/M4/M6/M7/M10 keep their guards and fair-Idle assumption;
# perpetual Busy cannot guarantee progress. These proofs cover the model, not the Rust
# lifecycle projection: #1847 owns its B37 repair and runtime/Decision-note observers.
# No event, transition or law is added to represent a vendor hook name.
type Ev is Data:
  Send{from_user: Bool, route: Route}
  Idle{}
  Busy{}
  Exit{}
  UserDrop{id: Nat}
  Restart{alive: Bool}
  Ask{origin: Nat, chain: +List<Nat>}
  HopMade{}
  HopEnded{}
  BoundPassed{}
  Answer{}
  Escalate{}
  Reply{}

# queue: `pending` ids, in the order they became deliverable (B7).
# typed: `delivered` ids, in the order they were sent to the inbox. dropped: `dropped` ids.
# users: ids the user sent. next: the next id. idle: delivery readiness. gone: the receiver has ended.
type World is Data:
  W{queue: +List<Nat>, typed: +List<Nat>, dropped: +List<Nat>, users: +List<Nat>, next: Nat, idle: Bool, gone: Bool}

def init() -> World:
  W{[], [], [], [], 1n, False{}, False{}}

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

# B2, B7, B30: an idle receiver is sent every Message pending, in queue order, as one prompt, and is then busy.
# The model leaves the byte cap out: the cap only leaves a tail pending, which the next idle sends.
def flush_go(q: +List<Nat>, s: World) -> World:
  match q:
    case Nil{}:
      s
    case Con{+x, +rest}:
      match s:
        case W{+q0, +t, +d, +u, +n, +i, +g}:
          flush_go(rest, W{[], snoc(t, x), d, u, n, False{}, g})

def flush_b(i: Bool, s: World) -> World:
  match i:
    case False{}:
      s
    case True{}:
      match s:
        case W{+q, +t, +d, +u, +n, +i, +g}:
          flush_go(q, W{[], t, d, u, n, i, g})

def flush(s: World) -> World:
  match s:
    case W{+q, +t, +d, +u, +n, +i, +g}:
      flush_b(i, W{q, t, d, u, n, i, g})

def owned(fu: Bool, +n: Nat, u: +List<Nat>) -> +List<Nat>:
  match fu:
    case True{}:
      snoc(u, n)
    case False{}:
      u

# B1, B2: a Message from any Actor, the user included, is pending and is sent at once when the receiver is idle.
def send_auto(fu: Bool, s: World) -> World:
  match s:
    case W{+q, +t, +d, +u, +n, +i, +g}:
      flush(W{snoc(q, n), t, d, owned(fu, n, u), 1n+n, i, g})

def send_live(r: Route, fu: Bool, s: World) -> World:
  match r:
    case Auto{}:
      send_auto(fu, s)
    case RouteDrop{}:
      match s:
        case W{+q, +t, +d, +u, +n, +i, +g}:
          W{q, t, snoc(d, n), owned(fu, n, u), 1n+n, i, g}

# B9: a later send to a gone receiver is CONFLICT and changes nothing.
def send(r: Route, fu: Bool, g: Bool, s: World) -> World:
  match g:
    case True{}:
      s
    case False{}:
      send_live(r, fu, s)

# B9: a receiver that is gone has no pending Message.
def exit_(s: World) -> World:
  match s:
    case W{+q, +t, +d, +u, +n, +i, +g}:
      W{[], t, List.append(&2, Nat, d, q), u, n, False{}, True{}}

# U3782: a `pending` Message, with no in-flight record (the model sends atomically), is dropped (reason `removed`): it leaves the queue, nothing is sent.
def drop_q(b: Bool, +id: Nat, s: World) -> World:
  match b:
    case False{}:
      s
    case True{}:
      match s:
        case W{+q, +t, +d, +u, +n, +i, +g}:
          W{remove(id, q), t, snoc(d, id), u, n, i, g}

def user_drop(+id: Nat, s: World) -> World:
  match s:
    case W{+q, +t, +d, +u, +n, +i, +g}:
      drop_q(mem(id, q), id, W{q, t, d, u, n, i, g})

def set_idle(b: Bool, s: World) -> World:
  match s:
    case W{+q, +t, +d, +u, +n, +i, +g}:
      W{q, t, d, u, n, b, g}

def idle_ev(s: World) -> World:
  match s:
    case W{+q, +t, +d, +u, +n, +i, +g}:
      match g:
        case True{}:
          W{q, t, d, u, n, i, g}
        case False{}:
          flush(W{q, t, d, u, n, True{}, g})

def busy_ev(s: World) -> World:
  set_idle(False{}, s)

def send_ev(fu: Bool, r: Route, s: World) -> World:
  match s:
    case W{+q, +t, +d, +u, +n, +i, +g}:
      send(r, fu, g, W{q, t, d, u, n, i, g})

# B8: the Daemon is killed and started again. Nothing is sent: a Message is recorded `delivered` before it is sent, so what
# was sent stays sent and is never sent again. If the Terminal did not survive (A12), the receiver is gone and every
# `pending` Message is `dropped` as B9 says; if it did, the receiver is not yet known to be idle.
def restart(alive: Bool, s: World) -> World:
  match alive:
    case True{}:
      match s:
        case W{+q, +t, +d, +u, +n, +i, +g}:
          W{q, t, d, u, n, False{}, g}
    case False{}:
      match s:
        case W{+q, +t, +d, +u, +n, +i, +g}:
          W{[], t, List.append(&2, Nat, d, q), u, n, False{}, True{}}

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

# ---- the escalation chain (B13 to B17), one question

# NoQ: no question yet. Chained: the chain is read, no hop made. OnHop: the current hop is live.
# Ended: the current hop ended without an answer, the next is due. Answered: B17 stopped the bubble, or the user answered.
# Escalated: the Escalated question was made and the user has it at once (B15); only the user's reply answers it.
type Phase is Data:
  NoQ{}
  Chained{}
  OnHop{}
  Ended{}
  Answered{}
  Escalated{}

# origin: the sender, never a hop. rest: the hops still to make, nearest first. hops: the hops made, latest first.
# bounds: how many per-hop bounds (B14) have passed.
type Q is Data:
  Qn{ph: Phase, origin: Nat, rest: +List<Nat>, hops: +List<Nat>, bounds: Nat}

def qinit() -> Q:
  Qn{NoQ{}, 0n, [], [], 0n}

# B13: the chain as read when the sender sends: the sender skipped, an Agent at most once.
def clean_step(b: Bool, +x: Nat, tail: +List<Nat>) -> +List<Nat>:
  match b:
    case True{}:
      tail
    case False{}:
      x <> tail

def clean(+o: Nat, xs: +List<Nat>) -> +List<Nat>:
  match xs:
    case Nil{}:
      []
    case Con{+x, +rest}:
      clean_step(Bool.or(Nat.is_eq(x, o), mem(x, rest)), x, clean(o, rest))

# B13: the question is sent; the chain is read once (a Rail move afterwards changes nothing), and it is the only question.
def ask(+o: Nat, chain: +List<Nat>, q: Q) -> Q:
  match q:
    case Qn{ph, +o0, +rest, +hops, b}:
      match ph:
        case NoQ{}:
          Qn{Chained{}, o, clean(o, chain), [], 0n}
        case _:
          q

# B13, B16: the next hop is made: the nearest Agent left in the chain, once the chain is read or the last hop ended.
def hop_made_go(ph: Phase, o: Nat, rest: +List<Nat>, hops: +List<Nat>, b: Nat) -> Q:
  match rest:
    case Nil{}:
      Qn{ph, o, [], hops, b}
    case Con{+x, +r}:
      Qn{OnHop{}, o, r, x <> hops, b}

def hop_made(q: Q) -> Q:
  match q:
    case Qn{ph, o, +rest, +hops, b}:
      match ph:
        case Chained{}:
          hop_made_go(Chained{}, o, rest, hops, b)
        case Ended{}:
          hop_made_go(Ended{}, o, rest, hops, b)
        case _:
          Qn{ph, o, rest, hops, b}

# B16: a hop ended without an answer (its Message dropped, or its Agent gone): the next is due at once, with no wait for the bound.
def hop_ended(q: Q) -> Q:
  match q:
    case Qn{ph, o, +rest, +hops, b}:
      match ph:
        case OnHop{}:
          Qn{Ended{}, o, rest, hops, b}
        case _:
          Qn{ph, o, rest, hops, b}

# B14: the live hop's bound ran out; it passes.
def bound_passed(q: Q) -> Q:
  match q:
    case Qn{ph, o, +rest, +hops, b}:
      match ph:
        case OnHop{}:
          Qn{Ended{}, o, rest, hops, 1n+b}
        case _:
          Qn{ph, o, rest, hops, b}

# B17: the current hop's Agent answered; no further hop is made.
def answer(q: Q) -> Q:
  match q:
    case Qn{ph, o, +rest, +hops, b}:
      match ph:
        case OnHop{}:
          Qn{Answered{}, o, rest, hops, b}
        case _:
          Qn{ph, o, rest, hops, b}

# B15: no Door is left; the Escalated question is made, once.
def escalate_go(ph: Phase, o: Nat, rest: +List<Nat>, hops: +List<Nat>, b: Nat) -> Q:
  match rest:
    case Nil{}:
      Qn{Escalated{}, o, [], hops, b}
    case Con{+x, +r}:
      Qn{ph, o, x <> r, hops, b}

def escalate(q: Q) -> Q:
  match q:
    case Qn{ph, o, +rest, +hops, b}:
      match ph:
        case Chained{}:
          escalate_go(Chained{}, o, rest, hops, b)
        case Ended{}:
          escalate_go(Ended{}, o, rest, hops, b)
        case _:
          Qn{ph, o, rest, hops, b}

# B15: the Escalated question is answered only by the user's reply.
def reply(q: Q) -> Q:
  match q:
    case Qn{ph, o, +rest, +hops, b}:
      match ph:
        case Escalated{}:
          Qn{Answered{}, o, rest, hops, b}
        case _:
          Qn{ph, o, rest, hops, b}

# The chain's transition table; the delivery events leave the question alone.
def qstep(e: Ev, q: Q) -> Q:
  match e:
    case Ask{o, chain}:
      ask(o, chain, q)
    case HopMade{}:
      hop_made(q)
    case HopEnded{}:
      hop_ended(q)
    case BoundPassed{}:
      bound_passed(q)
    case Answer{}:
      answer(q)
    case Escalate{}:
      escalate(q)
    case Reply{}:
      reply(q)
    case _:
      q

def qrun(evs: +List<Ev>, q: Q) -> Q:
  match evs:
    case Nil{}:
      q
    case Con{e, rest}:
      qrun(rest, qstep(e, q))

# A35: durable reservation projects temporary stop/error, next Attempt and reopen to Busy,
# never Exit (final receiver ending). A final removal bypasses the reservation. Releasing
# after matching SessionStart/first-prompt acknowledgement supplies Idle when ready,
# including B37 live error.
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
        case HopEnded{}:
          Busy{}
        case BoundPassed{}:
          Busy{}
        case _:
          e

def restart_schedule(+reserved: Bool, evs: +List<Ev>) -> +List<Ev>:
  match evs:
    case Nil{}:
      []
    case Con{e, rest}:
      restart_event(reserved, e) <> restart_schedule(reserved, rest)

# Every reservation window begins Busy, so a send cannot flush an earlier Idle.
def restart_window(before: +List<Ev>, during: +List<Ev>, after: +List<Ev>) -> +List<Ev>:
  List.append(&2, Ev, before, Busy{} <> List.append(&2, Ev, restart_schedule(True{}, during), after))

# The lifecycle has already sent the first prompt. Acknowledgement appends one delivered
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
            case W{+q, +t, +d, +u, +n, +i, +g}:
              Journal{Recorded{n}, W{q, snoc(t, n), d, snoc(u, n), 1n+n, i, g}}

def journal_world(j: PromptJournal) -> World:
  match j:
    case Journal{record, world}:
      world

# The reservation bit and prompt journal belong to the stored frame, not to the Terminal's
# memory. Reopen replays that bit before it interprets receiver loss, retaining the journal.
type ReservationStore is Data:
  Stored{reserved: Bool, journal: PromptJournal}

def reopen_world(reserved: Bool, world: World, alive: Bool) -> World:
  match reserved:
    case True{}:
      world
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
# selected state never becomes eligible again, even after completion/reopen.
type Retirement is Data:
  Removing{}
  Removed{}

def complete_retirement(r: Retirement) -> Retirement:
  Removed{}

def retirement_eligible(r: Retirement) -> Bool:
  False{}

# Mirrors Rust retirement_event: both retirement states block new send
# and project automatic lifecycle events to Busy. Explicit Drop/Pass retain their existing Actor permissions.
def retirement_event(r: Retirement, e: Ev) -> Ev:
  match e:
    case Send{from_user, route}:
      Busy{}
    case _:
      restart_event(True{}, e)

# Durable frame replay keeps the same selection and completion, regardless of Rail presence.
type RetirementStore is Data:
  Retained{retirement: Retirement, world: World}

def reopen_retirement(s: RetirementStore) -> RetirementStore:
  s

def retirement_world(s: RetirementStore) -> World:
  match s:
    case Retained{r, w}:
      w

def retirement_state(s: RetirementStore) -> Retirement:
  match s:
    case Retained{r, w}:
      r

# ---- the in-flight step (B39, B40), one receiver
# `World` above records and sends a Message in one step. The Rust sends it to the inbox first and records `delivered` only when the Agent's
# transcript receipt confirms the prompt (B39), so this model has the step between: `FIdle` sends every Message pending as one
# batch (B30) and leaves it in flight, `FConfirm` is the receipt that confirms the batch, and `FKill` is a Daemon killed (B8) and started again,
# which returns what was in flight to the front of the queue to be sent again (B40). The Daemon sends a batch only while none is in flight.
# A repeated prompt that the hook drops (B39(d)) changes no state, so it
# is no event. `FExit` is B9: the receiver is gone and what waits or is in flight is dropped.
type FEv is Data:
  FSend{}
  FIdle{}
  FConfirm{}
  FKill{}
  FExit{}

type Fl is Data:
  F{queue: +List<Nat>, inflight: +List<Nat>, delivered: +List<Nat>, dropped: +List<Nat>, next: Nat, gone: Bool}

def finit() -> Fl:
  F{[], [], [], [], 1n, False{}}

# B30: the whole queue is one batch, in queue order. Nothing is sent while a batch is in flight.
def fidle_go(inf: +List<Nat>, +q: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, g: Bool) -> Fl:
  match inf:
    case Nil{}:
      F{[], q, t, d, n, g}
    case Con{+x, +rest}:
      F{q, x <> rest, t, d, n, g}

def fidle(s: Fl) -> Fl:
  match s:
    case F{+q, +inf, +t, +d, +n, +g}:
      match g:
        case True{}:
          s
        case False{}:
          fidle_go(inf, q, t, d, n, g)

# B9: a later send to a gone receiver is CONFLICT and changes nothing.
def fsend(s: Fl) -> Fl:
  match s:
    case F{+q, +inf, +t, +d, +n, +g}:
      match g:
        case True{}:
          s
        case False{}:
          F{snoc(q, n), inf, t, d, 1n+n, g}

# B39(c): the receipt records every Message of the batch `delivered`, in order, in one write.
def fconfirm(s: Fl) -> Fl:
  match s:
    case F{+q, +inf, +t, +d, +n, +g}:
      F{q, [], List.append(&2, Nat, t, inf), d, n, g}

# B40, B8: what was in flight is `pending` again, ahead of what was sent after it.
def fkill(s: Fl) -> Fl:
  match s:
    case F{+q, +inf, +t, +d, +n, +g}:
      F{List.append(&2, Nat, inf, q), [], t, d, n, g}

def fexit(s: Fl) -> Fl:
  match s:
    case F{+q, +inf, +t, +d, +n, +g}:
      F{[], [], t, List.append(&2, Nat, d, List.append(&2, Nat, q, inf)), n, True{}}

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
    case FExit{}:
      fexit(s)

def frun(evs: +List<FEv>, s: Fl) -> Fl:
  match evs:
    case Nil{}:
      s
    case Con{e, rest}:
      frun(rest, fstep(e, s))
