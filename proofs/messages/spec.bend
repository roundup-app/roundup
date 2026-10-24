import Base
import ./model.bend as M

# Predicates the laws use. A Builder changes this file only as V3 says (scenarios/proofs.md), as for LAWS.bend.

def implies(a: Bool, b: Bool) -> Bool:
  match a:
    case True{}:
      b
    case False{}:
      True{}

def nodup(xs: +List<Nat>) -> Bool:
  match xs:
    case Nil{}:
      True{}
    case Con{+x, +rest}:
      Bool.and(Bool.not(M.mem(x, rest)), nodup(rest))

def all_in(xs: +List<Nat>, +ys: +List<Nat>) -> Bool:
  match xs:
    case Nil{}:
      True{}
    case Con{+x, rest}:
      Bool.and(M.mem(x, ys), all_in(rest, ys))

def disjoint(xs: +List<Nat>, +ys: +List<Nat>) -> Bool:
  match xs:
    case Nil{}:
      True{}
    case Con{+x, rest}:
      Bool.and(Bool.not(M.mem(x, ys)), disjoint(rest, ys))

def is_prefix(xs: +List<Nat>, +ys: +List<Nat>) -> Bool:
  match xs:
    case Nil{}:
      True{}
    case Con{+x, rest}:
      match ys:
        case Nil{}:
          False{}
        case Con{+y, ys2}:
          Bool.and(Nat.is_eq(x, y), is_prefix(rest, ys2))

def len(xs: +List<Nat>) -> Nat:
  List.length(&2, Nat, xs)

def is_nil(xs: +List<Nat>) -> Bool:
  match xs:
    case Nil{}:
      True{}
    case Con{y, rest}:
      False{}

def is_user_call(e: M.Ev) -> Bool:
  match e:
    case M.Send{fu, r}:
      False{}
    case M.Idle{}:
      False{}
    case M.Busy{}:
      False{}
    case M.Exit{}:
      False{}
    case M.TakeoverBegin{}:
      False{}
    case M.TakeoverEnd{}:
      False{}
    case M.UserDeliver{id}:
      True{}
    case M.UserDrop{id}:
      True{}
    case _:
      False{}

# The fairness schedule of M10: the receiver turns busy and idle again, n times.
def cycle(n: Nat) -> +List<M.Ev>:
  match n:
    case 0n:
      []
    case 1n+p:
      M.Busy{} <> M.Idle{} <> cycle(p)

# Field readers, so a law reads the world through one name each.
def queue(s: M.World) -> +List<Nat>:
  match s:
    case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +us, +i, +g}:
      q

def held_af(s: M.World) -> +List<Nat>:
  match s:
    case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +us, +i, +g}:
      haf

def held_tk(s: M.World) -> +List<Nat>:
  match s:
    case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +us, +i, +g}:
      htk

def typed(s: M.World) -> +List<Nat>:
  match s:
    case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +us, +i, +g}:
      t

def dropped(s: M.World) -> +List<Nat>:
  match s:
    case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +us, +i, +g}:
      d

def users(s: M.World) -> +List<Nat>:
  match s:
    case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +us, +i, +g}:
      u

def tk_typed(s: M.World) -> +List<Nat>:
  match s:
    case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +us, +i, +g}:
      tt

def released(s: M.World) -> +List<Nat>:
  match s:
    case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +us, +i, +g}:
      rl

def next_id(s: M.World) -> Nat:
  match s:
    case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +us, +i, +g}:
      n

def gone(s: M.World) -> Bool:
  match s:
    case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +us, +i, +g}:
      g

def world(evs: +List<M.Ev>) -> M.World:
  M.run(evs, M.init())

# M9: the stored records of a receiver (B8), without the memory a restart loses (takeover, idle, gone) and without the proof-only lists.
type Rec is Data:
  Rec{queue: +List<Nat>, held_af: +List<Nat>, held_tk: +List<Nat>, typed: +List<Nat>, dropped: +List<Nat>, users: +List<Nat>, next: Nat}

def records(s: M.World) -> Rec:
  match s:
    case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +us, +i, +g}:
      Rec{q, haf, htk, t, d, u, n}

# B8, read from the records alone. Terminal survived: what a Takeover held is `pending` behind what waits, `held` for ask-first stays
# `held`, `delivered` and `dropped` keep their status and order. Terminal lost: every `pending` and every Takeover-held Message is
# `dropped` (`receiver gone`).
def replay(r: Rec, alive: Bool) -> Rec:
  match r:
    case Rec{+q, +haf, +htk, +t, +d, +u, +n}:
      match alive:
        case True{}:
          Rec{List.append(&2, Nat, q, htk), haf, [], t, d, u, n}
        case False{}:
          Rec{[], haf, [], t, List.append(&2, Nat, d, List.append(&2, Nat, q, htk)), u, n}

# B39, B40: field readers of the in-flight model and its schedule.
def f_queue(s: M.Fl) -> +List<Nat>:
  match s:
    case M.F{+q, +inf, +t, +d, +n, +hold, +g}:
      q

def f_inflight(s: M.Fl) -> +List<Nat>:
  match s:
    case M.F{+q, +inf, +t, +d, +n, +hold, +g}:
      inf

def f_delivered(s: M.Fl) -> +List<Nat>:
  match s:
    case M.F{+q, +inf, +t, +d, +n, +hold, +g}:
      t

def f_dropped(s: M.Fl) -> +List<Nat>:
  match s:
    case M.F{+q, +inf, +t, +d, +n, +hold, +g}:
      d

def f_next(s: M.Fl) -> Nat:
  match s:
    case M.F{+q, +inf, +t, +d, +n, +hold, +g}:
      n

def f_hold(s: M.Fl) -> Bool:
  match s:
    case M.F{+q, +inf, +t, +d, +n, +hold, +g}:
      hold

def fworld(evs: +List<M.FEv>) -> M.Fl:
  M.frun(evs, M.finit())
