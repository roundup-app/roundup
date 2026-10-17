import Base
import ./LAWS.bend as Laws
import ./model.bend as M
import ./spec.bend as S

# ---- lib

# T(b): the claim that b is True.
def T(b: Bool) -> Data:
  {b == True{} : Bool}

def disc(b: Bool) -> Type:
  match b:
    case False{}:
      Unit
    case True{}:
      Empty

def ft(e: {False{} == True{} : Bool}) -> Empty:
  %e : disc(_)
  Unit{}

def no(-A: Type, h: T(False{})) -> A:
  Empty.absurd(A, ft(h))

def and_l(a: Bool, b: Bool, +h: T(Bool.and(a, b))) -> T(a):
  match a:
    case False{}:
      no(T(False{}), h)
    case True{}:
      {==}

def and_r(a: Bool, b: Bool, +h: T(Bool.and(a, b))) -> T(b):
  match a:
    case False{}:
      no(T(b), h)
    case True{}:
      h

def and_i(a: Bool, b: Bool, +ha: T(a), +hb: T(b)) -> T(Bool.and(a, b)):
  %Equal.sym(Bool, a, True{}, ha) : {Bool.and(_, b) == True{} : Bool}
  hb

def or_l(a: Bool, b: Bool, +h: T(a)) -> T(Bool.or(a, b)):
  %Equal.sym(Bool, a, True{}, h) : {Bool.or(_, b) == True{} : Bool}
  {==}

def or_r(a: Bool, b: Bool, +h: T(b)) -> T(Bool.or(a, b)):
  match a:
    case False{}:
      h
    case True{}:
      {==}

def or_mono(e: Bool, m: Bool, m2: Bool, f: T(m) -> T(m2), +h: T(Bool.or(e, m))) -> T(Bool.or(e, m2)):
  match e:
    case False{}:
      f(h)
    case True{}:
      {==}

def or_elim(-c: Bool, e: Bool, m: Bool, f1: T(e) -> T(c), f2: T(m) -> T(c), +h: T(Bool.or(e, m))) -> T(c):
  match e:
    case False{}:
      f2(h)
    case True{}:
      f1({==})

def eq_refl(+x: Nat) -> T(Nat.is_eq(x, x)):
  match x:
    case 0n:
      {==}
    case 1n+p:
      eq_refl(p)

def eq_elim(+x: Nat, +y: Nat, +h: T(Nat.is_eq(x, y))) -> {x == y : Nat}:
  match x y:
    case 0n 0n:
      {==}
    case 0n 1n+yp:
      no({0n == 1n+yp : Nat}, h)
    case 1n+xp 0n:
      no({1n+xp == 0n : Nat}, h)
    case 1n+xp 1n+yp:
      Equal.cong(Nat, Nat, a => 1n+a, xp, yp, eq_elim(xp, yp, h))

def mem_snoc_keep(+x: Nat, +l: +List<Nat>, +y: Nat, +h: T(M.mem(x, l))) -> T(M.mem(x, M.snoc(l, y))):
  match l:
    case Nil{}:
      no(T(M.mem(x, M.snoc([], y))), h)
    case Con{+z, +rest}:
      or_mono(Nat.is_eq(x, z), M.mem(x, rest), M.mem(x, M.snoc(rest, y)), hh => mem_snoc_keep(x, rest, y, hh), h)

def mem_snoc_new(+l: +List<Nat>, +y: Nat) -> T(M.mem(y, M.snoc(l, y))):
  match l:
    case Nil{}:
      or_l(Nat.is_eq(y, y), False{}, eq_refl(y))
    case Con{+z, +rest}:
      or_r(Nat.is_eq(y, z), M.mem(y, M.snoc(rest, y)), mem_snoc_new(rest, y))

def mem_cons_keep(+x: Nat, +y: Nat, +ys: +List<Nat>, +h: T(M.mem(x, ys))) -> T(M.mem(x, y <> ys)):
  or_r(Nat.is_eq(x, y), M.mem(x, ys), h)

def mem_app_l(+x: Nat, +a: +List<Nat>, +b: +List<Nat>, +h: T(M.mem(x, a))) -> T(M.mem(x, List.append(&2, Nat, a, b))):
  match a:
    case Nil{}:
      no(T(M.mem(x, List.append(&2, Nat, [], b))), h)
    case Con{+z, +rest}:
      or_mono(Nat.is_eq(x, z), M.mem(x, rest), M.mem(x, List.append(&2, Nat, rest, b)), hh => mem_app_l(x, rest, b, hh), h)

def mem_app_r(+x: Nat, +a: +List<Nat>, +b: +List<Nat>, +h: T(M.mem(x, b))) -> T(M.mem(x, List.append(&2, Nat, a, b))):
  match a:
    case Nil{}:
      h
    case Con{+z, +rest}:
      or_r(Nat.is_eq(x, z), M.mem(x, List.append(&2, Nat, rest, b)), mem_app_r(x, rest, b, h))

def mem_eq(+x: Nat, +z: Nat, +zs: +List<Nat>, +e: {x == z : Nat}, +h: T(M.mem(z, zs))) -> T(M.mem(x, zs)):
  %Equal.sym(Nat, x, z, e) : T(M.mem(_, zs))
  h

def mem_all_in(+x: Nat, +ys: +List<Nat>, +zs: +List<Nat>, +hm: T(M.mem(x, ys)), +ha: T(S.all_in(ys, zs))) -> T(M.mem(x, zs)):
  match ys:
    case Nil{}:
      no(T(M.mem(x, zs)), hm)
    case Con{+z, +rest}:
      or_elim(M.mem(x, zs), Nat.is_eq(x, z), M.mem(x, rest), he => mem_eq(x, z, zs, eq_elim(x, z, he), and_l(M.mem(z, zs), S.all_in(rest, zs), ha)), hr => mem_all_in(x, rest, zs, hr, and_r(M.mem(z, zs), S.all_in(rest, zs), ha)), hm)

def all_in_trans(+xs: +List<Nat>, +ys: +List<Nat>, +zs: +List<Nat>, +h1: T(S.all_in(xs, ys)), +h2: T(S.all_in(ys, zs))) -> T(S.all_in(xs, zs)):
  match xs:
    case Nil{}:
      {==}
    case Con{+z, +rest}:
      and_i(M.mem(z, zs), S.all_in(rest, zs), mem_all_in(z, ys, zs, and_l(M.mem(z, ys), S.all_in(rest, ys), h1), h2), all_in_trans(rest, ys, zs, and_r(M.mem(z, ys), S.all_in(rest, ys), h1), h2))

def all_in_cons_r(+xs: +List<Nat>, +y: Nat, +ys: +List<Nat>, +h: T(S.all_in(xs, ys))) -> T(S.all_in(xs, y <> ys)):
  match xs:
    case Nil{}:
      {==}
    case Con{+z, +rest}:
      and_i(M.mem(z, y <> ys), S.all_in(rest, y <> ys), mem_cons_keep(z, y, ys, and_l(M.mem(z, ys), S.all_in(rest, ys), h)), all_in_cons_r(rest, y, ys, and_r(M.mem(z, ys), S.all_in(rest, ys), h)))

def all_in_snoc_r(+xs: +List<Nat>, +ys: +List<Nat>, +y: Nat, +h: T(S.all_in(xs, ys))) -> T(S.all_in(xs, M.snoc(ys, y))):
  match xs:
    case Nil{}:
      {==}
    case Con{+z, +rest}:
      and_i(M.mem(z, M.snoc(ys, y)), S.all_in(rest, M.snoc(ys, y)), mem_snoc_keep(z, ys, y, and_l(M.mem(z, ys), S.all_in(rest, ys), h)), all_in_snoc_r(rest, ys, y, and_r(M.mem(z, ys), S.all_in(rest, ys), h)))

def all_in_app_l(+xs: +List<Nat>, +a: +List<Nat>, +b: +List<Nat>, +h: T(S.all_in(xs, a))) -> T(S.all_in(xs, List.append(&2, Nat, a, b))):
  match xs:
    case Nil{}:
      {==}
    case Con{+z, +rest}:
      and_i(M.mem(z, List.append(&2, Nat, a, b)), S.all_in(rest, List.append(&2, Nat, a, b)), mem_app_l(z, a, b, and_l(M.mem(z, a), S.all_in(rest, a), h)), all_in_app_l(rest, a, b, and_r(M.mem(z, a), S.all_in(rest, a), h)))

def all_in_app_r(+xs: +List<Nat>, +a: +List<Nat>, +b: +List<Nat>, +h: T(S.all_in(xs, b))) -> T(S.all_in(xs, List.append(&2, Nat, a, b))):
  match xs:
    case Nil{}:
      {==}
    case Con{+z, +rest}:
      and_i(M.mem(z, List.append(&2, Nat, a, b)), S.all_in(rest, List.append(&2, Nat, a, b)), mem_app_r(z, a, b, and_l(M.mem(z, b), S.all_in(rest, b), h)), all_in_app_r(rest, a, b, and_r(M.mem(z, b), S.all_in(rest, b), h)))

def all_in_refl(+l: +List<Nat>) -> T(S.all_in(l, l)):
  match l:
    case Nil{}:
      {==}
    case Con{+z, +rest}:
      and_i(M.mem(z, z <> rest), S.all_in(rest, z <> rest), or_l(Nat.is_eq(z, z), M.mem(z, rest), eq_refl(z)), all_in_cons_r(rest, z, rest, all_in_refl(rest)))

def all_in_snoc_i(+xs: +List<Nat>, +ys: +List<Nat>, +x: Nat, +h: T(S.all_in(xs, ys)), +hx: T(M.mem(x, ys))) -> T(S.all_in(M.snoc(xs, x), ys)):
  match xs:
    case Nil{}:
      and_i(M.mem(x, ys), True{}, hx, {==})
    case Con{+z, +rest}:
      and_i(M.mem(z, ys), S.all_in(M.snoc(rest, x), ys), and_l(M.mem(z, ys), S.all_in(rest, ys), h), all_in_snoc_i(rest, ys, x, and_r(M.mem(z, ys), S.all_in(rest, ys), h), hx))

def all_in_app_i(+a: +List<Nat>, +b: +List<Nat>, +c: +List<Nat>, +ha: T(S.all_in(a, c)), +hb: T(S.all_in(b, c))) -> T(S.all_in(List.append(&2, Nat, a, b), c)):
  match a:
    case Nil{}:
      hb
    case Con{+z, +rest}:
      and_i(M.mem(z, c), S.all_in(List.append(&2, Nat, rest, b), c), and_l(M.mem(z, c), S.all_in(rest, c), ha), all_in_app_i(rest, b, c, and_r(M.mem(z, c), S.all_in(rest, c), ha), hb))

def all_in_snoc_self(+l: +List<Nat>, +x: Nat) -> T(S.all_in(l, M.snoc(l, x))):
  all_in_snoc_r(l, l, x, all_in_refl(l))

def all_in_app_self_l(+a: +List<Nat>, +b: +List<Nat>) -> T(S.all_in(a, List.append(&2, Nat, a, b))):
  all_in_app_l(a, a, b, all_in_refl(a))

def all_in_app_self_r(+a: +List<Nat>, +b: +List<Nat>) -> T(S.all_in(b, List.append(&2, Nat, a, b))):
  all_in_app_r(b, a, b, all_in_refl(b))

def mem_in_hd(+x: Nat, +rest: +List<Nat>, +ys: +List<Nat>, +h: T(S.all_in(x <> rest, ys))) -> T(M.mem(x, ys)):
  and_l(M.mem(x, ys), S.all_in(rest, ys), h)

def all_in_tl(+x: Nat, +rest: +List<Nat>, +ys: +List<Nat>, +h: T(S.all_in(x <> rest, ys))) -> T(S.all_in(rest, ys)):
  and_r(M.mem(x, ys), S.all_in(rest, ys), h)

def imp_t(b: Bool) -> T(S.implies(b, True{})):
  match b:
    case False{}:
      {==}
    case True{}:
      {==}

# ---- M3
def tk_of(+s: M.World) -> Bool:
  match s:
    case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
      tk

# B32: the user's own Messages have no exemption, so only the Messages the user delivered by hand may be typed while the user holds the Terminal.
def UR(+u: +List<Nat>, +rl: +List<Nat>) -> +List<Nat>:
  rl

def I3(+q: +List<Nat>, +tt: +List<Nat>, +u: +List<Nat>, +rl: +List<Nat>, +tk: Bool) -> Bool:
  Bool.and(S.all_in(tt, UR(u, rl)), S.implies(tk, S.all_in(q, UR(u, rl))))

def inv3(+s: M.World) -> Bool:
  I3(S.queue(s), S.tk_typed(s), S.users(s), S.released(s), tk_of(s))

def imp_nil(b: Bool, +ys: +List<Nat>) -> T(S.implies(b, S.all_in([], ys))):
  imp_t(b)

def flush_go3(+q: +List<Nat>, +haf: +List<Nat>, +htk: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +u: +List<Nat>, +tt: +List<Nat>, +rl: +List<Nat>, +n: Nat, +tk: Bool, +i: Bool, +g: Bool, +h1: T(S.implies(tk, S.all_in(q, UR(u, rl)))), +h: T(S.all_in(tt, UR(u, rl)))) -> T(inv3(M.flush_go(q, M.W{[], haf, htk, t, d, u, tt, rl, n, tk, i, g}))):
  match q:
    case Nil{}:
      and_i(S.all_in(tt, UR(u, rl)), S.implies(tk, S.all_in([], UR(u, rl))), h, imp_nil(tk, UR(u, rl)))
    case Con{+x, +rest}:
      match tk:
        case True{}:
          flush_go3(rest, haf, htk, M.snoc(t, x), d, u, M.snoc(tt, x), rl, n, True{}, False{}, g, all_in_tl(x, rest, UR(u, rl), h1), all_in_snoc_i(tt, UR(u, rl), x, h, mem_in_hd(x, rest, UR(u, rl), h1)))
        case False{}:
          flush_go3(rest, haf, htk, M.snoc(t, x), d, u, tt, rl, n, False{}, False{}, g, {==}, h)

def flush_b3(i: Bool, +s: M.World, +h: T(inv3(s))) -> T(inv3(M.flush_b(i, s))):
  match i:
    case False{}:
      h
    case True{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          flush_go3(q, haf, htk, t, d, u, tt, rl, n, tk, i, g, and_r(S.all_in(tt, UR(u, rl)), S.implies(tk, S.all_in(q, UR(u, rl))), h), and_l(S.all_in(tt, UR(u, rl)), S.implies(tk, S.all_in(q, UR(u, rl))), h))

def flush3(+s: M.World, +h: T(inv3(s))) -> T(inv3(M.flush(s))):
  match s:
    case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
      flush_b3(i, M.W{q, haf, htk, t, d, u, tt, rl, n, tk, i, g}, h)

def imp_mono(tk: Bool, A: Bool, B: Bool, f: T(A) -> T(B), +h: T(S.implies(tk, A))) -> T(S.implies(tk, B)):
  match tk:
    case False{}:
      {==}
    case True{}:
      f(h)

def I3_grow(+q: +List<Nat>, +tt: +List<Nat>, +u: +List<Nat>, +rl: +List<Nat>, +u2: +List<Nat>, +rl2: +List<Nat>, +tk: Bool, +h: T(I3(q, tt, u, rl, tk)), +hs: T(S.all_in(UR(u, rl), UR(u2, rl2)))) -> T(I3(q, tt, u2, rl2, tk)):
  and_i(S.all_in(tt, UR(u2, rl2)), S.implies(tk, S.all_in(q, UR(u2, rl2))), all_in_trans(tt, UR(u, rl), UR(u2, rl2), and_l(S.all_in(tt, UR(u, rl)), S.implies(tk, S.all_in(q, UR(u, rl))), h), hs), imp_mono(tk, S.all_in(q, UR(u, rl)), S.all_in(q, UR(u2, rl2)), hq => all_in_trans(q, UR(u, rl), UR(u2, rl2), hq, hs), and_r(S.all_in(tt, UR(u, rl)), S.implies(tk, S.all_in(q, UR(u, rl))), h)))

def I3_snoc(+q: +List<Nat>, +tt: +List<Nat>, +u: +List<Nat>, +rl: +List<Nat>, +u2: +List<Nat>, +rl2: +List<Nat>, +tk: Bool, +n: Nat, +h: T(I3(q, tt, u, rl, tk)), +hs: T(S.all_in(UR(u, rl), UR(u2, rl2))), +hn: T(M.mem(n, UR(u2, rl2)))) -> T(I3(M.snoc(q, n), tt, u2, rl2, tk)):
  and_i(S.all_in(tt, UR(u2, rl2)), S.implies(tk, S.all_in(M.snoc(q, n), UR(u2, rl2))), and_l(S.all_in(tt, UR(u2, rl2)), S.implies(tk, S.all_in(q, UR(u2, rl2))), I3_grow(q, tt, u, rl, u2, rl2, tk, h, hs)), imp_mono(tk, S.all_in(q, UR(u2, rl2)), S.all_in(M.snoc(q, n), UR(u2, rl2)), hq => all_in_snoc_i(q, UR(u2, rl2), n, hq, hn), and_r(S.all_in(tt, UR(u2, rl2)), S.implies(tk, S.all_in(q, UR(u2, rl2))), I3_grow(q, tt, u, rl, u2, rl2, tk, h, hs))))

def ur_mono_u(+u: +List<Nat>, +rl: +List<Nat>, +n: Nat) -> T(S.all_in(UR(u, rl), UR(M.snoc(u, n), rl))):
  all_in_refl(rl)

def ur_mono_rl(+u: +List<Nat>, +rl: +List<Nat>, +id: Nat) -> T(S.all_in(UR(u, rl), UR(u, M.snoc(rl, id)))):
  all_in_snoc_self(rl, id)

def mem_ur_rl(+u: +List<Nat>, +rl: +List<Nat>, +id: Nat) -> T(M.mem(id, UR(u, M.snoc(rl, id)))):
  mem_snoc_new(rl, id)

def I3_refl_ur(+u: +List<Nat>, +rl: +List<Nat>) -> T(S.all_in(UR(u, rl), UR(u, rl))):
  all_in_refl(UR(u, rl))

# send_ev: B2, B3, B6, B9
def send_auto3(fu: Bool, +s: M.World, +h: T(inv3(s))) -> T(inv3(M.send_auto(fu, s))):
  match fu:
    case True{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          match tk:
            case True{}:
              h
            case False{}:
              flush3(M.W{M.snoc(q, n), haf, htk, t, d, M.snoc(u, n), tt, rl, 1n+n, False{}, i, g}, h)
    case False{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          match tk:
            case True{}:
              h
            case False{}:
              flush3(M.W{M.snoc(q, n), haf, htk, t, d, u, tt, rl, 1n+n, False{}, i, g}, h)

def send_ask3(fu: Bool, +s: M.World, +h: T(inv3(s))) -> T(inv3(M.send_live(M.AskFirst{}, fu, s))):
  match fu:
    case True{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          I3_grow(q, tt, u, rl, M.snoc(u, n), rl, tk, h, ur_mono_u(u, rl, n))
    case False{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          h

def send_drop3(fu: Bool, +s: M.World, +h: T(inv3(s))) -> T(inv3(M.send_live(M.RouteDrop{}, fu, s))):
  match fu:
    case True{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          I3_grow(q, tt, u, rl, M.snoc(u, n), rl, tk, h, ur_mono_u(u, rl, n))
    case False{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          h

def send_ev3(fu: Bool, r: M.Route, +s: M.World, +h: T(inv3(s))) -> T(inv3(M.send_ev(fu, r, s))):
  match r:
    case M.Auto{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          match g:
            case True{}:
              h
            case False{}:
              send_auto3(fu, M.W{q, haf, htk, t, d, u, tt, rl, n, tk, i, False{}}, h)
    case M.AskFirst{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          match g:
            case True{}:
              h
            case False{}:
              send_ask3(fu, M.W{q, haf, htk, t, d, u, tt, rl, n, tk, i, False{}}, h)
    case M.RouteDrop{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          match g:
            case True{}:
              h
            case False{}:
              send_drop3(fu, M.W{q, haf, htk, t, d, u, tt, rl, n, tk, i, False{}}, h)

def idle_ev3(+s: M.World, +h: T(inv3(s))) -> T(inv3(M.idle_ev(s))):
  match s:
    case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
      match g:
        case True{}:
          h
        case False{}:
          flush3(M.W{q, haf, htk, t, d, u, tt, rl, n, tk, True{}, False{}}, h)

def busy_ev3(+s: M.World, +h: T(inv3(s))) -> T(inv3(M.busy_ev(s))):
  match s:
    case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
      h

def exit3(+s: M.World, +h: T(inv3(s))) -> T(inv3(M.exit_(s))):
  match s:
    case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
      and_i(S.all_in(tt, UR(u, rl)), S.implies(tk, S.all_in([], UR(u, rl))), and_l(S.all_in(tt, UR(u, rl)), S.implies(tk, S.all_in(q, UR(u, rl))), h), imp_nil(tk, UR(u, rl)))

def ks_in(b: Bool, +x: Nat, +tail: +List<Nat>, +u: +List<Nat>, hm: T(b) -> T(M.mem(x, u)), +ht: T(S.all_in(tail, u))) -> T(S.all_in(M.keep_step(b, x, tail), u)):
  match b:
    case True{}:
      and_i(M.mem(x, u), S.all_in(tail, u), hm({==}), ht)
    case False{}:
      ht

def keep_users_in(+q: +List<Nat>, +u: +List<Nat>) -> T(S.all_in(M.keep_users(q, u), u)):
  match q:
    case Nil{}:
      {==}
    case Con{+x, +rest}:
      ks_in(M.mem(x, u), x, M.keep_users(rest, u), u, hh => hh, keep_users_in(rest, u))

def takeover_begin3(+s: M.World, +h: T(inv3(s))) -> T(inv3(M.takeover_begin(s))):
  match s:
    case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
      and_i(S.all_in(tt, UR(u, rl)), S.all_in(M.keep_users(q, []), UR(u, rl)), and_l(S.all_in(tt, UR(u, rl)), S.implies(tk, S.all_in(q, UR(u, rl))), h), all_in_trans(M.keep_users(q, []), [], UR(u, rl), keep_users_in(q, []), {==}))

def takeover_end3(+s: M.World, +h: T(inv3(s))) -> T(inv3(M.takeover_end(s))):
  match s:
    case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
      flush3(M.W{List.append(&2, Nat, q, htk), haf, [], t, d, u, tt, rl, n, False{}, i, g}, and_i(S.all_in(tt, UR(u, rl)), True{}, and_l(S.all_in(tt, UR(u, rl)), S.implies(tk, S.all_in(q, UR(u, rl))), h), {==}))

def deliver_if3(b: Bool, +id: Nat, +s: M.World, +h: T(inv3(s))) -> T(inv3(M.deliver_if(b, id, s))):
  match b:
    case False{}:
      h
    case True{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          flush3(M.W{M.snoc(q, id), M.remove(id, haf), htk, t, d, u, tt, M.snoc(rl, id), n, tk, i, g}, I3_snoc(q, tt, u, rl, u, M.snoc(rl, id), tk, id, h, ur_mono_rl(u, rl, id), mem_ur_rl(u, rl, id)))

def deliver_tk3(b: Bool, +id: Nat, +s: M.World, +h: T(inv3(s))) -> T(inv3(M.deliver_tk(b, id, s))):
  match b:
    case False{}:
      h
    case True{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          flush3(M.W{M.snoc(q, id), haf, M.remove(id, htk), t, d, u, tt, M.snoc(rl, id), n, tk, i, g}, I3_snoc(q, tt, u, rl, u, M.snoc(rl, id), tk, id, h, ur_mono_rl(u, rl, id), mem_ur_rl(u, rl, id)))

def deliver_pick3(a: Bool, b: Bool, +id: Nat, +s: M.World, +h: T(inv3(s))) -> T(inv3(M.deliver_pick(a, b, id, s))):
  match a:
    case True{}:
      deliver_if3(True{}, id, s, h)
    case False{}:
      deliver_tk3(b, id, s, h)

def user_deliver3(+id: Nat, +s: M.World, +h: T(inv3(s))) -> T(inv3(M.user_deliver(id, s))):
  match s:
    case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
      deliver_pick3(Bool.and(M.mem(id, haf), Bool.not(g)), Bool.and(M.mem(id, htk), Bool.not(g)), id, M.W{q, haf, htk, t, d, u, tt, rl, n, tk, i, g}, h)

def drop_if3(b: Bool, +id: Nat, +s: M.World, +h: T(inv3(s))) -> T(inv3(M.drop_if(b, id, s))):
  match b:
    case False{}:
      h
    case True{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          h

def drop_tk3(b: Bool, +id: Nat, +s: M.World, +h: T(inv3(s))) -> T(inv3(M.drop_tk(b, id, s))):
  match b:
    case False{}:
      h
    case True{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          h

def drop_pick3(a: Bool, b: Bool, +id: Nat, +s: M.World, +h: T(inv3(s))) -> T(inv3(M.drop_pick(a, b, id, s))):
  match a:
    case True{}:
      drop_if3(True{}, id, s, h)
    case False{}:
      drop_tk3(b, id, s, h)

def user_drop3(+id: Nat, +s: M.World, +h: T(inv3(s))) -> T(inv3(M.user_drop(id, s))):
  match s:
    case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
      drop_pick3(M.mem(id, haf), M.mem(id, htk), id, M.W{q, haf, htk, t, d, u, tt, rl, n, tk, i, g}, h)

def restart3(alive: Bool, +s: M.World, +h: T(inv3(s))) -> T(inv3(M.restart(alive, s))):
  match alive:
    case True{}:
      takeover_end3(M.busy_ev(s), busy_ev3(s, h))
    case False{}:
      takeover_end3(M.exit_(s), exit3(s, h))

def step3(e: M.Ev, +s: M.World, +h: T(inv3(s))) -> T(inv3(M.step(e, s))):
  match e:
    case M.Send{fu, r}:
      send_ev3(fu, r, s, h)
    case M.Idle{}:
      idle_ev3(s, h)
    case M.Busy{}:
      busy_ev3(s, h)
    case M.Exit{}:
      exit3(s, h)
    case M.TakeoverBegin{}:
      takeover_begin3(s, h)
    case M.TakeoverEnd{}:
      takeover_end3(s, h)
    case M.UserInput{}:
      takeover_begin3(s, h)
    case M.UserSubmit{}:
      takeover_end3(s, h)
    case M.UserClear{}:
      takeover_end3(s, h)
    case M.UserDeliver{id}:
      user_deliver3(id, s, h)
    case M.UserDrop{id}:
      user_drop3(id, s, h)
    case M.Restart{alive}:
      restart3(alive, s, h)
    case M.Ask{o, c}:
      h
    case M.HopMade{}:
      h
    case M.HopEnded{}:
      h
    case M.BoundPassed{}:
      h
    case M.Answer{}:
      h
    case M.Escalate{}:
      h
    case M.Reply{}:
      h

def run3(+evs: +List<M.Ev>, +s: M.World, +h: T(inv3(s))) -> T(inv3(M.run(evs, s))):
  match evs:
    case Nil{}:
      h
    case Con{e, +rest}:
      run3(rest, M.step(e, s), step3(e, s, h))

def m3_main(+evs: +List<M.Ev>) -> T(S.all_in(S.tk_typed(S.world(evs)), S.released(S.world(evs)))):
  and_l(S.all_in(S.tk_typed(S.world(evs)), UR(S.users(S.world(evs)), S.released(S.world(evs)))), S.implies(tk_of(S.world(evs)), S.all_in(S.queue(S.world(evs)), UR(S.users(S.world(evs)), S.released(S.world(evs))))), run3(evs, M.init(), {==}))

def Laws.m3_takeover_isolates(evs):
  m3_main(evs)

# ---- M2
def fl_go2(+q: +List<Nat>, +haf: +List<Nat>, +htk: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +u: +List<Nat>, +tt: +List<Nat>, +rl: +List<Nat>, +n: Nat, +tk: Bool, +i: Bool, +g: Bool, +s0: +List<Nat>) -> T(S.all_in(haf, S.held_af(M.flush_go(q, M.W{s0, haf, htk, t, d, u, tt, rl, n, tk, i, g})))):
  match q:
    case Nil{}:
      all_in_refl(haf)
    case Con{+x, +rest}:
      fl_go2(rest, haf, htk, M.snoc(t, x), d, u, M.record(tk, x, tt), rl, n, tk, False{}, g, [])

def fl2(+s: M.World) -> T(S.all_in(S.held_af(s), S.held_af(M.flush(s)))):
  match s:
    case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
      match i:
        case False{}:
          all_in_refl(haf)
        case True{}:
          fl_go2(q, haf, htk, t, d, u, tt, rl, n, tk, True{}, g, [])

def H2(+s: M.World, +s2: M.World) -> Bool:
  S.all_in(S.held_af(s), S.held_af(s2))

def send_auto2(fu: Bool, +s: M.World) -> T(H2(s, M.send_auto(fu, s))):
  match fu:
    case True{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          match tk:
            case True{}:
              all_in_refl(haf)
            case False{}:
              fl2(M.W{M.snoc(q, n), haf, htk, t, d, M.snoc(u, n), tt, rl, 1n+n, False{}, i, g})
    case False{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          match tk:
            case True{}:
              all_in_refl(haf)
            case False{}:
              fl2(M.W{M.snoc(q, n), haf, htk, t, d, u, tt, rl, 1n+n, False{}, i, g})

def send_ev2(fu: Bool, r: M.Route, +s: M.World) -> T(H2(s, M.send_ev(fu, r, s))):
  match r:
    case M.Auto{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          match g:
            case True{}:
              all_in_refl(haf)
            case False{}:
              send_auto2(fu, M.W{q, haf, htk, t, d, u, tt, rl, n, tk, i, False{}})
    case M.AskFirst{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          match g:
            case True{}:
              all_in_refl(haf)
            case False{}:
              all_in_snoc_self(haf, n)
    case M.RouteDrop{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          match g:
            case True{}:
              all_in_refl(haf)
            case False{}:
              all_in_refl(haf)

def step2(e: M.Ev, +s: M.World) -> T(S.implies(Bool.not(S.is_user_call(e)), H2(s, M.step(e, s)))):
  match e:
    case M.Send{fu, r}:
      send_ev2(fu, r, s)
    case M.Idle{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          match g:
            case True{}:
              all_in_refl(haf)
            case False{}:
              fl2(M.W{q, haf, htk, t, d, u, tt, rl, n, tk, True{}, False{}})
    case M.Busy{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          all_in_refl(haf)
    case M.Exit{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          all_in_refl(haf)
    case M.TakeoverBegin{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          all_in_refl(haf)
    case M.TakeoverEnd{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          fl2(M.W{List.append(&2, Nat, q, htk), haf, [], t, d, u, tt, rl, n, False{}, i, g})
    case M.UserInput{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          all_in_refl(haf)
    case M.UserSubmit{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          fl2(M.W{List.append(&2, Nat, q, htk), haf, [], t, d, u, tt, rl, n, False{}, i, g})
    case M.UserClear{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          fl2(M.W{List.append(&2, Nat, q, htk), haf, [], t, d, u, tt, rl, n, False{}, i, g})
    case M.UserDeliver{id}:
      {==}
    case M.UserDrop{id}:
      {==}
    case M.Restart{alive}:
      match alive:
        case True{}:
          match s:
            case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
              fl2(M.W{List.append(&2, Nat, q, htk), haf, [], t, d, u, tt, rl, n, False{}, False{}, g})
        case False{}:
          match s:
            case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
              fl2(M.W{[], haf, [], t, List.append(&2, Nat, d, List.append(&2, Nat, q, htk)), u, tt, rl, n, False{}, False{}, True{}})
    case M.Ask{o, c}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          all_in_refl(haf)
    case M.HopMade{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          all_in_refl(haf)
    case M.HopEnded{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          all_in_refl(haf)
    case M.BoundPassed{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          all_in_refl(haf)
    case M.Answer{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          all_in_refl(haf)
    case M.Escalate{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          all_in_refl(haf)
    case M.Reply{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          all_in_refl(haf)

def m2_main(+evs: +List<M.Ev>, e: M.Ev) -> T(S.implies(Bool.not(S.is_user_call(e)), S.all_in(S.held_af(S.world(evs)), S.held_af(M.step(e, S.world(evs)))))):
  step2(e, S.world(evs))

def Laws.m2_held_leaves_only_by_its_owner(evs, e):
  m2_main(evs, e)

# ---- M4
def prefix_refl(+l: +List<Nat>) -> T(S.is_prefix(l, l)):
  match l:
    case Nil{}:
      {==}
    case Con{+x, +rest}:
      and_i(Nat.is_eq(x, x), S.is_prefix(rest, rest), eq_refl(x), prefix_refl(rest))

def prefix_snoc(+l: +List<Nat>, +y: Nat) -> T(S.is_prefix(l, M.snoc(l, y))):
  match l:
    case Nil{}:
      {==}
    case Con{+x, +rest}:
      and_i(Nat.is_eq(x, x), S.is_prefix(rest, M.snoc(rest, y)), eq_refl(x), prefix_snoc(rest, y))

def prefix_drop(+l: +List<Nat>, +y: Nat, +m: +List<Nat>, +h: T(S.is_prefix(M.snoc(l, y), m))) -> T(S.is_prefix(l, m)):
  match l:
    case Nil{}:
      {==}
    case Con{+x, +rest}:
      match m:
        case Nil{}:
          no(T(S.is_prefix(x <> rest, [])), h)
        case Con{+z, +m2}:
          and_i(Nat.is_eq(x, z), S.is_prefix(rest, m2), and_l(Nat.is_eq(x, z), S.is_prefix(M.snoc(rest, y), m2), h), prefix_drop(rest, y, m2, and_r(Nat.is_eq(x, z), S.is_prefix(M.snoc(rest, y), m2), h)))

def fl_go4(+q: +List<Nat>, +haf: +List<Nat>, +htk: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +u: +List<Nat>, +tt: +List<Nat>, +rl: +List<Nat>, +n: Nat, +tk: Bool, +i: Bool, +g: Bool, +s0: +List<Nat>) -> T(S.is_prefix(t, S.typed(M.flush_go(q, M.W{s0, haf, htk, t, d, u, tt, rl, n, tk, i, g})))):
  match q:
    case Nil{}:
      prefix_refl(t)
    case Con{+x, +rest}:
      prefix_drop(t, x, S.typed(M.flush_go(rest, M.W{[], haf, htk, M.snoc(t, x), d, u, M.record(tk, x, tt), rl, n, tk, False{}, g})), fl_go4(rest, haf, htk, M.snoc(t, x), d, u, M.record(tk, x, tt), rl, n, tk, False{}, g, []))

def fl4(+s: M.World) -> T(S.is_prefix(S.typed(s), S.typed(M.flush(s)))):
  match s:
    case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
      match i:
        case False{}:
          prefix_refl(t)
        case True{}:
          fl_go4(q, haf, htk, t, d, u, tt, rl, n, tk, True{}, g, [])

def send_auto4(fu: Bool, +s: M.World) -> T(S.is_prefix(S.typed(s), S.typed(M.send_auto(fu, s)))):
  match fu:
    case True{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          match tk:
            case True{}:
              prefix_refl(t)
            case False{}:
              fl4(M.W{M.snoc(q, n), haf, htk, t, d, M.snoc(u, n), tt, rl, 1n+n, False{}, i, g})
    case False{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          match tk:
            case True{}:
              prefix_refl(t)
            case False{}:
              fl4(M.W{M.snoc(q, n), haf, htk, t, d, u, tt, rl, 1n+n, False{}, i, g})

def send_ev4(fu: Bool, r: M.Route, +s: M.World) -> T(S.is_prefix(S.typed(s), S.typed(M.send_ev(fu, r, s)))):
  match r:
    case M.Auto{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          match g:
            case True{}:
              prefix_refl(t)
            case False{}:
              send_auto4(fu, M.W{q, haf, htk, t, d, u, tt, rl, n, tk, i, False{}})
    case M.AskFirst{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          match g:
            case True{}:
              prefix_refl(t)
            case False{}:
              prefix_refl(t)
    case M.RouteDrop{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          match g:
            case True{}:
              prefix_refl(t)
            case False{}:
              prefix_refl(t)

def deliver_if4(b: Bool, +id: Nat, +s: M.World) -> T(S.is_prefix(S.typed(s), S.typed(M.deliver_if(b, id, s)))):
  match b:
    case False{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          prefix_refl(t)
    case True{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          fl4(M.W{M.snoc(q, id), M.remove(id, haf), htk, t, d, u, tt, M.snoc(rl, id), n, tk, i, g})

def deliver_tk4(b: Bool, +id: Nat, +s: M.World) -> T(S.is_prefix(S.typed(s), S.typed(M.deliver_tk(b, id, s)))):
  match b:
    case False{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          prefix_refl(t)
    case True{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          fl4(M.W{M.snoc(q, id), haf, M.remove(id, htk), t, d, u, tt, M.snoc(rl, id), n, tk, i, g})

def deliver_pick4(a: Bool, b: Bool, +id: Nat, +s: M.World) -> T(S.is_prefix(S.typed(s), S.typed(M.deliver_pick(a, b, id, s)))):
  match a:
    case True{}:
      deliver_if4(True{}, id, s)
    case False{}:
      deliver_tk4(b, id, s)

def drop_if4(b: Bool, +id: Nat, +s: M.World) -> T(S.is_prefix(S.typed(s), S.typed(M.drop_if(b, id, s)))):
  match b:
    case False{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          prefix_refl(t)
    case True{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          prefix_refl(t)

def drop_tk4(b: Bool, +id: Nat, +s: M.World) -> T(S.is_prefix(S.typed(s), S.typed(M.drop_tk(b, id, s)))):
  match b:
    case False{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          prefix_refl(t)
    case True{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          prefix_refl(t)

def drop_pick4(a: Bool, b: Bool, +id: Nat, +s: M.World) -> T(S.is_prefix(S.typed(s), S.typed(M.drop_pick(a, b, id, s)))):
  match a:
    case True{}:
      drop_if4(True{}, id, s)
    case False{}:
      drop_tk4(b, id, s)

def step4(e: M.Ev, +s: M.World) -> T(S.is_prefix(S.typed(s), S.typed(M.step(e, s)))):
  match e:
    case M.Send{fu, r}:
      send_ev4(fu, r, s)
    case M.Idle{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          match g:
            case True{}:
              prefix_refl(t)
            case False{}:
              fl4(M.W{q, haf, htk, t, d, u, tt, rl, n, tk, True{}, False{}})
    case M.Busy{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          prefix_refl(t)
    case M.Exit{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          prefix_refl(t)
    case M.TakeoverBegin{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          prefix_refl(t)
    case M.TakeoverEnd{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          fl4(M.W{List.append(&2, Nat, q, htk), haf, [], t, d, u, tt, rl, n, False{}, i, g})
    case M.UserInput{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          prefix_refl(t)
    case M.UserSubmit{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          fl4(M.W{List.append(&2, Nat, q, htk), haf, [], t, d, u, tt, rl, n, False{}, i, g})
    case M.UserClear{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          fl4(M.W{List.append(&2, Nat, q, htk), haf, [], t, d, u, tt, rl, n, False{}, i, g})
    case M.UserDeliver{+id}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          deliver_pick4(Bool.and(M.mem(id, haf), Bool.not(g)), Bool.and(M.mem(id, htk), Bool.not(g)), id, M.W{q, haf, htk, t, d, u, tt, rl, n, tk, i, g})
    case M.UserDrop{+id}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          drop_pick4(M.mem(id, haf), M.mem(id, htk), id, M.W{q, haf, htk, t, d, u, tt, rl, n, tk, i, g})
    case M.Restart{alive}:
      match alive:
        case True{}:
          match s:
            case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
              fl4(M.W{List.append(&2, Nat, q, htk), haf, [], t, d, u, tt, rl, n, False{}, False{}, g})
        case False{}:
          match s:
            case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
              fl4(M.W{[], haf, [], t, List.append(&2, Nat, d, List.append(&2, Nat, q, htk)), u, tt, rl, n, False{}, False{}, True{}})
    case M.Ask{o, c}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          prefix_refl(t)
    case M.HopMade{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          prefix_refl(t)
    case M.HopEnded{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          prefix_refl(t)
    case M.BoundPassed{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          prefix_refl(t)
    case M.Answer{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          prefix_refl(t)
    case M.Escalate{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          prefix_refl(t)
    case M.Reply{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          prefix_refl(t)

def m4_main(+evs: +List<M.Ev>, e: M.Ev) -> T(S.is_prefix(S.typed(S.world(evs)), S.typed(M.step(e, S.world(evs))))):
  step4(e, S.world(evs))

def Laws.m4_typed_only_grows_at_the_end(evs, e):
  m4_main(evs, e)

# ---- M7
def imp_and_l(b: Bool, x: Bool, y: Bool, +h: T(S.implies(b, Bool.and(x, y)))) -> T(S.implies(b, x)):
  match b:
    case False{}:
      {==}
    case True{}:
      and_l(x, y, h)

def imp_and_r(b: Bool, x: Bool, y: Bool, +h: T(S.implies(b, Bool.and(x, y)))) -> T(S.implies(b, y)):
  match b:
    case False{}:
      {==}
    case True{}:
      and_r(x, y, h)

def G7(+s: M.World) -> Bool:
  S.implies(S.gone(s), Bool.and(S.is_nil(S.queue(s)), S.is_nil(S.held_tk(s))))

def flush_go7(+q: +List<Nat>, +haf: +List<Nat>, +htk: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +u: +List<Nat>, +tt: +List<Nat>, +rl: +List<Nat>, +n: Nat, +tk: Bool, +i: Bool, +g: Bool, +hq: T(S.implies(g, S.is_nil(q))), +hh: T(S.implies(g, S.is_nil(htk)))) -> T(G7(M.flush_go(q, M.W{[], haf, htk, t, d, u, tt, rl, n, tk, i, g}))):
  match q:
    case Nil{}:
      match g:
        case True{}:
          and_i(True{}, S.is_nil(htk), {==}, hh)
        case False{}:
          {==}
    case Con{+x, +rest}:
      match g:
        case True{}:
          no(T(G7(M.flush_go(x <> rest, M.W{[], haf, htk, t, d, u, tt, rl, n, tk, i, True{}}))), hq)
        case False{}:
          flush_go7(rest, haf, htk, M.snoc(t, x), d, u, M.record(tk, x, tt), rl, n, tk, False{}, False{}, {==}, {==})

def flush7(+s: M.World, +h: T(G7(s))) -> T(G7(M.flush(s))):
  match s:
    case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
      match i:
        case False{}:
          h
        case True{}:
          flush_go7(q, haf, htk, t, d, u, tt, rl, n, tk, True{}, g, imp_and_l(g, S.is_nil(q), S.is_nil(htk), h), imp_and_r(g, S.is_nil(q), S.is_nil(htk), h))

def send_auto7(fu: Bool, +q: +List<Nat>, +haf: +List<Nat>, +htk: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +u: +List<Nat>, +tt: +List<Nat>, +rl: +List<Nat>, +n: Nat, +tk: Bool, +i: Bool) -> T(G7(M.send_auto(fu, M.W{q, haf, htk, t, d, u, tt, rl, n, tk, i, False{}}))):
  match fu:
    case True{}:
      match tk:
        case True{}:
          {==}
        case False{}:
          flush7(M.W{M.snoc(q, n), haf, htk, t, d, M.snoc(u, n), tt, rl, 1n+n, False{}, i, False{}}, {==})
    case False{}:
      match tk:
        case True{}:
          {==}
        case False{}:
          flush7(M.W{M.snoc(q, n), haf, htk, t, d, u, tt, rl, 1n+n, False{}, i, False{}}, {==})

def send_ev7(fu: Bool, r: M.Route, +s: M.World, +h: T(G7(s))) -> T(G7(M.send_ev(fu, r, s))):
  match r:
    case M.Auto{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          match g:
            case True{}:
              h
            case False{}:
              send_auto7(fu, q, haf, htk, t, d, u, tt, rl, n, tk, i)
    case M.AskFirst{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          match g:
            case True{}:
              h
            case False{}:
              {==}
    case M.RouteDrop{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          match g:
            case True{}:
              h
            case False{}:
              {==}

def takeover_begin7(+s: M.World, +h: T(G7(s))) -> T(G7(M.takeover_begin(s))):
  match s:
    case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
      match q:
        case Nil{}:
          match htk:
            case Nil{}:
              imp_t(g)
            case Con{+y, +yr}:
              match g:
                case True{}:
                  no(T(G7(M.takeover_begin(M.W{[], haf, y <> yr, t, d, u, tt, rl, n, tk, i, True{}}))), h)
                case False{}:
                  {==}
        case Con{+x, +xr}:
          match g:
            case True{}:
              no(T(G7(M.takeover_begin(M.W{x <> xr, haf, htk, t, d, u, tt, rl, n, tk, i, True{}}))), h)
            case False{}:
              {==}

def takeover_end7(+s: M.World, +h: T(G7(s))) -> T(G7(M.takeover_end(s))):
  match s:
    case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
      match q:
        case Nil{}:
          match htk:
            case Nil{}:
              flush7(M.W{[], haf, [], t, d, u, tt, rl, n, False{}, i, g}, h)
            case Con{+y, +yr}:
              match g:
                case True{}:
                  no(T(G7(M.takeover_end(M.W{[], haf, y <> yr, t, d, u, tt, rl, n, tk, i, True{}}))), h)
                case False{}:
                  flush7(M.W{y <> yr, haf, [], t, d, u, tt, rl, n, False{}, i, False{}}, {==})
        case Con{+x, +xr}:
          match g:
            case True{}:
              no(T(G7(M.takeover_end(M.W{x <> xr, haf, htk, t, d, u, tt, rl, n, tk, i, True{}}))), h)
            case False{}:
              flush7(M.W{List.append(&2, Nat, x <> xr, htk), haf, [], t, d, u, tt, rl, n, False{}, i, False{}}, {==})

def notand(m: Bool) -> T(Bool.not(Bool.and(m, False{}))):
  match m:
    case False{}:
      {==}
    case True{}:
      {==}

def ab7(m: Bool, g: Bool) -> T(S.implies(g, Bool.not(Bool.and(m, Bool.not(g))))):
  match g:
    case True{}:
      notand(m)
    case False{}:
      {==}

def deliver_pick7(a: Bool, b: Bool, +id: Nat, +s: M.World, +h: T(G7(s)), +ha: T(S.implies(S.gone(s), Bool.not(a))), +hb: T(S.implies(S.gone(s), Bool.not(b)))) -> T(G7(M.deliver_pick(a, b, id, s))):
  match a:
    case True{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          match g:
            case True{}:
              no(T(G7(M.deliver_pick(True{}, b, id, M.W{q, haf, htk, t, d, u, tt, rl, n, tk, i, True{}}))), ha)
            case False{}:
              flush7(M.W{M.snoc(q, id), M.remove(id, haf), htk, t, d, u, tt, M.snoc(rl, id), n, tk, i, False{}}, {==})
    case False{}:
      match b:
        case False{}:
          h
        case True{}:
          match s:
            case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
              match g:
                case True{}:
                  no(T(G7(M.deliver_pick(False{}, True{}, id, M.W{q, haf, htk, t, d, u, tt, rl, n, tk, i, True{}}))), hb)
                case False{}:
                  flush7(M.W{M.snoc(q, id), haf, M.remove(id, htk), t, d, u, tt, M.snoc(rl, id), n, tk, i, False{}}, {==})

def drop_pick7(a: Bool, b: Bool, +id: Nat, +s: M.World, +h: T(G7(s))) -> T(G7(M.drop_pick(a, b, id, s))):
  match a:
    case True{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          h
    case False{}:
      match b:
        case False{}:
          h
        case True{}:
          match s:
            case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
              match htk:
                case Nil{}:
                  h
                case Con{+y, +yr}:
                  match g:
                    case True{}:
                      no(T(G7(M.drop_pick(False{}, True{}, id, M.W{q, haf, y <> yr, t, d, u, tt, rl, n, tk, i, True{}}))), and_r(S.is_nil(q), False{}, h))
                    case False{}:
                      {==}

def step7(e: M.Ev, +s: M.World, +h: T(G7(s))) -> T(G7(M.step(e, s))):
  match e:
    case M.Send{fu, r}:
      send_ev7(fu, r, s, h)
    case M.Idle{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          match g:
            case True{}:
              h
            case False{}:
              flush7(M.W{q, haf, htk, t, d, u, tt, rl, n, tk, True{}, False{}}, {==})
    case M.Busy{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          h
    case M.Exit{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          {==}
    case M.TakeoverBegin{}:
      takeover_begin7(s, h)
    case M.TakeoverEnd{}:
      takeover_end7(s, h)
    case M.UserInput{}:
      takeover_begin7(s, h)
    case M.UserSubmit{}:
      takeover_end7(s, h)
    case M.UserClear{}:
      takeover_end7(s, h)
    case M.UserDeliver{+id}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          deliver_pick7(Bool.and(M.mem(id, haf), Bool.not(g)), Bool.and(M.mem(id, htk), Bool.not(g)), id, M.W{q, haf, htk, t, d, u, tt, rl, n, tk, i, g}, h, ab7(M.mem(id, haf), g), ab7(M.mem(id, htk), g))
    case M.UserDrop{+id}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          drop_pick7(M.mem(id, haf), M.mem(id, htk), id, M.W{q, haf, htk, t, d, u, tt, rl, n, tk, i, g}, h)
    case M.Restart{alive}:
      match alive:
        case True{}:
          match s:
            case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
              takeover_end7(M.W{q, haf, htk, t, d, u, tt, rl, n, tk, False{}, g}, h)
        case False{}:
          match s:
            case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
              takeover_end7(M.W{[], haf, [], t, List.append(&2, Nat, d, List.append(&2, Nat, q, htk)), u, tt, rl, n, tk, False{}, True{}}, {==})
    case M.Ask{o, c}:
      h
    case M.HopMade{}:
      h
    case M.HopEnded{}:
      h
    case M.BoundPassed{}:
      h
    case M.Answer{}:
      h
    case M.Escalate{}:
      h
    case M.Reply{}:
      h

def run7(+evs: +List<M.Ev>, +s: M.World, +h: T(G7(s))) -> T(G7(M.run(evs, s))):
  match evs:
    case Nil{}:
      h
    case Con{e, +rest}:
      run7(rest, M.step(e, s), step7(e, s, h))

def send_gone7(fu: Bool, r: M.Route, +s: M.World) -> T(S.implies(S.gone(s), Nat.is_eq(S.next_id(M.step(M.Send{fu, r}, s)), S.next_id(s)))):
  match r:
    case M.Auto{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          match g:
            case True{}:
              eq_refl(n)
            case False{}:
              {==}
    case M.AskFirst{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          match g:
            case True{}:
              eq_refl(n)
            case False{}:
              {==}
    case M.RouteDrop{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          match g:
            case True{}:
              eq_refl(n)
            case False{}:
              {==}

def m7_main(+evs: +List<M.Ev>, +fu: Bool, +r: M.Route) -> T(Bool.and(S.implies(S.gone(S.world(evs)), Bool.and(S.is_nil(S.queue(S.world(evs))), S.is_nil(S.held_tk(S.world(evs))))), S.implies(S.gone(S.world(evs)), Nat.is_eq(S.next_id(M.step(M.Send{fu, r}, S.world(evs))), S.next_id(S.world(evs)))))):
  and_i(G7(S.world(evs)), S.implies(S.gone(S.world(evs)), Nat.is_eq(S.next_id(M.step(M.Send{fu, r}, S.world(evs))), S.next_id(S.world(evs)))), run7(evs, M.init(), {==}), send_gone7(fu, r, S.world(evs)))

def Laws.m7_receiver_gone(evs, fu, r):
  m7_main(evs, fu, r)

# ---- M10
def le_zero(p: Nat) -> T(Nat.is_le(0n, p)):
  match p:
    case 0n:
      {==}
    case 1n+pp:
      {==}

def le_refl(n: Nat) -> T(Nat.is_le(n, n)):
  match n:
    case 0n:
      {==}
    case 1n+p:
      le_refl(p)

def le0_nil(+l: +List<Nat>, +h: T(Nat.is_le(S.len(l), 0n))) -> T(S.is_nil(l)):
  match l:
    case Nil{}:
      {==}
    case Con{+x, +rest}:
      no(T(S.is_nil(x <> rest)), h)

def imp10(g: Bool, X: Bool, f: T(Bool.not(g)) -> T(X)) -> T(S.implies(Bool.not(g), X)):
  match g:
    case True{}:
      {==}
    case False{}:
      f({==})

def idle2(+s: M.World) -> M.World:
  M.step(M.Idle{}, M.step(M.Busy{}, s))

def fgo_alive10(+q: +List<Nat>, +haf: +List<Nat>, +htk: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +u: +List<Nat>, +tt: +List<Nat>, +rl: +List<Nat>, +n: Nat, +tk: Bool, +i: Bool) -> T(Bool.not(S.gone(M.flush_go(q, M.W{[], haf, htk, t, d, u, tt, rl, n, tk, i, False{}})))):
  match q:
    case Nil{}:
      {==}
    case Con{+x, +rest}:
      fgo_alive10(rest, haf, htk, M.snoc(t, x), d, u, M.record(tk, x, tt), rl, n, tk, False{})

def fgo_empty10(p: Nat, +q: +List<Nat>, +haf: +List<Nat>, +htk: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +u: +List<Nat>, +tt: +List<Nat>, +rl: +List<Nat>, +n: Nat, +tk: Bool, +i: Bool, +g: Bool) -> T(Nat.is_le(S.len(S.queue(M.flush_go(q, M.W{[], haf, htk, t, d, u, tt, rl, n, tk, i, g}))), p)):
  match q:
    case Nil{}:
      le_zero(p)
    case Con{+x, +rest}:
      fgo_empty10(p, rest, haf, htk, M.snoc(t, x), d, u, M.record(tk, x, tt), rl, n, tk, False{}, g)

def g10(+s: M.World, +hg: T(Bool.not(S.gone(s)))) -> T(Bool.not(S.gone(idle2(s)))):
  match s:
    case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
      match q:
        case Nil{}:
          match g:
            case True{}:
              no(T(Bool.not(S.gone(idle2(M.W{[], haf, htk, t, d, u, tt, rl, n, tk, i, True{}})))), hg)
            case False{}:
              {==}
        case Con{+x, +rest}:
          match g:
            case True{}:
              no(T(Bool.not(S.gone(idle2(M.W{x <> rest, haf, htk, t, d, u, tt, rl, n, tk, i, True{}})))), hg)
            case False{}:
              fgo_alive10(rest, haf, htk, M.snoc(t, x), d, u, M.record(tk, x, tt), rl, n, tk, False{})

def k10(p: Nat, +s: M.World, +hg: T(Bool.not(S.gone(s))), +hk: T(Nat.is_le(S.len(S.queue(s)), 1n+p))) -> T(Nat.is_le(S.len(S.queue(idle2(s))), p)):
  match s:
    case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
      match q:
        case Nil{}:
          match g:
            case True{}:
              no(T(Nat.is_le(S.len(S.queue(idle2(M.W{[], haf, htk, t, d, u, tt, rl, n, tk, i, True{}}))), p)), hg)
            case False{}:
              le_zero(p)
        case Con{+x, +rest}:
          match g:
            case True{}:
              no(T(Nat.is_le(S.len(S.queue(idle2(M.W{x <> rest, haf, htk, t, d, u, tt, rl, n, tk, i, True{}}))), p)), hg)
            case False{}:
              fgo_empty10(p, rest, haf, htk, M.snoc(t, x), d, u, M.record(tk, x, tt), rl, n, tk, False{}, False{})

def cyc10(+k: Nat, +s: M.World, +hg: T(Bool.not(S.gone(s))), +hk: T(Nat.is_le(S.len(S.queue(s)), k))) -> T(S.is_nil(S.queue(M.run(S.cycle(k), s)))):
  match k:
    case 0n:
      le0_nil(S.queue(s), hk)
    case 1n++p:
      cyc10(p, idle2(s), g10(s, hg), k10(p, s, hg, hk))

def m10_main(+evs: +List<M.Ev>) -> T(S.implies(Bool.not(S.gone(S.world(evs))), S.is_nil(S.queue(M.run(S.cycle(S.len(S.queue(S.world(evs)))), S.world(evs)))))):
  imp10(S.gone(S.world(evs)), S.is_nil(S.queue(M.run(S.cycle(S.len(S.queue(S.world(evs)))), S.world(evs)))), hg => cyc10(S.len(S.queue(S.world(evs))), S.world(evs), hg, le_refl(S.len(S.queue(S.world(evs))))))

def Laws.m10_pending_to_idle_is_eventually_typed(evs):
  m10_main(evs)


# ---- inv
def lt_ne(+x: Nat, +n: Nat, +h: T(Nat.is_lt(x, n))) -> T(Bool.not(Nat.is_eq(n, x))):
  match x n:
    case 0n 0n:
      no(T(Bool.not(Nat.is_eq(0n, 0n))), h)
    case 0n 1n+np:
      {==}
    case 1n+xp 0n:
      no(T(Bool.not(Nat.is_eq(0n, 1n+xp))), h)
    case 1n+xp 1n+np:
      lt_ne(xp, np, h)

def lt_succ(+x: Nat, +n: Nat, +h: T(Nat.is_lt(x, n))) -> T(Nat.is_lt(x, 1n+n)):
  match x n:
    case 0n 0n:
      no(T(Nat.is_lt(0n, 1n)), h)
    case 0n 1n+np:
      {==}
    case 1n+xp 0n:
      no(T(Nat.is_lt(1n+xp, 1n)), h)
    case 1n+xp 1n+np:
      lt_succ(xp, np, h)

def lt_new(+n: Nat) -> T(Nat.is_lt(n, 1n+n)):
  match n:
    case 0n:
      {==}
    case 1n+p:
      lt_new(p)

def NM(+x: Nat, +l: +List<Nat>) -> Data:
  T(Bool.not(M.mem(x, l)))

def nor_l(a: Bool, b: Bool, +h: T(Bool.not(Bool.or(a, b)))) -> T(Bool.not(a)):
  match a:
    case True{}:
      no(T(Bool.not(True{})), h)
    case False{}:
      {==}

def nor_r(a: Bool, b: Bool, +h: T(Bool.not(Bool.or(a, b)))) -> T(Bool.not(b)):
  match a:
    case True{}:
      no(T(Bool.not(b)), h)
    case False{}:
      h

def nor_i(a: Bool, b: Bool, +ha: T(Bool.not(a)), +hb: T(Bool.not(b))) -> T(Bool.not(Bool.or(a, b))):
  match a:
    case True{}:
      no(T(Bool.not(Bool.or(True{}, b))), ha)
    case False{}:
      hb

def ncase(m: Bool, +a: T(m), +b: T(Bool.not(m))) -> T(False{}):
  match m:
    case True{}:
      b
    case False{}:
      no(T(False{}), a)

def cp(m1: Bool, m2: Bool, f: T(m1) -> T(m2), +h: T(Bool.not(m2))) -> T(Bool.not(m1)):
  match m1:
    case True{}:
      no(T(Bool.not(True{})), ncase(m2, f({==}), h))
    case False{}:
      {==}

def eq_sym_b(+x: Nat, +y: Nat, +h: T(Nat.is_eq(x, y))) -> T(Nat.is_eq(y, x)):
  %eq_elim(x, y, h) : T(Nat.is_eq(_, x))
  eq_refl(x)

def ne_sym(+x: Nat, +y: Nat, +h: T(Bool.not(Nat.is_eq(x, y)))) -> T(Bool.not(Nat.is_eq(y, x))):
  cp(Nat.is_eq(y, x), Nat.is_eq(x, y), hh => eq_sym_b(y, x, hh), h)

def nm_sub(+x: Nat, +l: +List<Nat>, +m: +List<Nat>, +hs: T(S.all_in(l, m)), +h: NM(x, m)) -> NM(x, l):
  cp(M.mem(x, l), M.mem(x, m), hh => mem_all_in(x, l, m, hh, hs), h)

def nm_app(+x: Nat, +a: +List<Nat>, +b: +List<Nat>, +ha: NM(x, a), +hb: NM(x, b)) -> NM(x, List.append(&2, Nat, a, b)):
  match a:
    case Nil{}:
      hb
    case Con{+z, +rest}:
      nor_i(Nat.is_eq(x, z), M.mem(x, List.append(&2, Nat, rest, b)), nor_l(Nat.is_eq(x, z), M.mem(x, rest), ha), nm_app(x, rest, b, nor_r(Nat.is_eq(x, z), M.mem(x, rest), ha), hb))

def nm_snoc(+x: Nat, +l: +List<Nat>, +y: Nat, +hl: NM(x, l), +hy: T(Bool.not(Nat.is_eq(x, y)))) -> NM(x, M.snoc(l, y)):
  match l:
    case Nil{}:
      nor_i(Nat.is_eq(x, y), False{}, hy, {==})
    case Con{+z, +rest}:
      nor_i(Nat.is_eq(x, z), M.mem(x, M.snoc(rest, y)), nor_l(Nat.is_eq(x, z), M.mem(x, rest), hl), nm_snoc(x, rest, y, nor_r(Nat.is_eq(x, z), M.mem(x, rest), hl), hy))

def nm_cons(+x: Nat, +y: Nat, +l: +List<Nat>, +hy: T(Bool.not(Nat.is_eq(x, y))), +hl: NM(x, l)) -> NM(x, y <> l):
  nor_i(Nat.is_eq(x, y), M.mem(x, l), hy, hl)

def DJ(+a: +List<Nat>, +b: +List<Nat>) -> Data:
  T(S.disjoint(a, b))

def ND(+a: +List<Nat>) -> Data:
  T(S.nodup(a))

def nm_eq(+x: Nat, +z: Nat, +zs: +List<Nat>, +e: {x == z : Nat}, +h: NM(z, zs)) -> NM(x, zs):
  %Equal.sym(Nat, x, z, e) : NM(_, zs)
  h

def dj_hd(+x: Nat, +rest: +List<Nat>, +ys: +List<Nat>, +h: DJ(x <> rest, ys)) -> NM(x, ys):
  and_l(Bool.not(M.mem(x, ys)), S.disjoint(rest, ys), h)

def dj_tl(+x: Nat, +rest: +List<Nat>, +ys: +List<Nat>, +h: DJ(x <> rest, ys)) -> DJ(rest, ys):
  and_r(Bool.not(M.mem(x, ys)), S.disjoint(rest, ys), h)

def dj_cons_l(+x: Nat, +rest: +List<Nat>, +ys: +List<Nat>, +hx: NM(x, ys), +h: DJ(rest, ys)) -> DJ(x <> rest, ys):
  and_i(Bool.not(M.mem(x, ys)), S.disjoint(rest, ys), hx, h)

def dj_nm(+xs: +List<Nat>, +ys: +List<Nat>, +z: Nat, +hm: T(M.mem(z, xs)), +h: DJ(xs, ys)) -> NM(z, ys):
  match xs:
    case Nil{}:
      no(NM(z, ys), hm)
    case Con{+x, +rest}:
      or_elim(Bool.not(M.mem(z, ys)), Nat.is_eq(z, x), M.mem(z, rest), he => nm_eq(z, x, ys, eq_elim(z, x, he), dj_hd(x, rest, ys, h)), hr => dj_nm(rest, ys, z, hr, dj_tl(x, rest, ys, h)), hm)

def dj_nm_r(+xs: +List<Nat>, +y: Nat, +ys: +List<Nat>, +h: DJ(xs, y <> ys)) -> NM(y, xs):
  match xs:
    case Nil{}:
      {==}
    case Con{+x, +rest}:
      nor_i(Nat.is_eq(y, x), M.mem(y, rest), ne_sym(x, y, nor_l(Nat.is_eq(x, y), M.mem(x, ys), dj_hd(x, rest, y <> ys, h))), dj_nm_r(rest, y, ys, dj_tl(x, rest, y <> ys, h)))

def dj_tl_r(+xs: +List<Nat>, +y: Nat, +ys: +List<Nat>, +h: DJ(xs, y <> ys)) -> DJ(xs, ys):
  match xs:
    case Nil{}:
      {==}
    case Con{+x, +rest}:
      dj_cons_l(x, rest, ys, nor_r(Nat.is_eq(x, y), M.mem(x, ys), dj_hd(x, rest, y <> ys, h)), dj_tl_r(rest, y, ys, dj_tl(x, rest, y <> ys, h)))

def dj_sym(+xs: +List<Nat>, +ys: +List<Nat>, +h: DJ(xs, ys)) -> DJ(ys, xs):
  match ys:
    case Nil{}:
      {==}
    case Con{+y, +rest}:
      dj_cons_l(y, rest, xs, dj_nm_r(xs, y, rest, h), dj_sym(xs, rest, dj_tl_r(xs, y, rest, h)))

def dj_nil_r(+xs: +List<Nat>) -> DJ(xs, []):
  match xs:
    case Nil{}:
      {==}
    case Con{+x, +rest}:
      dj_cons_l(x, rest, [], {==}, dj_nil_r(rest))

def dj_app_l(+a: +List<Nat>, +b: +List<Nat>, +c: +List<Nat>, +ha: DJ(a, c), +hb: DJ(b, c)) -> DJ(List.append(&2, Nat, a, b), c):
  match a:
    case Nil{}:
      hb
    case Con{+x, +rest}:
      dj_cons_l(x, List.append(&2, Nat, rest, b), c, dj_hd(x, rest, c, ha), dj_app_l(rest, b, c, dj_tl(x, rest, c, ha), hb))

def dj_app_r(+a: +List<Nat>, +b: +List<Nat>, +c: +List<Nat>, +hb: DJ(a, b), +hc: DJ(a, c)) -> DJ(a, List.append(&2, Nat, b, c)):
  match a:
    case Nil{}:
      {==}
    case Con{+x, +rest}:
      dj_cons_l(x, rest, List.append(&2, Nat, b, c), nm_app(x, b, c, dj_hd(x, rest, b, hb), dj_hd(x, rest, c, hc)), dj_app_r(rest, b, c, dj_tl(x, rest, b, hb), dj_tl(x, rest, c, hc)))

def dj_snoc_r(+a: +List<Nat>, +b: +List<Nat>, +y: Nat, +h: DJ(a, b), +hy: NM(y, a)) -> DJ(a, M.snoc(b, y)):
  match a:
    case Nil{}:
      {==}
    case Con{+x, +rest}:
      dj_cons_l(x, rest, M.snoc(b, y), nm_snoc(x, b, y, dj_hd(x, rest, b, h), ne_sym(y, x, nor_l(Nat.is_eq(y, x), M.mem(y, rest), hy))), dj_snoc_r(rest, b, y, dj_tl(x, rest, b, h), nor_r(Nat.is_eq(y, x), M.mem(y, rest), hy)))

def dj_snoc_l(+a: +List<Nat>, +b: +List<Nat>, +y: Nat, +h: DJ(a, b), +hy: NM(y, b)) -> DJ(M.snoc(a, y), b):
  match a:
    case Nil{}:
      dj_cons_l(y, [], b, hy, {==})
    case Con{+x, +rest}:
      dj_cons_l(x, M.snoc(rest, y), b, dj_hd(x, rest, b, h), dj_snoc_l(rest, b, y, dj_tl(x, rest, b, h), hy))

def dj_cons_r(+a: +List<Nat>, +y: Nat, +b: +List<Nat>, +h: DJ(a, b), +hy: NM(y, a)) -> DJ(a, y <> b):
  match a:
    case Nil{}:
      {==}
    case Con{+x, +rest}:
      dj_cons_l(x, rest, y <> b, nm_cons(x, y, b, ne_sym(y, x, nor_l(Nat.is_eq(y, x), M.mem(y, rest), hy)), dj_hd(x, rest, b, h)), dj_cons_r(rest, y, b, dj_tl(x, rest, b, h), nor_r(Nat.is_eq(y, x), M.mem(y, rest), hy)))

def dj_sub_l(+a1: +List<Nat>, +a: +List<Nat>, +b: +List<Nat>, +hs: T(S.all_in(a1, a)), +h: DJ(a, b)) -> DJ(a1, b):
  match a1:
    case Nil{}:
      {==}
    case Con{+x, +rest}:
      dj_cons_l(x, rest, b, dj_nm(a, b, x, and_l(M.mem(x, a), S.all_in(rest, a), hs), h), dj_sub_l(rest, a, b, and_r(M.mem(x, a), S.all_in(rest, a), hs), h))

def dj_sub_r(+a: +List<Nat>, +b1: +List<Nat>, +b: +List<Nat>, +hs: T(S.all_in(b1, b)), +h: DJ(a, b)) -> DJ(a, b1):
  match a:
    case Nil{}:
      {==}
    case Con{+x, +rest}:
      dj_cons_l(x, rest, b1, nm_sub(x, b1, b, hs, dj_hd(x, rest, b, h)), dj_sub_r(rest, b1, b, hs, dj_tl(x, rest, b, h)))

def nd_hd(+x: Nat, +rest: +List<Nat>, +h: ND(x <> rest)) -> NM(x, rest):
  and_l(Bool.not(M.mem(x, rest)), S.nodup(rest), h)

def nd_tl(+x: Nat, +rest: +List<Nat>, +h: ND(x <> rest)) -> ND(rest):
  and_r(Bool.not(M.mem(x, rest)), S.nodup(rest), h)

def nd_cons(+x: Nat, +rest: +List<Nat>, +hx: NM(x, rest), +h: ND(rest)) -> ND(x <> rest):
  and_i(Bool.not(M.mem(x, rest)), S.nodup(rest), hx, h)

def nd_snoc(+l: +List<Nat>, +y: Nat, +h: ND(l), +hy: NM(y, l)) -> ND(M.snoc(l, y)):
  match l:
    case Nil{}:
      nd_cons(y, [], {==}, {==})
    case Con{+x, +rest}:
      nd_cons(x, M.snoc(rest, y), nm_snoc(x, rest, y, nd_hd(x, rest, h), ne_sym(y, x, nor_l(Nat.is_eq(y, x), M.mem(y, rest), hy))), nd_snoc(rest, y, nd_tl(x, rest, h), nor_r(Nat.is_eq(y, x), M.mem(y, rest), hy)))

def nd_app(+a: +List<Nat>, +b: +List<Nat>, +ha: ND(a), +hb: ND(b), +hd: DJ(a, b)) -> ND(List.append(&2, Nat, a, b)):
  match a:
    case Nil{}:
      hb
    case Con{+x, +rest}:
      nd_cons(x, List.append(&2, Nat, rest, b), nm_app(x, rest, b, nd_hd(x, rest, ha), dj_hd(x, rest, b, hd)), nd_app(rest, b, nd_tl(x, rest, ha), hb, dj_tl(x, rest, b, hd)))

def rm_sub_step(b: Bool, +y: Nat, +rest: +List<Nat>, +tail: +List<Nat>, +ht: T(S.all_in(tail, rest))) -> T(S.all_in(M.remove_step(b, y, tail), y <> rest)):
  match b:
    case True{}:
      all_in_cons_r(tail, y, rest, ht)
    case False{}:
      and_i(M.mem(y, y <> rest), S.all_in(tail, y <> rest), or_l(Nat.is_eq(y, y), M.mem(y, rest), eq_refl(y)), all_in_cons_r(tail, y, rest, ht))

def rm_sub(+x: Nat, +l: +List<Nat>) -> T(S.all_in(M.remove(x, l), l)):
  match l:
    case Nil{}:
      {==}
    case Con{+y, +rest}:
      rm_sub_step(Nat.is_eq(x, y), y, rest, M.remove(x, rest), rm_sub(x, rest))

def keep_sub_step(b: Bool, +y: Nat, +rest: +List<Nat>, +tail: +List<Nat>, +ht: T(S.all_in(tail, rest))) -> T(S.all_in(M.keep_step(b, y, tail), y <> rest)):
  match b:
    case True{}:
      and_i(M.mem(y, y <> rest), S.all_in(tail, y <> rest), or_l(Nat.is_eq(y, y), M.mem(y, rest), eq_refl(y)), all_in_cons_r(tail, y, rest, ht))
    case False{}:
      all_in_cons_r(tail, y, rest, ht)

def keep_sub(+q: +List<Nat>, +u: +List<Nat>) -> T(S.all_in(M.keep_users(q, u), q)):
  match q:
    case Nil{}:
      {==}
    case Con{+y, +rest}:
      keep_sub_step(M.mem(y, u), y, rest, M.keep_users(rest, u), keep_sub(rest, u))

def drop_sub_step(b: Bool, +y: Nat, +rest: +List<Nat>, +tail: +List<Nat>, +ht: T(S.all_in(tail, rest))) -> T(S.all_in(M.drop_step(b, y, tail), y <> rest)):
  match b:
    case True{}:
      all_in_cons_r(tail, y, rest, ht)
    case False{}:
      and_i(M.mem(y, y <> rest), S.all_in(tail, y <> rest), or_l(Nat.is_eq(y, y), M.mem(y, rest), eq_refl(y)), all_in_cons_r(tail, y, rest, ht))

def drop_sub(+q: +List<Nat>, +u: +List<Nat>) -> T(S.all_in(M.drop_users(q, u), q)):
  match q:
    case Nil{}:
      {==}
    case Con{+y, +rest}:
      drop_sub_step(M.mem(y, u), y, rest, M.drop_users(rest, u), drop_sub(rest, u))

def rs_nm(b: Bool, +x: Nat, +y: Nat, +tail: +List<Nat>, +hn: NM(x, tail), hb: T(Bool.not(b)) -> T(Bool.not(Nat.is_eq(x, y)))) -> NM(x, M.remove_step(b, y, tail)):
  match b:
    case True{}:
      hn
    case False{}:
      nm_cons(x, y, tail, hb({==}), hn)

def nm_removed(+x: Nat, +l: +List<Nat>) -> NM(x, M.remove(x, l)):
  match l:
    case Nil{}:
      {==}
    case Con{+y, +rest}:
      rs_nm(Nat.is_eq(x, y), x, y, M.remove(x, rest), nm_removed(x, rest), hh => hh)

def rs_nd(b: Bool, +y: Nat, +tail: +List<Nat>, +hn: NM(y, tail), +ht: ND(tail)) -> ND(M.remove_step(b, y, tail)):
  match b:
    case True{}:
      ht
    case False{}:
      nd_cons(y, tail, hn, ht)

def nd_remove(+x: Nat, +l: +List<Nat>, +h: ND(l)) -> ND(M.remove(x, l)):
  match l:
    case Nil{}:
      {==}
    case Con{+y, +rest}:
      rs_nd(Nat.is_eq(x, y), y, M.remove(x, rest), nm_sub(y, M.remove(x, rest), rest, rm_sub(x, rest), nd_hd(y, rest, h)), nd_remove(x, rest, nd_tl(y, rest, h)))

def ks_nd(b: Bool, +y: Nat, +tail: +List<Nat>, +hn: NM(y, tail), +ht: ND(tail)) -> ND(M.keep_step(b, y, tail)):
  match b:
    case True{}:
      nd_cons(y, tail, hn, ht)
    case False{}:
      ht

def nd_keep(+q: +List<Nat>, +u: +List<Nat>, +h: ND(q)) -> ND(M.keep_users(q, u)):
  match q:
    case Nil{}:
      {==}
    case Con{+y, +rest}:
      ks_nd(M.mem(y, u), y, M.keep_users(rest, u), nm_sub(y, M.keep_users(rest, u), rest, keep_sub(rest, u), nd_hd(y, rest, h)), nd_keep(rest, u, nd_tl(y, rest, h)))

def ds_nd(b: Bool, +y: Nat, +tail: +List<Nat>, +hn: NM(y, tail), +ht: ND(tail)) -> ND(M.drop_step(b, y, tail)):
  match b:
    case True{}:
      ht
    case False{}:
      nd_cons(y, tail, hn, ht)

def nd_drop(+q: +List<Nat>, +u: +List<Nat>, +h: ND(q)) -> ND(M.drop_users(q, u)):
  match q:
    case Nil{}:
      {==}
    case Con{+y, +rest}:
      ds_nd(M.mem(y, u), y, M.drop_users(rest, u), nm_sub(y, M.drop_users(rest, u), rest, drop_sub(rest, u), nd_hd(y, rest, h)), nd_drop(rest, u, nd_tl(y, rest, h)))

def kd_step(b: Bool, +y: Nat, +k: +List<Nat>, +d: +List<Nat>, +hkd: DJ(k, d), +hk: NM(y, k), +hd: NM(y, d)) -> DJ(M.keep_step(b, y, k), M.drop_step(b, y, d)):
  match b:
    case True{}:
      dj_cons_l(y, k, d, hd, hkd)
    case False{}:
      dj_cons_r(k, y, d, hkd, hk)

def kd_dj(+q: +List<Nat>, +u: +List<Nat>, +h: ND(q)) -> DJ(M.keep_users(q, u), M.drop_users(q, u)):
  match q:
    case Nil{}:
      {==}
    case Con{+y, +rest}:
      kd_step(M.mem(y, u), y, M.keep_users(rest, u), M.drop_users(rest, u), kd_dj(rest, u, nd_tl(y, rest, h)), nm_sub(y, M.keep_users(rest, u), rest, keep_sub(rest, u), nd_hd(y, rest, h)), nm_sub(y, M.drop_users(rest, u), rest, drop_sub(rest, u), nd_hd(y, rest, h)))

def bd(+l: +List<Nat>, +n: Nat) -> Bool:
  match l:
    case Nil{}:
      True{}
    case Con{+x, +rest}:
      Bool.and(Nat.is_lt(x, n), bd(rest, n))

def BD(+l: +List<Nat>, +n: Nat) -> Data:
  T(bd(l, n))

def lt_eq(+x: Nat, +y: Nat, +n: Nat, +e: {x == y : Nat}, +h: T(Nat.is_lt(y, n))) -> T(Nat.is_lt(x, n)):
  %Equal.sym(Nat, x, y, e) : T(Nat.is_lt(_, n))
  h

def bd_hd(+x: Nat, +rest: +List<Nat>, +n: Nat, +h: BD(x <> rest, n)) -> T(Nat.is_lt(x, n)):
  and_l(Nat.is_lt(x, n), bd(rest, n), h)

def bd_tl(+x: Nat, +rest: +List<Nat>, +n: Nat, +h: BD(x <> rest, n)) -> BD(rest, n):
  and_r(Nat.is_lt(x, n), bd(rest, n), h)

def bd_cons(+x: Nat, +rest: +List<Nat>, +n: Nat, +hx: T(Nat.is_lt(x, n)), +h: BD(rest, n)) -> BD(x <> rest, n):
  and_i(Nat.is_lt(x, n), bd(rest, n), hx, h)

def bd_succ(+l: +List<Nat>, +n: Nat, +h: BD(l, n)) -> BD(l, 1n+n):
  match l:
    case Nil{}:
      {==}
    case Con{+x, +rest}:
      bd_cons(x, rest, 1n+n, lt_succ(x, n, bd_hd(x, rest, n, h)), bd_succ(rest, n, bd_tl(x, rest, n, h)))

def bd_fresh(+l: +List<Nat>, +n: Nat, +h: BD(l, n)) -> NM(n, l):
  match l:
    case Nil{}:
      {==}
    case Con{+x, +rest}:
      nor_i(Nat.is_eq(n, x), M.mem(n, rest), lt_ne(x, n, bd_hd(x, rest, n, h)), bd_fresh(rest, n, bd_tl(x, rest, n, h)))

def bd_mem(+m: +List<Nat>, +n: Nat, +x: Nat, +hm: T(M.mem(x, m)), +h: BD(m, n)) -> T(Nat.is_lt(x, n)):
  match m:
    case Nil{}:
      no(T(Nat.is_lt(x, n)), hm)
    case Con{+y, +rest}:
      or_elim(Nat.is_lt(x, n), Nat.is_eq(x, y), M.mem(x, rest), he => lt_eq(x, y, n, eq_elim(x, y, he), bd_hd(y, rest, n, h)), hr => bd_mem(rest, n, x, hr, bd_tl(y, rest, n, h)), hm)

def bd_sub(+l: +List<Nat>, +m: +List<Nat>, +n: Nat, +hs: T(S.all_in(l, m)), +h: BD(m, n)) -> BD(l, n):
  match l:
    case Nil{}:
      {==}
    case Con{+x, +rest}:
      bd_cons(x, rest, n, bd_mem(m, n, x, and_l(M.mem(x, m), S.all_in(rest, m), hs), h), bd_sub(rest, m, n, and_r(M.mem(x, m), S.all_in(rest, m), hs), h))

def bd_snoc(+l: +List<Nat>, +y: Nat, +n: Nat, +h: BD(l, n), +hy: T(Nat.is_lt(y, n))) -> BD(M.snoc(l, y), n):
  match l:
    case Nil{}:
      bd_cons(y, [], n, hy, {==})
    case Con{+x, +rest}:
      bd_cons(x, M.snoc(rest, y), n, bd_hd(x, rest, n, h), bd_snoc(rest, y, n, bd_tl(x, rest, n, h), hy))

def bd_app(+a: +List<Nat>, +b: +List<Nat>, +n: Nat, +ha: BD(a, n), +hb: BD(b, n)) -> BD(List.append(&2, Nat, a, b), n):
  match a:
    case Nil{}:
      hb
    case Con{+x, +rest}:
      bd_cons(x, List.append(&2, Nat, rest, b), n, bd_hd(x, rest, n, ha), bd_app(rest, b, n, bd_tl(x, rest, n, ha), hb))

def bd_snoc_new(+l: +List<Nat>, +n: Nat, +h: BD(l, n)) -> BD(M.snoc(l, n), 1n+n):
  bd_snoc(l, n, 1n+n, bd_succ(l, n, h), lt_new(n))

# arithmetic for M6
def EQ(+a: Nat, +b: Nat) -> Data:
  {a == b : Nat}

def tr(+a: Nat, +b: Nat, +c: Nat, +ab: EQ(a, b), +bc: EQ(b, c)) -> EQ(a, c):
  Equal.trans(Nat, a, b, c, ab, bc)

def sy(+a: Nat, +b: Nat, +e: EQ(a, b)) -> EQ(b, a):
  Equal.sym(Nat, a, b, e)

def sc(+a: Nat, +b: Nat, +e: EQ(a, b)) -> EQ(1n+a, 1n+b):
  Equal.cong(Nat, Nat, x => 1n+x, a, b, e)

def ar(+k: Nat, +a: Nat, +b: Nat, +e: EQ(a, b)) -> EQ(Nat.add(k, a), Nat.add(k, b)):
  Equal.cong(Nat, Nat, x => Nat.add(k, x), a, b, e)

def al(+k: Nat, +a: Nat, +b: Nat, +e: EQ(a, b)) -> EQ(Nat.add(a, k), Nat.add(b, k)):
  Equal.cong(Nat, Nat, x => Nat.add(x, k), a, b, e)

def add_zero_r(+a: Nat) -> EQ(Nat.add(a, 0n), a):
  match a:
    case 0n:
      {==}
    case 1n+p:
      sc(Nat.add(p, 0n), p, add_zero_r(p))

def add_succ_r(+a: Nat, +b: Nat) -> EQ(Nat.add(a, 1n+b), 1n+Nat.add(a, b)):
  match a:
    case 0n:
      {==}
    case 1n+p:
      sc(Nat.add(p, 1n+b), 1n+Nat.add(p, b), add_succ_r(p, b))

def add_comm(+a: Nat, +b: Nat) -> EQ(Nat.add(a, b), Nat.add(b, a)):
  match a:
    case 0n:
      sy(Nat.add(b, 0n), b, add_zero_r(b))
    case 1n+p:
      tr(1n+Nat.add(p, b), 1n+Nat.add(b, p), Nat.add(b, 1n+p), sc(Nat.add(p, b), Nat.add(b, p), add_comm(p, b)), sy(Nat.add(b, 1n+p), 1n+Nat.add(b, p), add_succ_r(b, p)))

def add_assoc(+a: Nat, +b: Nat, +c: Nat) -> EQ(Nat.add(Nat.add(a, b), c), Nat.add(a, Nat.add(b, c))):
  match a:
    case 0n:
      {==}
    case 1n+p:
      sc(Nat.add(Nat.add(p, b), c), Nat.add(p, Nat.add(b, c)), add_assoc(p, b, c))

def swp(+a: Nat, +b: Nat, +c: Nat) -> EQ(Nat.add(a, Nat.add(b, c)), Nat.add(b, Nat.add(a, c))):
  tr(Nat.add(a, Nat.add(b, c)), Nat.add(Nat.add(a, b), c), Nat.add(b, Nat.add(a, c)), sy(Nat.add(Nat.add(a, b), c), Nat.add(a, Nat.add(b, c)), add_assoc(a, b, c)), tr(Nat.add(Nat.add(a, b), c), Nat.add(Nat.add(b, a), c), Nat.add(b, Nat.add(a, c)), al(c, Nat.add(a, b), Nat.add(b, a), add_comm(a, b)), add_assoc(b, a, c)))

def push1(+a: Nat, +x: Nat) -> EQ(Nat.add(a, 1n+x), 1n+Nat.add(a, x)):
  add_succ_r(a, x)

def push2(+a: Nat, +b: Nat, +x: Nat) -> EQ(Nat.add(a, Nat.add(b, 1n+x)), 1n+Nat.add(a, Nat.add(b, x))):
  tr(Nat.add(a, Nat.add(b, 1n+x)), Nat.add(a, 1n+Nat.add(b, x)), 1n+Nat.add(a, Nat.add(b, x)), ar(a, Nat.add(b, 1n+x), 1n+Nat.add(b, x), push1(b, x)), push1(a, Nat.add(b, x)))

def push3(+a: Nat, +b: Nat, +c: Nat, +x: Nat) -> EQ(Nat.add(a, Nat.add(b, Nat.add(c, 1n+x))), 1n+Nat.add(a, Nat.add(b, Nat.add(c, x)))):
  tr(Nat.add(a, Nat.add(b, Nat.add(c, 1n+x))), Nat.add(a, 1n+Nat.add(b, Nat.add(c, x))), 1n+Nat.add(a, Nat.add(b, Nat.add(c, x))), ar(a, Nat.add(b, Nat.add(c, 1n+x)), 1n+Nat.add(b, Nat.add(c, x)), push2(b, c, x)), push1(a, Nat.add(b, Nat.add(c, x))))

def push4(+a: Nat, +b: Nat, +c: Nat, +e: Nat, +x: Nat) -> EQ(Nat.add(a, Nat.add(b, Nat.add(c, Nat.add(e, 1n+x)))), 1n+Nat.add(a, Nat.add(b, Nat.add(c, Nat.add(e, x))))):
  tr(Nat.add(a, Nat.add(b, Nat.add(c, Nat.add(e, 1n+x)))), Nat.add(a, 1n+Nat.add(b, Nat.add(c, Nat.add(e, x)))), 1n+Nat.add(a, Nat.add(b, Nat.add(c, Nat.add(e, x)))), ar(a, Nat.add(b, Nat.add(c, Nat.add(e, 1n+x))), 1n+Nat.add(b, Nat.add(c, Nat.add(e, x))), push3(b, c, e, x)), push1(a, Nat.add(b, Nat.add(c, Nat.add(e, x))))) 

def SG(+lq: Nat, +la: Nat, +lk: Nat, +lt: Nat, +ld: Nat) -> Nat:
  Nat.add(1n, Nat.add(lq, Nat.add(la, Nat.add(lk, Nat.add(lt, ld)))))

def SUMB(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat) -> Bool:
  Nat.is_eq(SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), n)

def eq_intro(+x: Nat, +y: Nat, +e: EQ(x, y)) -> T(Nat.is_eq(x, y)):
  %e : T(Nat.is_eq(x, _))
  eq_refl(x)

def cgq(+x: Nat, +y: Nat, +la: Nat, +lk: Nat, +lt: Nat, +ld: Nat, +e: EQ(x, y)) -> EQ(SG(x, la, lk, lt, ld), SG(y, la, lk, lt, ld)):
  Equal.cong(Nat, Nat, v => SG(v, la, lk, lt, ld), x, y, e)

def cga(+lq: Nat, +x: Nat, +y: Nat, +lk: Nat, +lt: Nat, +ld: Nat, +e: EQ(x, y)) -> EQ(SG(lq, x, lk, lt, ld), SG(lq, y, lk, lt, ld)):
  Equal.cong(Nat, Nat, v => SG(lq, v, lk, lt, ld), x, y, e)

def cgk(+lq: Nat, +la: Nat, +x: Nat, +y: Nat, +lt: Nat, +ld: Nat, +e: EQ(x, y)) -> EQ(SG(lq, la, x, lt, ld), SG(lq, la, y, lt, ld)):
  Equal.cong(Nat, Nat, v => SG(lq, la, v, lt, ld), x, y, e)

def cgt(+lq: Nat, +la: Nat, +lk: Nat, +x: Nat, +y: Nat, +ld: Nat, +e: EQ(x, y)) -> EQ(SG(lq, la, lk, x, ld), SG(lq, la, lk, y, ld)):
  Equal.cong(Nat, Nat, v => SG(lq, la, lk, v, ld), x, y, e)

def cgd(+lq: Nat, +la: Nat, +lk: Nat, +lt: Nat, +x: Nat, +y: Nat, +e: EQ(x, y)) -> EQ(SG(lq, la, lk, lt, x), SG(lq, la, lk, lt, y)):
  Equal.cong(Nat, Nat, v => SG(lq, la, lk, lt, v), x, y, e)

def bq(+lq: Nat, +la: Nat, +lk: Nat, +lt: Nat, +ld: Nat) -> EQ(SG(1n+lq, la, lk, lt, ld), 1n+SG(lq, la, lk, lt, ld)):
  {==}

def ba(+lq: Nat, +la: Nat, +lk: Nat, +lt: Nat, +ld: Nat) -> EQ(SG(lq, 1n+la, lk, lt, ld), 1n+SG(lq, la, lk, lt, ld)):
  sc(Nat.add(lq, 1n+Nat.add(la, Nat.add(lk, Nat.add(lt, ld)))), 1n+Nat.add(lq, Nat.add(la, Nat.add(lk, Nat.add(lt, ld)))), push1(lq, Nat.add(la, Nat.add(lk, Nat.add(lt, ld)))))

def bk(+lq: Nat, +la: Nat, +lk: Nat, +lt: Nat, +ld: Nat) -> EQ(SG(lq, la, 1n+lk, lt, ld), 1n+SG(lq, la, lk, lt, ld)):
  sc(Nat.add(lq, Nat.add(la, 1n+Nat.add(lk, Nat.add(lt, ld)))), 1n+Nat.add(lq, Nat.add(la, Nat.add(lk, Nat.add(lt, ld)))), push2(lq, la, Nat.add(lk, Nat.add(lt, ld))))

def bt(+lq: Nat, +la: Nat, +lk: Nat, +lt: Nat, +ld: Nat) -> EQ(SG(lq, la, lk, 1n+lt, ld), 1n+SG(lq, la, lk, lt, ld)):
  sc(Nat.add(lq, Nat.add(la, Nat.add(lk, 1n+Nat.add(lt, ld)))), 1n+Nat.add(lq, Nat.add(la, Nat.add(lk, Nat.add(lt, ld)))), push3(lq, la, lk, Nat.add(lt, ld)))

def bdd(+lq: Nat, +la: Nat, +lk: Nat, +lt: Nat, +ld: Nat) -> EQ(SG(lq, la, lk, lt, 1n+ld), 1n+SG(lq, la, lk, lt, ld)):
  sc(Nat.add(lq, Nat.add(la, Nat.add(lk, Nat.add(lt, 1n+ld)))), 1n+Nat.add(lq, Nat.add(la, Nat.add(lk, Nat.add(lt, ld)))), push4(lq, la, lk, lt, ld))

def len_app(+a: +List<Nat>, +b: +List<Nat>) -> EQ(S.len(List.append(&2, Nat, a, b)), Nat.add(S.len(a), S.len(b))):
  match a:
    case Nil{}:
      {==}
    case Con{+x, +rest}:
      sc(S.len(List.append(&2, Nat, rest, b)), Nat.add(S.len(rest), S.len(b)), len_app(rest, b))

def len_snoc(+l: +List<Nat>, +y: Nat) -> EQ(S.len(M.snoc(l, y)), 1n+S.len(l)):
  match l:
    case Nil{}:
      {==}
    case Con{+x, +rest}:
      sc(S.len(M.snoc(rest, y)), 1n+S.len(rest), len_snoc(rest, y))

def ra_step(b: Bool, +y: Nat, +rest: +List<Nat>, +tail: +List<Nat>, +hnb: T(Bool.not(b)), +ht: EQ(S.len(tail), S.len(rest))) -> EQ(S.len(M.remove_step(b, y, tail)), S.len(y <> rest)):
  match b:
    case True{}:
      no(EQ(S.len(M.remove_step(True{}, y, tail)), S.len(y <> rest)), hnb)
    case False{}:
      sc(S.len(tail), S.len(rest), ht)

def len_rm_absent(+id: Nat, +l: +List<Nat>, +h: NM(id, l)) -> EQ(S.len(M.remove(id, l)), S.len(l)):
  match l:
    case Nil{}:
      {==}
    case Con{+y, +rest}:
      ra_step(Nat.is_eq(id, y), y, rest, M.remove(id, rest), nor_l(Nat.is_eq(id, y), M.mem(id, rest), h), len_rm_absent(id, rest, nor_r(Nat.is_eq(id, y), M.mem(id, rest), h)))

def rm_len_step(b: Bool, +y: Nat, +rest: +List<Nat>, +tail: +List<Nat>, m: Bool, +hm: T(Bool.or(b, m)), hT: T(b) -> EQ(S.len(rest), S.len(tail)), hF: T(m) -> EQ(S.len(rest), 1n+S.len(tail))) -> EQ(S.len(y <> rest), 1n+S.len(M.remove_step(b, y, tail))):
  match b:
    case True{}:
      sc(S.len(rest), S.len(tail), hT({==}))
    case False{}:
      sc(S.len(rest), 1n+S.len(tail), hF(hm))

def len_rm(+id: Nat, +l: +List<Nat>, +hm: T(M.mem(id, l)), +hn: ND(l)) -> EQ(S.len(l), 1n+S.len(M.remove(id, l))):
  match l:
    case Nil{}:
      no(EQ(S.len([]), 1n+S.len(M.remove(id, []))), hm)
    case Con{+y, +rest}:
      rm_len_step(Nat.is_eq(id, y), y, rest, M.remove(id, rest), M.mem(id, rest), hm, he => sy(S.len(M.remove(id, rest)), S.len(rest), len_rm_absent(id, rest, nm_eq(id, y, rest, eq_elim(id, y, he), nd_hd(y, rest, hn)))), hr => len_rm(id, rest, hr, nd_tl(y, rest, hn)))

def kd_len_step(b: Bool, +y: Nat, +rest: +List<Nat>, +k: +List<Nat>, +d: +List<Nat>, +ih: EQ(S.len(rest), Nat.add(S.len(k), S.len(d)))) -> EQ(S.len(y <> rest), Nat.add(S.len(M.keep_step(b, y, k)), S.len(M.drop_step(b, y, d)))):
  match b:
    case True{}:
      sc(S.len(rest), Nat.add(S.len(k), S.len(d)), ih)
    case False{}:
      tr(1n+S.len(rest), 1n+Nat.add(S.len(k), S.len(d)), Nat.add(S.len(k), 1n+S.len(d)), sc(S.len(rest), Nat.add(S.len(k), S.len(d)), ih), sy(Nat.add(S.len(k), 1n+S.len(d)), 1n+Nat.add(S.len(k), S.len(d)), add_succ_r(S.len(k), S.len(d))))

def len_kd(+q: +List<Nat>, +u: +List<Nat>) -> EQ(S.len(q), Nat.add(S.len(M.keep_users(q, u)), S.len(M.drop_users(q, u)))):
  match q:
    case Nil{}:
      {==}
    case Con{+y, +rest}:
      kd_len_step(M.mem(y, u), y, rest, M.keep_users(rest, u), M.drop_users(rest, u), len_kd(rest, u))

def shq(+lq: Nat, +la: Nat, +lk: Nat, +lt: Nat, +ld: Nat, +z: Nat) -> EQ(SG(Nat.add(lq, z), la, lk, lt, ld), Nat.add(z, SG(lq, la, lk, lt, ld))):
  tr(SG(Nat.add(lq, z), la, lk, lt, ld), 1n+Nat.add(z, Nat.add(lq, Nat.add(la, Nat.add(lk, Nat.add(lt, ld))))), Nat.add(z, SG(lq, la, lk, lt, ld)), sc(Nat.add(Nat.add(lq, z), Nat.add(la, Nat.add(lk, Nat.add(lt, ld)))), Nat.add(z, Nat.add(lq, Nat.add(la, Nat.add(lk, Nat.add(lt, ld))))), tr(Nat.add(Nat.add(lq, z), Nat.add(la, Nat.add(lk, Nat.add(lt, ld)))), Nat.add(lq, Nat.add(z, Nat.add(la, Nat.add(lk, Nat.add(lt, ld))))), Nat.add(z, Nat.add(lq, Nat.add(la, Nat.add(lk, Nat.add(lt, ld))))), add_assoc(lq, z, Nat.add(la, Nat.add(lk, Nat.add(lt, ld)))), swp(lq, z, Nat.add(la, Nat.add(lk, Nat.add(lt, ld)))))), sy(Nat.add(z, 1n+Nat.add(lq, Nat.add(la, Nat.add(lk, Nat.add(lt, ld))))), 1n+Nat.add(z, Nat.add(lq, Nat.add(la, Nat.add(lk, Nat.add(lt, ld))))), add_succ_r(z, Nat.add(lq, Nat.add(la, Nat.add(lk, Nat.add(lt, ld)))))))

def shk(+lq: Nat, +la: Nat, +lk: Nat, +lt: Nat, +ld: Nat, +z: Nat) -> EQ(SG(lq, la, Nat.add(lk, z), lt, ld), Nat.add(z, SG(lq, la, lk, lt, ld))):
  tr(SG(lq, la, Nat.add(lk, z), lt, ld), 1n+Nat.add(z, Nat.add(lq, Nat.add(la, Nat.add(lk, Nat.add(lt, ld))))), Nat.add(z, SG(lq, la, lk, lt, ld)), sc(Nat.add(lq, Nat.add(la, Nat.add(Nat.add(lk, z), Nat.add(lt, ld)))), Nat.add(z, Nat.add(lq, Nat.add(la, Nat.add(lk, Nat.add(lt, ld))))), tr(Nat.add(lq, Nat.add(la, Nat.add(Nat.add(lk, z), Nat.add(lt, ld)))), Nat.add(lq, Nat.add(z, Nat.add(la, Nat.add(lk, Nat.add(lt, ld))))), Nat.add(z, Nat.add(lq, Nat.add(la, Nat.add(lk, Nat.add(lt, ld))))), ar(lq, Nat.add(la, Nat.add(Nat.add(lk, z), Nat.add(lt, ld))), Nat.add(z, Nat.add(la, Nat.add(lk, Nat.add(lt, ld)))), tr(Nat.add(la, Nat.add(Nat.add(lk, z), Nat.add(lt, ld))), Nat.add(la, Nat.add(z, Nat.add(lk, Nat.add(lt, ld)))), Nat.add(z, Nat.add(la, Nat.add(lk, Nat.add(lt, ld)))), ar(la, Nat.add(Nat.add(lk, z), Nat.add(lt, ld)), Nat.add(z, Nat.add(lk, Nat.add(lt, ld))), tr(Nat.add(Nat.add(lk, z), Nat.add(lt, ld)), Nat.add(lk, Nat.add(z, Nat.add(lt, ld))), Nat.add(z, Nat.add(lk, Nat.add(lt, ld))), add_assoc(lk, z, Nat.add(lt, ld)), swp(lk, z, Nat.add(lt, ld)))), swp(la, z, Nat.add(lk, Nat.add(lt, ld))))), swp(lq, z, Nat.add(la, Nat.add(lk, Nat.add(lt, ld)))))), sy(Nat.add(z, 1n+Nat.add(lq, Nat.add(la, Nat.add(lk, Nat.add(lt, ld))))), 1n+Nat.add(z, Nat.add(lq, Nat.add(la, Nat.add(lk, Nat.add(lt, ld))))), add_succ_r(z, Nat.add(lq, Nat.add(la, Nat.add(lk, Nat.add(lt, ld)))))))

def shd(+lq: Nat, +la: Nat, +lk: Nat, +lt: Nat, +ld: Nat, +z: Nat) -> EQ(SG(lq, la, lk, lt, Nat.add(ld, z)), Nat.add(z, SG(lq, la, lk, lt, ld))):
  tr(SG(lq, la, lk, lt, Nat.add(ld, z)), 1n+Nat.add(z, Nat.add(lq, Nat.add(la, Nat.add(lk, Nat.add(lt, ld))))), Nat.add(z, SG(lq, la, lk, lt, ld)), sc(Nat.add(lq, Nat.add(la, Nat.add(lk, Nat.add(lt, Nat.add(ld, z))))), Nat.add(z, Nat.add(lq, Nat.add(la, Nat.add(lk, Nat.add(lt, ld))))), tr(Nat.add(lq, Nat.add(la, Nat.add(lk, Nat.add(lt, Nat.add(ld, z))))), Nat.add(lq, Nat.add(z, Nat.add(la, Nat.add(lk, Nat.add(lt, ld))))), Nat.add(z, Nat.add(lq, Nat.add(la, Nat.add(lk, Nat.add(lt, ld))))), ar(lq, Nat.add(la, Nat.add(lk, Nat.add(lt, Nat.add(ld, z)))), Nat.add(z, Nat.add(la, Nat.add(lk, Nat.add(lt, ld)))), tr(Nat.add(la, Nat.add(lk, Nat.add(lt, Nat.add(ld, z)))), Nat.add(la, Nat.add(z, Nat.add(lk, Nat.add(lt, ld)))), Nat.add(z, Nat.add(la, Nat.add(lk, Nat.add(lt, ld)))), ar(la, Nat.add(lk, Nat.add(lt, Nat.add(ld, z))), Nat.add(z, Nat.add(lk, Nat.add(lt, ld))), tr(Nat.add(lk, Nat.add(lt, Nat.add(ld, z))), Nat.add(lk, Nat.add(z, Nat.add(lt, ld))), Nat.add(z, Nat.add(lk, Nat.add(lt, ld))), ar(lk, Nat.add(lt, Nat.add(ld, z)), Nat.add(z, Nat.add(lt, ld)), tr(Nat.add(lt, Nat.add(ld, z)), Nat.add(lt, Nat.add(z, ld)), Nat.add(z, Nat.add(lt, ld)), ar(lt, Nat.add(ld, z), Nat.add(z, ld), add_comm(ld, z)), swp(lt, z, ld))), swp(lk, z, Nat.add(lt, ld)))), swp(la, z, Nat.add(lk, Nat.add(lt, ld))))), swp(lq, z, Nat.add(la, Nat.add(lk, Nat.add(lt, ld)))))), sy(Nat.add(z, 1n+Nat.add(lq, Nat.add(la, Nat.add(lk, Nat.add(lt, ld))))), 1n+Nat.add(z, Nat.add(lq, Nat.add(la, Nat.add(lk, Nat.add(lt, ld))))), add_succ_r(z, Nat.add(lq, Nat.add(la, Nat.add(lk, Nat.add(lt, ld)))))))

def sm_sendQ(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +hs: T(SUMB(q, a, k, t, d, n))) -> T(SUMB(M.snoc(q, n), a, k, t, d, 1n+n)):
  eq_intro(SG(S.len(M.snoc(q, n)), S.len(a), S.len(k), S.len(t), S.len(d)), 1n+n, tr(SG(S.len(M.snoc(q, n)), S.len(a), S.len(k), S.len(t), S.len(d)), SG(1n+S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), 1n+n, cgq(S.len(M.snoc(q, n)), 1n+S.len(q), S.len(a), S.len(k), S.len(t), S.len(d), len_snoc(q, n)), tr(SG(1n+S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), 1n+SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), 1n+n, bq(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), sc(SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), n, eq_elim(SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), n, hs)))))

def sm_sendA(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +hs: T(SUMB(q, a, k, t, d, n))) -> T(SUMB(q, M.snoc(a, n), k, t, d, 1n+n)):
  eq_intro(SG(S.len(q), S.len(M.snoc(a, n)), S.len(k), S.len(t), S.len(d)), 1n+n, tr(SG(S.len(q), S.len(M.snoc(a, n)), S.len(k), S.len(t), S.len(d)), SG(S.len(q), 1n+S.len(a), S.len(k), S.len(t), S.len(d)), 1n+n, cga(S.len(q), S.len(M.snoc(a, n)), 1n+S.len(a), S.len(k), S.len(t), S.len(d), len_snoc(a, n)), tr(SG(S.len(q), 1n+S.len(a), S.len(k), S.len(t), S.len(d)), 1n+SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), 1n+n, ba(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), sc(SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), n, eq_elim(SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), n, hs)))))

def sm_sendK(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +hs: T(SUMB(q, a, k, t, d, n))) -> T(SUMB(q, a, M.snoc(k, n), t, d, 1n+n)):
  eq_intro(SG(S.len(q), S.len(a), S.len(M.snoc(k, n)), S.len(t), S.len(d)), 1n+n, tr(SG(S.len(q), S.len(a), S.len(M.snoc(k, n)), S.len(t), S.len(d)), SG(S.len(q), S.len(a), 1n+S.len(k), S.len(t), S.len(d)), 1n+n, cgk(S.len(q), S.len(a), S.len(M.snoc(k, n)), 1n+S.len(k), S.len(t), S.len(d), len_snoc(k, n)), tr(SG(S.len(q), S.len(a), 1n+S.len(k), S.len(t), S.len(d)), 1n+SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), 1n+n, bk(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), sc(SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), n, eq_elim(SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), n, hs)))))

def sm_sendD(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +hs: T(SUMB(q, a, k, t, d, n))) -> T(SUMB(q, a, k, t, M.snoc(d, n), 1n+n)):
  eq_intro(SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(M.snoc(d, n))), 1n+n, tr(SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(M.snoc(d, n))), SG(S.len(q), S.len(a), S.len(k), S.len(t), 1n+S.len(d)), 1n+n, cgd(S.len(q), S.len(a), S.len(k), S.len(t), S.len(M.snoc(d, n)), 1n+S.len(d), len_snoc(d, n)), tr(SG(S.len(q), S.len(a), S.len(k), S.len(t), 1n+S.len(d)), 1n+SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), 1n+n, bdd(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), sc(SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), n, eq_elim(SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), n, hs)))))

def sm_mv(+x: Nat, +r: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +hs: T(SUMB(x <> r, a, k, t, d, n))) -> T(SUMB(r, a, k, M.snoc(t, x), d, n)):
  eq_intro(SG(S.len(r), S.len(a), S.len(k), S.len(M.snoc(t, x)), S.len(d)), n, tr(SG(S.len(r), S.len(a), S.len(k), S.len(M.snoc(t, x)), S.len(d)), SG(S.len(r), S.len(a), S.len(k), 1n+S.len(t), S.len(d)), n, cgt(S.len(r), S.len(a), S.len(k), S.len(M.snoc(t, x)), 1n+S.len(t), S.len(d), len_snoc(t, x)), tr(SG(S.len(r), S.len(a), S.len(k), 1n+S.len(t), S.len(d)), 1n+SG(S.len(r), S.len(a), S.len(k), S.len(t), S.len(d)), n, bt(S.len(r), S.len(a), S.len(k), S.len(t), S.len(d)), tr(1n+SG(S.len(r), S.len(a), S.len(k), S.len(t), S.len(d)), SG(1n+S.len(r), S.len(a), S.len(k), S.len(t), S.len(d)), n, sy(SG(1n+S.len(r), S.len(a), S.len(k), S.len(t), S.len(d)), 1n+SG(S.len(r), S.len(a), S.len(k), S.len(t), S.len(d)), bq(S.len(r), S.len(a), S.len(k), S.len(t), S.len(d))), eq_elim(SG(S.len(x <> r), S.len(a), S.len(k), S.len(t), S.len(d)), n, hs)))))

def sm_tb(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +u: +List<Nat>, +hs: T(SUMB(q, a, k, t, d, n))) -> T(SUMB(M.keep_users(q, u), a, List.append(&2, Nat, k, M.drop_users(q, u)), t, d, n)):
  eq_intro(SG(S.len(M.keep_users(q, u)), S.len(a), S.len(List.append(&2, Nat, k, M.drop_users(q, u))), S.len(t), S.len(d)), n, tr(SG(S.len(M.keep_users(q, u)), S.len(a), S.len(List.append(&2, Nat, k, M.drop_users(q, u))), S.len(t), S.len(d)), Nat.add(S.len(M.drop_users(q, u)), SG(S.len(M.keep_users(q, u)), S.len(a), S.len(k), S.len(t), S.len(d))), n, tr(SG(S.len(M.keep_users(q, u)), S.len(a), S.len(List.append(&2, Nat, k, M.drop_users(q, u))), S.len(t), S.len(d)), SG(S.len(M.keep_users(q, u)), S.len(a), Nat.add(S.len(k), S.len(M.drop_users(q, u))), S.len(t), S.len(d)), Nat.add(S.len(M.drop_users(q, u)), SG(S.len(M.keep_users(q, u)), S.len(a), S.len(k), S.len(t), S.len(d))), cgk(S.len(M.keep_users(q, u)), S.len(a), S.len(List.append(&2, Nat, k, M.drop_users(q, u))), Nat.add(S.len(k), S.len(M.drop_users(q, u))), S.len(t), S.len(d), len_app(k, M.drop_users(q, u))), shk(S.len(M.keep_users(q, u)), S.len(a), S.len(k), S.len(t), S.len(d), S.len(M.drop_users(q, u)))), tr(Nat.add(S.len(M.drop_users(q, u)), SG(S.len(M.keep_users(q, u)), S.len(a), S.len(k), S.len(t), S.len(d))), SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), n, sy(SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), Nat.add(S.len(M.drop_users(q, u)), SG(S.len(M.keep_users(q, u)), S.len(a), S.len(k), S.len(t), S.len(d))), tr(SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), SG(Nat.add(S.len(M.keep_users(q, u)), S.len(M.drop_users(q, u))), S.len(a), S.len(k), S.len(t), S.len(d)), Nat.add(S.len(M.drop_users(q, u)), SG(S.len(M.keep_users(q, u)), S.len(a), S.len(k), S.len(t), S.len(d))), cgq(S.len(q), Nat.add(S.len(M.keep_users(q, u)), S.len(M.drop_users(q, u))), S.len(a), S.len(k), S.len(t), S.len(d), len_kd(q, u)), shq(S.len(M.keep_users(q, u)), S.len(a), S.len(k), S.len(t), S.len(d), S.len(M.drop_users(q, u))))), eq_elim(SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), n, hs))))

def sm_te(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +hs: T(SUMB(q, a, k, t, d, n))) -> T(SUMB(List.append(&2, Nat, q, k), a, [], t, d, n)):
  eq_intro(SG(S.len(List.append(&2, Nat, q, k)), S.len(a), S.len([]), S.len(t), S.len(d)), n, tr(SG(S.len(List.append(&2, Nat, q, k)), S.len(a), 0n, S.len(t), S.len(d)), Nat.add(S.len(k), SG(S.len(q), S.len(a), 0n, S.len(t), S.len(d))), n, tr(SG(S.len(List.append(&2, Nat, q, k)), S.len(a), 0n, S.len(t), S.len(d)), SG(Nat.add(S.len(q), S.len(k)), S.len(a), 0n, S.len(t), S.len(d)), Nat.add(S.len(k), SG(S.len(q), S.len(a), 0n, S.len(t), S.len(d))), cgq(S.len(List.append(&2, Nat, q, k)), Nat.add(S.len(q), S.len(k)), S.len(a), 0n, S.len(t), S.len(d), len_app(q, k)), shq(S.len(q), S.len(a), 0n, S.len(t), S.len(d), S.len(k))), tr(Nat.add(S.len(k), SG(S.len(q), S.len(a), 0n, S.len(t), S.len(d))), SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), n, sy(SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), Nat.add(S.len(k), SG(S.len(q), S.len(a), 0n, S.len(t), S.len(d))), shk(S.len(q), S.len(a), 0n, S.len(t), S.len(d), S.len(k))), eq_elim(SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), n, hs))))

def sm_ex(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +hs: T(SUMB(q, a, k, t, d, n))) -> T(SUMB([], a, [], t, List.append(&2, Nat, d, List.append(&2, Nat, q, k)), n)):
  eq_intro(SG(S.len([]), S.len(a), S.len([]), S.len(t), S.len(List.append(&2, Nat, d, List.append(&2, Nat, q, k)))), n, tr(SG(0n, S.len(a), 0n, S.len(t), S.len(List.append(&2, Nat, d, List.append(&2, Nat, q, k)))), Nat.add(Nat.add(S.len(q), S.len(k)), SG(0n, S.len(a), 0n, S.len(t), S.len(d))), n, tr(SG(0n, S.len(a), 0n, S.len(t), S.len(List.append(&2, Nat, d, List.append(&2, Nat, q, k)))), SG(0n, S.len(a), 0n, S.len(t), Nat.add(S.len(d), Nat.add(S.len(q), S.len(k)))), Nat.add(Nat.add(S.len(q), S.len(k)), SG(0n, S.len(a), 0n, S.len(t), S.len(d))), cgd(0n, S.len(a), 0n, S.len(t), S.len(List.append(&2, Nat, d, List.append(&2, Nat, q, k))), Nat.add(S.len(d), Nat.add(S.len(q), S.len(k))), tr(S.len(List.append(&2, Nat, d, List.append(&2, Nat, q, k))), Nat.add(S.len(d), S.len(List.append(&2, Nat, q, k))), Nat.add(S.len(d), Nat.add(S.len(q), S.len(k))), len_app(d, List.append(&2, Nat, q, k)), ar(S.len(d), S.len(List.append(&2, Nat, q, k)), Nat.add(S.len(q), S.len(k)), len_app(q, k)))), shd(0n, S.len(a), 0n, S.len(t), S.len(d), Nat.add(S.len(q), S.len(k)))), tr(Nat.add(Nat.add(S.len(q), S.len(k)), SG(0n, S.len(a), 0n, S.len(t), S.len(d))), SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), n, tr(Nat.add(Nat.add(S.len(q), S.len(k)), SG(0n, S.len(a), 0n, S.len(t), S.len(d))), Nat.add(S.len(q), Nat.add(S.len(k), SG(0n, S.len(a), 0n, S.len(t), S.len(d)))), SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), add_assoc(S.len(q), S.len(k), SG(0n, S.len(a), 0n, S.len(t), S.len(d))), sy(SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), Nat.add(S.len(q), Nat.add(S.len(k), SG(0n, S.len(a), 0n, S.len(t), S.len(d)))), tr(SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), Nat.add(S.len(q), SG(0n, S.len(a), S.len(k), S.len(t), S.len(d))), Nat.add(S.len(q), Nat.add(S.len(k), SG(0n, S.len(a), 0n, S.len(t), S.len(d)))), shq(0n, S.len(a), S.len(k), S.len(t), S.len(d), S.len(q)), ar(S.len(q), SG(0n, S.len(a), S.len(k), S.len(t), S.len(d)), Nat.add(S.len(k), SG(0n, S.len(a), 0n, S.len(t), S.len(d))), shk(0n, S.len(a), 0n, S.len(t), S.len(d), S.len(k)))))), eq_elim(SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), n, hs))))

def sm_di(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +id: Nat, +hm: T(M.mem(id, a)), +hn: ND(a), +hs: T(SUMB(q, a, k, t, d, n))) -> T(SUMB(M.snoc(q, id), M.remove(id, a), k, t, d, n)):
  eq_intro(SG(S.len(M.snoc(q, id)), S.len(M.remove(id, a)), S.len(k), S.len(t), S.len(d)), n, tr(SG(S.len(M.snoc(q, id)), S.len(M.remove(id, a)), S.len(k), S.len(t), S.len(d)), 1n+SG(S.len(q), S.len(M.remove(id, a)), S.len(k), S.len(t), S.len(d)), n, tr(SG(S.len(M.snoc(q, id)), S.len(M.remove(id, a)), S.len(k), S.len(t), S.len(d)), SG(1n+S.len(q), S.len(M.remove(id, a)), S.len(k), S.len(t), S.len(d)), 1n+SG(S.len(q), S.len(M.remove(id, a)), S.len(k), S.len(t), S.len(d)), cgq(S.len(M.snoc(q, id)), 1n+S.len(q), S.len(M.remove(id, a)), S.len(k), S.len(t), S.len(d), len_snoc(q, id)), bq(S.len(q), S.len(M.remove(id, a)), S.len(k), S.len(t), S.len(d))), tr(1n+SG(S.len(q), S.len(M.remove(id, a)), S.len(k), S.len(t), S.len(d)), SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), n, sy(SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), 1n+SG(S.len(q), S.len(M.remove(id, a)), S.len(k), S.len(t), S.len(d)), tr(SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), SG(S.len(q), 1n+S.len(M.remove(id, a)), S.len(k), S.len(t), S.len(d)), 1n+SG(S.len(q), S.len(M.remove(id, a)), S.len(k), S.len(t), S.len(d)), cga(S.len(q), S.len(a), 1n+S.len(M.remove(id, a)), S.len(k), S.len(t), S.len(d), len_rm(id, a, hm, hn)), ba(S.len(q), S.len(M.remove(id, a)), S.len(k), S.len(t), S.len(d)))), eq_elim(SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), n, hs))))

def sm_dt(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +id: Nat, +hm: T(M.mem(id, k)), +hn: ND(k), +hs: T(SUMB(q, a, k, t, d, n))) -> T(SUMB(M.snoc(q, id), a, M.remove(id, k), t, d, n)):
  eq_intro(SG(S.len(M.snoc(q, id)), S.len(a), S.len(M.remove(id, k)), S.len(t), S.len(d)), n, tr(SG(S.len(M.snoc(q, id)), S.len(a), S.len(M.remove(id, k)), S.len(t), S.len(d)), 1n+SG(S.len(q), S.len(a), S.len(M.remove(id, k)), S.len(t), S.len(d)), n, tr(SG(S.len(M.snoc(q, id)), S.len(a), S.len(M.remove(id, k)), S.len(t), S.len(d)), SG(1n+S.len(q), S.len(a), S.len(M.remove(id, k)), S.len(t), S.len(d)), 1n+SG(S.len(q), S.len(a), S.len(M.remove(id, k)), S.len(t), S.len(d)), cgq(S.len(M.snoc(q, id)), 1n+S.len(q), S.len(a), S.len(M.remove(id, k)), S.len(t), S.len(d), len_snoc(q, id)), bq(S.len(q), S.len(a), S.len(M.remove(id, k)), S.len(t), S.len(d))), tr(1n+SG(S.len(q), S.len(a), S.len(M.remove(id, k)), S.len(t), S.len(d)), SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), n, sy(SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), 1n+SG(S.len(q), S.len(a), S.len(M.remove(id, k)), S.len(t), S.len(d)), tr(SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), SG(S.len(q), S.len(a), 1n+S.len(M.remove(id, k)), S.len(t), S.len(d)), 1n+SG(S.len(q), S.len(a), S.len(M.remove(id, k)), S.len(t), S.len(d)), cgk(S.len(q), S.len(a), S.len(k), 1n+S.len(M.remove(id, k)), S.len(t), S.len(d), len_rm(id, k, hm, hn)), bk(S.len(q), S.len(a), S.len(M.remove(id, k)), S.len(t), S.len(d)))), eq_elim(SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), n, hs))))

def sm_ri(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +id: Nat, +hm: T(M.mem(id, a)), +hn: ND(a), +hs: T(SUMB(q, a, k, t, d, n))) -> T(SUMB(q, M.remove(id, a), k, t, M.snoc(d, id), n)):
  eq_intro(SG(S.len(q), S.len(M.remove(id, a)), S.len(k), S.len(t), S.len(M.snoc(d, id))), n, tr(SG(S.len(q), S.len(M.remove(id, a)), S.len(k), S.len(t), S.len(M.snoc(d, id))), 1n+SG(S.len(q), S.len(M.remove(id, a)), S.len(k), S.len(t), S.len(d)), n, tr(SG(S.len(q), S.len(M.remove(id, a)), S.len(k), S.len(t), S.len(M.snoc(d, id))), SG(S.len(q), S.len(M.remove(id, a)), S.len(k), S.len(t), 1n+S.len(d)), 1n+SG(S.len(q), S.len(M.remove(id, a)), S.len(k), S.len(t), S.len(d)), cgd(S.len(q), S.len(M.remove(id, a)), S.len(k), S.len(t), S.len(M.snoc(d, id)), 1n+S.len(d), len_snoc(d, id)), bdd(S.len(q), S.len(M.remove(id, a)), S.len(k), S.len(t), S.len(d))), tr(1n+SG(S.len(q), S.len(M.remove(id, a)), S.len(k), S.len(t), S.len(d)), SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), n, sy(SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), 1n+SG(S.len(q), S.len(M.remove(id, a)), S.len(k), S.len(t), S.len(d)), tr(SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), SG(S.len(q), 1n+S.len(M.remove(id, a)), S.len(k), S.len(t), S.len(d)), 1n+SG(S.len(q), S.len(M.remove(id, a)), S.len(k), S.len(t), S.len(d)), cga(S.len(q), S.len(a), 1n+S.len(M.remove(id, a)), S.len(k), S.len(t), S.len(d), len_rm(id, a, hm, hn)), ba(S.len(q), S.len(M.remove(id, a)), S.len(k), S.len(t), S.len(d)))), eq_elim(SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), n, hs))))

def sm_rt(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +id: Nat, +hm: T(M.mem(id, k)), +hn: ND(k), +hs: T(SUMB(q, a, k, t, d, n))) -> T(SUMB(q, a, M.remove(id, k), t, M.snoc(d, id), n)):
  eq_intro(SG(S.len(q), S.len(a), S.len(M.remove(id, k)), S.len(t), S.len(M.snoc(d, id))), n, tr(SG(S.len(q), S.len(a), S.len(M.remove(id, k)), S.len(t), S.len(M.snoc(d, id))), 1n+SG(S.len(q), S.len(a), S.len(M.remove(id, k)), S.len(t), S.len(d)), n, tr(SG(S.len(q), S.len(a), S.len(M.remove(id, k)), S.len(t), S.len(M.snoc(d, id))), SG(S.len(q), S.len(a), S.len(M.remove(id, k)), S.len(t), 1n+S.len(d)), 1n+SG(S.len(q), S.len(a), S.len(M.remove(id, k)), S.len(t), S.len(d)), cgd(S.len(q), S.len(a), S.len(M.remove(id, k)), S.len(t), S.len(M.snoc(d, id)), 1n+S.len(d), len_snoc(d, id)), bdd(S.len(q), S.len(a), S.len(M.remove(id, k)), S.len(t), S.len(d))), tr(1n+SG(S.len(q), S.len(a), S.len(M.remove(id, k)), S.len(t), S.len(d)), SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), n, sy(SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), 1n+SG(S.len(q), S.len(a), S.len(M.remove(id, k)), S.len(t), S.len(d)), tr(SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), SG(S.len(q), S.len(a), 1n+S.len(M.remove(id, k)), S.len(t), S.len(d)), 1n+SG(S.len(q), S.len(a), S.len(M.remove(id, k)), S.len(t), S.len(d)), cgk(S.len(q), S.len(a), S.len(k), 1n+S.len(M.remove(id, k)), S.len(t), S.len(d), len_rm(id, k, hm, hn)), bk(S.len(q), S.len(a), S.len(M.remove(id, k)), S.len(t), S.len(d)))), eq_elim(SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), n, hs))))

def IV20(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat) -> Bool:
  SUMB(q, a, k, t, d, n)

def IV19(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat) -> Bool:
  Bool.and(bd(d, n), IV20(q, a, k, t, d, n))

def IV18(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat) -> Bool:
  Bool.and(bd(t, n), IV19(q, a, k, t, d, n))

def IV17(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat) -> Bool:
  Bool.and(bd(k, n), IV18(q, a, k, t, d, n))

def IV16(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat) -> Bool:
  Bool.and(bd(a, n), IV17(q, a, k, t, d, n))

def IV15(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat) -> Bool:
  Bool.and(bd(q, n), IV16(q, a, k, t, d, n))

def IV14(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat) -> Bool:
  Bool.and(S.disjoint(t, d), IV15(q, a, k, t, d, n))

def IV13(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat) -> Bool:
  Bool.and(S.disjoint(k, d), IV14(q, a, k, t, d, n))

def IV12(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat) -> Bool:
  Bool.and(S.disjoint(k, t), IV13(q, a, k, t, d, n))

def IV11(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat) -> Bool:
  Bool.and(S.disjoint(a, d), IV12(q, a, k, t, d, n))

def IV10(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat) -> Bool:
  Bool.and(S.disjoint(a, t), IV11(q, a, k, t, d, n))

def IV9(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat) -> Bool:
  Bool.and(S.disjoint(a, k), IV10(q, a, k, t, d, n))

def IV8(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat) -> Bool:
  Bool.and(S.disjoint(q, d), IV9(q, a, k, t, d, n))

def IV7(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat) -> Bool:
  Bool.and(S.disjoint(q, t), IV8(q, a, k, t, d, n))

def IV6(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat) -> Bool:
  Bool.and(S.disjoint(q, k), IV7(q, a, k, t, d, n))

def IV5(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat) -> Bool:
  Bool.and(S.disjoint(q, a), IV6(q, a, k, t, d, n))

def IV4(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat) -> Bool:
  Bool.and(S.nodup(d), IV5(q, a, k, t, d, n))

def IV3(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat) -> Bool:
  Bool.and(S.nodup(t), IV4(q, a, k, t, d, n))

def IV2(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat) -> Bool:
  Bool.and(S.nodup(k), IV3(q, a, k, t, d, n))

def IV1(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat) -> Bool:
  Bool.and(S.nodup(a), IV2(q, a, k, t, d, n))

def IV0(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat) -> Bool:
  Bool.and(S.nodup(q), IV1(q, a, k, t, d, n))

def IV(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat) -> Bool:
  IV0(q, a, k, t, d, n)

def r0(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: T(IV0(q, a, k, t, d, n))) -> T(IV1(q, a, k, t, d, n)):
  and_r(S.nodup(q), IV1(q, a, k, t, d, n), h)

def l0(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: T(IV0(q, a, k, t, d, n))) -> T(S.nodup(q)):
  and_l(S.nodup(q), IV1(q, a, k, t, d, n), h)

def m0(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +x: T(S.nodup(q)), +rest: T(IV1(q, a, k, t, d, n))) -> T(IV0(q, a, k, t, d, n)):
  and_i(S.nodup(q), IV1(q, a, k, t, d, n), x, rest)

def r1(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: T(IV1(q, a, k, t, d, n))) -> T(IV2(q, a, k, t, d, n)):
  and_r(S.nodup(a), IV2(q, a, k, t, d, n), h)

def l1(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: T(IV1(q, a, k, t, d, n))) -> T(S.nodup(a)):
  and_l(S.nodup(a), IV2(q, a, k, t, d, n), h)

def m1(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +x: T(S.nodup(a)), +rest: T(IV2(q, a, k, t, d, n))) -> T(IV1(q, a, k, t, d, n)):
  and_i(S.nodup(a), IV2(q, a, k, t, d, n), x, rest)

def r2(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: T(IV2(q, a, k, t, d, n))) -> T(IV3(q, a, k, t, d, n)):
  and_r(S.nodup(k), IV3(q, a, k, t, d, n), h)

def l2(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: T(IV2(q, a, k, t, d, n))) -> T(S.nodup(k)):
  and_l(S.nodup(k), IV3(q, a, k, t, d, n), h)

def m2(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +x: T(S.nodup(k)), +rest: T(IV3(q, a, k, t, d, n))) -> T(IV2(q, a, k, t, d, n)):
  and_i(S.nodup(k), IV3(q, a, k, t, d, n), x, rest)

def r3(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: T(IV3(q, a, k, t, d, n))) -> T(IV4(q, a, k, t, d, n)):
  and_r(S.nodup(t), IV4(q, a, k, t, d, n), h)

def l3(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: T(IV3(q, a, k, t, d, n))) -> T(S.nodup(t)):
  and_l(S.nodup(t), IV4(q, a, k, t, d, n), h)

def m3(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +x: T(S.nodup(t)), +rest: T(IV4(q, a, k, t, d, n))) -> T(IV3(q, a, k, t, d, n)):
  and_i(S.nodup(t), IV4(q, a, k, t, d, n), x, rest)

def r4(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: T(IV4(q, a, k, t, d, n))) -> T(IV5(q, a, k, t, d, n)):
  and_r(S.nodup(d), IV5(q, a, k, t, d, n), h)

def l4(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: T(IV4(q, a, k, t, d, n))) -> T(S.nodup(d)):
  and_l(S.nodup(d), IV5(q, a, k, t, d, n), h)

def m4(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +x: T(S.nodup(d)), +rest: T(IV5(q, a, k, t, d, n))) -> T(IV4(q, a, k, t, d, n)):
  and_i(S.nodup(d), IV5(q, a, k, t, d, n), x, rest)

def r5(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: T(IV5(q, a, k, t, d, n))) -> T(IV6(q, a, k, t, d, n)):
  and_r(S.disjoint(q, a), IV6(q, a, k, t, d, n), h)

def l5(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: T(IV5(q, a, k, t, d, n))) -> T(S.disjoint(q, a)):
  and_l(S.disjoint(q, a), IV6(q, a, k, t, d, n), h)

def m5(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +x: T(S.disjoint(q, a)), +rest: T(IV6(q, a, k, t, d, n))) -> T(IV5(q, a, k, t, d, n)):
  and_i(S.disjoint(q, a), IV6(q, a, k, t, d, n), x, rest)

def r6(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: T(IV6(q, a, k, t, d, n))) -> T(IV7(q, a, k, t, d, n)):
  and_r(S.disjoint(q, k), IV7(q, a, k, t, d, n), h)

def l6(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: T(IV6(q, a, k, t, d, n))) -> T(S.disjoint(q, k)):
  and_l(S.disjoint(q, k), IV7(q, a, k, t, d, n), h)

def m6(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +x: T(S.disjoint(q, k)), +rest: T(IV7(q, a, k, t, d, n))) -> T(IV6(q, a, k, t, d, n)):
  and_i(S.disjoint(q, k), IV7(q, a, k, t, d, n), x, rest)

def r7(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: T(IV7(q, a, k, t, d, n))) -> T(IV8(q, a, k, t, d, n)):
  and_r(S.disjoint(q, t), IV8(q, a, k, t, d, n), h)

def l7(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: T(IV7(q, a, k, t, d, n))) -> T(S.disjoint(q, t)):
  and_l(S.disjoint(q, t), IV8(q, a, k, t, d, n), h)

def m7(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +x: T(S.disjoint(q, t)), +rest: T(IV8(q, a, k, t, d, n))) -> T(IV7(q, a, k, t, d, n)):
  and_i(S.disjoint(q, t), IV8(q, a, k, t, d, n), x, rest)

def r8(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: T(IV8(q, a, k, t, d, n))) -> T(IV9(q, a, k, t, d, n)):
  and_r(S.disjoint(q, d), IV9(q, a, k, t, d, n), h)

def l8(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: T(IV8(q, a, k, t, d, n))) -> T(S.disjoint(q, d)):
  and_l(S.disjoint(q, d), IV9(q, a, k, t, d, n), h)

def m8(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +x: T(S.disjoint(q, d)), +rest: T(IV9(q, a, k, t, d, n))) -> T(IV8(q, a, k, t, d, n)):
  and_i(S.disjoint(q, d), IV9(q, a, k, t, d, n), x, rest)

def r9(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: T(IV9(q, a, k, t, d, n))) -> T(IV10(q, a, k, t, d, n)):
  and_r(S.disjoint(a, k), IV10(q, a, k, t, d, n), h)

def l9(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: T(IV9(q, a, k, t, d, n))) -> T(S.disjoint(a, k)):
  and_l(S.disjoint(a, k), IV10(q, a, k, t, d, n), h)

def m9(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +x: T(S.disjoint(a, k)), +rest: T(IV10(q, a, k, t, d, n))) -> T(IV9(q, a, k, t, d, n)):
  and_i(S.disjoint(a, k), IV10(q, a, k, t, d, n), x, rest)

def r10(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: T(IV10(q, a, k, t, d, n))) -> T(IV11(q, a, k, t, d, n)):
  and_r(S.disjoint(a, t), IV11(q, a, k, t, d, n), h)

def l10(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: T(IV10(q, a, k, t, d, n))) -> T(S.disjoint(a, t)):
  and_l(S.disjoint(a, t), IV11(q, a, k, t, d, n), h)

def m10(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +x: T(S.disjoint(a, t)), +rest: T(IV11(q, a, k, t, d, n))) -> T(IV10(q, a, k, t, d, n)):
  and_i(S.disjoint(a, t), IV11(q, a, k, t, d, n), x, rest)

def r11(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: T(IV11(q, a, k, t, d, n))) -> T(IV12(q, a, k, t, d, n)):
  and_r(S.disjoint(a, d), IV12(q, a, k, t, d, n), h)

def l11(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: T(IV11(q, a, k, t, d, n))) -> T(S.disjoint(a, d)):
  and_l(S.disjoint(a, d), IV12(q, a, k, t, d, n), h)

def m11(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +x: T(S.disjoint(a, d)), +rest: T(IV12(q, a, k, t, d, n))) -> T(IV11(q, a, k, t, d, n)):
  and_i(S.disjoint(a, d), IV12(q, a, k, t, d, n), x, rest)

def r12(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: T(IV12(q, a, k, t, d, n))) -> T(IV13(q, a, k, t, d, n)):
  and_r(S.disjoint(k, t), IV13(q, a, k, t, d, n), h)

def l12(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: T(IV12(q, a, k, t, d, n))) -> T(S.disjoint(k, t)):
  and_l(S.disjoint(k, t), IV13(q, a, k, t, d, n), h)

def m12(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +x: T(S.disjoint(k, t)), +rest: T(IV13(q, a, k, t, d, n))) -> T(IV12(q, a, k, t, d, n)):
  and_i(S.disjoint(k, t), IV13(q, a, k, t, d, n), x, rest)

def r13(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: T(IV13(q, a, k, t, d, n))) -> T(IV14(q, a, k, t, d, n)):
  and_r(S.disjoint(k, d), IV14(q, a, k, t, d, n), h)

def l13(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: T(IV13(q, a, k, t, d, n))) -> T(S.disjoint(k, d)):
  and_l(S.disjoint(k, d), IV14(q, a, k, t, d, n), h)

def m13(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +x: T(S.disjoint(k, d)), +rest: T(IV14(q, a, k, t, d, n))) -> T(IV13(q, a, k, t, d, n)):
  and_i(S.disjoint(k, d), IV14(q, a, k, t, d, n), x, rest)

def r14(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: T(IV14(q, a, k, t, d, n))) -> T(IV15(q, a, k, t, d, n)):
  and_r(S.disjoint(t, d), IV15(q, a, k, t, d, n), h)

def l14(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: T(IV14(q, a, k, t, d, n))) -> T(S.disjoint(t, d)):
  and_l(S.disjoint(t, d), IV15(q, a, k, t, d, n), h)

def m14(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +x: T(S.disjoint(t, d)), +rest: T(IV15(q, a, k, t, d, n))) -> T(IV14(q, a, k, t, d, n)):
  and_i(S.disjoint(t, d), IV15(q, a, k, t, d, n), x, rest)

def r15(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: T(IV15(q, a, k, t, d, n))) -> T(IV16(q, a, k, t, d, n)):
  and_r(bd(q, n), IV16(q, a, k, t, d, n), h)

def l15(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: T(IV15(q, a, k, t, d, n))) -> T(bd(q, n)):
  and_l(bd(q, n), IV16(q, a, k, t, d, n), h)

def m15(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +x: T(bd(q, n)), +rest: T(IV16(q, a, k, t, d, n))) -> T(IV15(q, a, k, t, d, n)):
  and_i(bd(q, n), IV16(q, a, k, t, d, n), x, rest)

def r16(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: T(IV16(q, a, k, t, d, n))) -> T(IV17(q, a, k, t, d, n)):
  and_r(bd(a, n), IV17(q, a, k, t, d, n), h)

def l16(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: T(IV16(q, a, k, t, d, n))) -> T(bd(a, n)):
  and_l(bd(a, n), IV17(q, a, k, t, d, n), h)

def m16(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +x: T(bd(a, n)), +rest: T(IV17(q, a, k, t, d, n))) -> T(IV16(q, a, k, t, d, n)):
  and_i(bd(a, n), IV17(q, a, k, t, d, n), x, rest)

def r17(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: T(IV17(q, a, k, t, d, n))) -> T(IV18(q, a, k, t, d, n)):
  and_r(bd(k, n), IV18(q, a, k, t, d, n), h)

def l17(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: T(IV17(q, a, k, t, d, n))) -> T(bd(k, n)):
  and_l(bd(k, n), IV18(q, a, k, t, d, n), h)

def m17(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +x: T(bd(k, n)), +rest: T(IV18(q, a, k, t, d, n))) -> T(IV17(q, a, k, t, d, n)):
  and_i(bd(k, n), IV18(q, a, k, t, d, n), x, rest)

def r18(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: T(IV18(q, a, k, t, d, n))) -> T(IV19(q, a, k, t, d, n)):
  and_r(bd(t, n), IV19(q, a, k, t, d, n), h)

def l18(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: T(IV18(q, a, k, t, d, n))) -> T(bd(t, n)):
  and_l(bd(t, n), IV19(q, a, k, t, d, n), h)

def m18(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +x: T(bd(t, n)), +rest: T(IV19(q, a, k, t, d, n))) -> T(IV18(q, a, k, t, d, n)):
  and_i(bd(t, n), IV19(q, a, k, t, d, n), x, rest)

def r19(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: T(IV19(q, a, k, t, d, n))) -> T(IV20(q, a, k, t, d, n)):
  and_r(bd(d, n), IV20(q, a, k, t, d, n), h)

def l19(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: T(IV19(q, a, k, t, d, n))) -> T(bd(d, n)):
  and_l(bd(d, n), IV20(q, a, k, t, d, n), h)

def m19(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +x: T(bd(d, n)), +rest: T(IV20(q, a, k, t, d, n))) -> T(IV19(q, a, k, t, d, n)):
  and_i(bd(d, n), IV20(q, a, k, t, d, n), x, rest)

def p0(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: T(IV(q, a, k, t, d, n))) -> T(S.nodup(q)):
  l0(q, a, k, t, d, n, h)

def p1(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: T(IV(q, a, k, t, d, n))) -> T(S.nodup(a)):
  l1(q, a, k, t, d, n, r0(q, a, k, t, d, n, h))

def p2(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: T(IV(q, a, k, t, d, n))) -> T(S.nodup(k)):
  l2(q, a, k, t, d, n, r1(q, a, k, t, d, n, r0(q, a, k, t, d, n, h)))

def p3(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: T(IV(q, a, k, t, d, n))) -> T(S.nodup(t)):
  l3(q, a, k, t, d, n, r2(q, a, k, t, d, n, r1(q, a, k, t, d, n, r0(q, a, k, t, d, n, h))))

def p4(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: T(IV(q, a, k, t, d, n))) -> T(S.nodup(d)):
  l4(q, a, k, t, d, n, r3(q, a, k, t, d, n, r2(q, a, k, t, d, n, r1(q, a, k, t, d, n, r0(q, a, k, t, d, n, h)))))

def p5(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: T(IV(q, a, k, t, d, n))) -> T(S.disjoint(q, a)):
  l5(q, a, k, t, d, n, r4(q, a, k, t, d, n, r3(q, a, k, t, d, n, r2(q, a, k, t, d, n, r1(q, a, k, t, d, n, r0(q, a, k, t, d, n, h))))))

def p6(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: T(IV(q, a, k, t, d, n))) -> T(S.disjoint(q, k)):
  l6(q, a, k, t, d, n, r5(q, a, k, t, d, n, r4(q, a, k, t, d, n, r3(q, a, k, t, d, n, r2(q, a, k, t, d, n, r1(q, a, k, t, d, n, r0(q, a, k, t, d, n, h)))))))

def p7(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: T(IV(q, a, k, t, d, n))) -> T(S.disjoint(q, t)):
  l7(q, a, k, t, d, n, r6(q, a, k, t, d, n, r5(q, a, k, t, d, n, r4(q, a, k, t, d, n, r3(q, a, k, t, d, n, r2(q, a, k, t, d, n, r1(q, a, k, t, d, n, r0(q, a, k, t, d, n, h))))))))

def p8(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: T(IV(q, a, k, t, d, n))) -> T(S.disjoint(q, d)):
  l8(q, a, k, t, d, n, r7(q, a, k, t, d, n, r6(q, a, k, t, d, n, r5(q, a, k, t, d, n, r4(q, a, k, t, d, n, r3(q, a, k, t, d, n, r2(q, a, k, t, d, n, r1(q, a, k, t, d, n, r0(q, a, k, t, d, n, h)))))))))

def p9(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: T(IV(q, a, k, t, d, n))) -> T(S.disjoint(a, k)):
  l9(q, a, k, t, d, n, r8(q, a, k, t, d, n, r7(q, a, k, t, d, n, r6(q, a, k, t, d, n, r5(q, a, k, t, d, n, r4(q, a, k, t, d, n, r3(q, a, k, t, d, n, r2(q, a, k, t, d, n, r1(q, a, k, t, d, n, r0(q, a, k, t, d, n, h))))))))))

def p10(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: T(IV(q, a, k, t, d, n))) -> T(S.disjoint(a, t)):
  l10(q, a, k, t, d, n, r9(q, a, k, t, d, n, r8(q, a, k, t, d, n, r7(q, a, k, t, d, n, r6(q, a, k, t, d, n, r5(q, a, k, t, d, n, r4(q, a, k, t, d, n, r3(q, a, k, t, d, n, r2(q, a, k, t, d, n, r1(q, a, k, t, d, n, r0(q, a, k, t, d, n, h)))))))))))

def p11(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: T(IV(q, a, k, t, d, n))) -> T(S.disjoint(a, d)):
  l11(q, a, k, t, d, n, r10(q, a, k, t, d, n, r9(q, a, k, t, d, n, r8(q, a, k, t, d, n, r7(q, a, k, t, d, n, r6(q, a, k, t, d, n, r5(q, a, k, t, d, n, r4(q, a, k, t, d, n, r3(q, a, k, t, d, n, r2(q, a, k, t, d, n, r1(q, a, k, t, d, n, r0(q, a, k, t, d, n, h))))))))))))

def p12(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: T(IV(q, a, k, t, d, n))) -> T(S.disjoint(k, t)):
  l12(q, a, k, t, d, n, r11(q, a, k, t, d, n, r10(q, a, k, t, d, n, r9(q, a, k, t, d, n, r8(q, a, k, t, d, n, r7(q, a, k, t, d, n, r6(q, a, k, t, d, n, r5(q, a, k, t, d, n, r4(q, a, k, t, d, n, r3(q, a, k, t, d, n, r2(q, a, k, t, d, n, r1(q, a, k, t, d, n, r0(q, a, k, t, d, n, h)))))))))))))

def p13(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: T(IV(q, a, k, t, d, n))) -> T(S.disjoint(k, d)):
  l13(q, a, k, t, d, n, r12(q, a, k, t, d, n, r11(q, a, k, t, d, n, r10(q, a, k, t, d, n, r9(q, a, k, t, d, n, r8(q, a, k, t, d, n, r7(q, a, k, t, d, n, r6(q, a, k, t, d, n, r5(q, a, k, t, d, n, r4(q, a, k, t, d, n, r3(q, a, k, t, d, n, r2(q, a, k, t, d, n, r1(q, a, k, t, d, n, r0(q, a, k, t, d, n, h))))))))))))))

def p14(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: T(IV(q, a, k, t, d, n))) -> T(S.disjoint(t, d)):
  l14(q, a, k, t, d, n, r13(q, a, k, t, d, n, r12(q, a, k, t, d, n, r11(q, a, k, t, d, n, r10(q, a, k, t, d, n, r9(q, a, k, t, d, n, r8(q, a, k, t, d, n, r7(q, a, k, t, d, n, r6(q, a, k, t, d, n, r5(q, a, k, t, d, n, r4(q, a, k, t, d, n, r3(q, a, k, t, d, n, r2(q, a, k, t, d, n, r1(q, a, k, t, d, n, r0(q, a, k, t, d, n, h)))))))))))))))

def p15(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: T(IV(q, a, k, t, d, n))) -> T(bd(q, n)):
  l15(q, a, k, t, d, n, r14(q, a, k, t, d, n, r13(q, a, k, t, d, n, r12(q, a, k, t, d, n, r11(q, a, k, t, d, n, r10(q, a, k, t, d, n, r9(q, a, k, t, d, n, r8(q, a, k, t, d, n, r7(q, a, k, t, d, n, r6(q, a, k, t, d, n, r5(q, a, k, t, d, n, r4(q, a, k, t, d, n, r3(q, a, k, t, d, n, r2(q, a, k, t, d, n, r1(q, a, k, t, d, n, r0(q, a, k, t, d, n, h))))))))))))))))

def p16(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: T(IV(q, a, k, t, d, n))) -> T(bd(a, n)):
  l16(q, a, k, t, d, n, r15(q, a, k, t, d, n, r14(q, a, k, t, d, n, r13(q, a, k, t, d, n, r12(q, a, k, t, d, n, r11(q, a, k, t, d, n, r10(q, a, k, t, d, n, r9(q, a, k, t, d, n, r8(q, a, k, t, d, n, r7(q, a, k, t, d, n, r6(q, a, k, t, d, n, r5(q, a, k, t, d, n, r4(q, a, k, t, d, n, r3(q, a, k, t, d, n, r2(q, a, k, t, d, n, r1(q, a, k, t, d, n, r0(q, a, k, t, d, n, h)))))))))))))))))

def p17(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: T(IV(q, a, k, t, d, n))) -> T(bd(k, n)):
  l17(q, a, k, t, d, n, r16(q, a, k, t, d, n, r15(q, a, k, t, d, n, r14(q, a, k, t, d, n, r13(q, a, k, t, d, n, r12(q, a, k, t, d, n, r11(q, a, k, t, d, n, r10(q, a, k, t, d, n, r9(q, a, k, t, d, n, r8(q, a, k, t, d, n, r7(q, a, k, t, d, n, r6(q, a, k, t, d, n, r5(q, a, k, t, d, n, r4(q, a, k, t, d, n, r3(q, a, k, t, d, n, r2(q, a, k, t, d, n, r1(q, a, k, t, d, n, r0(q, a, k, t, d, n, h))))))))))))))))))

def p18(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: T(IV(q, a, k, t, d, n))) -> T(bd(t, n)):
  l18(q, a, k, t, d, n, r17(q, a, k, t, d, n, r16(q, a, k, t, d, n, r15(q, a, k, t, d, n, r14(q, a, k, t, d, n, r13(q, a, k, t, d, n, r12(q, a, k, t, d, n, r11(q, a, k, t, d, n, r10(q, a, k, t, d, n, r9(q, a, k, t, d, n, r8(q, a, k, t, d, n, r7(q, a, k, t, d, n, r6(q, a, k, t, d, n, r5(q, a, k, t, d, n, r4(q, a, k, t, d, n, r3(q, a, k, t, d, n, r2(q, a, k, t, d, n, r1(q, a, k, t, d, n, r0(q, a, k, t, d, n, h)))))))))))))))))))

def p19(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: T(IV(q, a, k, t, d, n))) -> T(bd(d, n)):
  l19(q, a, k, t, d, n, r18(q, a, k, t, d, n, r17(q, a, k, t, d, n, r16(q, a, k, t, d, n, r15(q, a, k, t, d, n, r14(q, a, k, t, d, n, r13(q, a, k, t, d, n, r12(q, a, k, t, d, n, r11(q, a, k, t, d, n, r10(q, a, k, t, d, n, r9(q, a, k, t, d, n, r8(q, a, k, t, d, n, r7(q, a, k, t, d, n, r6(q, a, k, t, d, n, r5(q, a, k, t, d, n, r4(q, a, k, t, d, n, r3(q, a, k, t, d, n, r2(q, a, k, t, d, n, r1(q, a, k, t, d, n, r0(q, a, k, t, d, n, h))))))))))))))))))))

def p20(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: T(IV(q, a, k, t, d, n))) -> T(SUMB(q, a, k, t, d, n)):
  r19(q, a, k, t, d, n, r18(q, a, k, t, d, n, r17(q, a, k, t, d, n, r16(q, a, k, t, d, n, r15(q, a, k, t, d, n, r14(q, a, k, t, d, n, r13(q, a, k, t, d, n, r12(q, a, k, t, d, n, r11(q, a, k, t, d, n, r10(q, a, k, t, d, n, r9(q, a, k, t, d, n, r8(q, a, k, t, d, n, r7(q, a, k, t, d, n, r6(q, a, k, t, d, n, r5(q, a, k, t, d, n, r4(q, a, k, t, d, n, r3(q, a, k, t, d, n, r2(q, a, k, t, d, n, r1(q, a, k, t, d, n, r0(q, a, k, t, d, n, h))))))))))))))))))))

def mk(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +x0: T(S.nodup(q)), +x1: T(S.nodup(a)), +x2: T(S.nodup(k)), +x3: T(S.nodup(t)), +x4: T(S.nodup(d)), +x5: T(S.disjoint(q, a)), +x6: T(S.disjoint(q, k)), +x7: T(S.disjoint(q, t)), +x8: T(S.disjoint(q, d)), +x9: T(S.disjoint(a, k)), +x10: T(S.disjoint(a, t)), +x11: T(S.disjoint(a, d)), +x12: T(S.disjoint(k, t)), +x13: T(S.disjoint(k, d)), +x14: T(S.disjoint(t, d)), +x15: T(bd(q, n)), +x16: T(bd(a, n)), +x17: T(bd(k, n)), +x18: T(bd(t, n)), +x19: T(bd(d, n)), +x20: T(SUMB(q, a, k, t, d, n))) -> T(IV(q, a, k, t, d, n)):
  m0(q, a, k, t, d, n, x0, m1(q, a, k, t, d, n, x1, m2(q, a, k, t, d, n, x2, m3(q, a, k, t, d, n, x3, m4(q, a, k, t, d, n, x4, m5(q, a, k, t, d, n, x5, m6(q, a, k, t, d, n, x6, m7(q, a, k, t, d, n, x7, m8(q, a, k, t, d, n, x8, m9(q, a, k, t, d, n, x9, m10(q, a, k, t, d, n, x10, m11(q, a, k, t, d, n, x11, m12(q, a, k, t, d, n, x12, m13(q, a, k, t, d, n, x13, m14(q, a, k, t, d, n, x14, m15(q, a, k, t, d, n, x15, m16(q, a, k, t, d, n, x16, m17(q, a, k, t, d, n, x17, m18(q, a, k, t, d, n, x18, m19(q, a, k, t, d, n, x19, x20))))))))))))))))))))

def inv_sendQ(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: T(IV(q, a, k, t, d, n))) -> T(IV(M.snoc(q, n), a, k, t, d, 1n+n)):
  mk(M.snoc(q, n), a, k, t, d, 1n+n, nd_snoc(q, n, p0(q, a, k, t, d, n, h), bd_fresh(q, n, p15(q, a, k, t, d, n, h))), p1(q, a, k, t, d, n, h), p2(q, a, k, t, d, n, h), p3(q, a, k, t, d, n, h), p4(q, a, k, t, d, n, h), dj_snoc_l(q, a, n, p5(q, a, k, t, d, n, h), bd_fresh(a, n, p16(q, a, k, t, d, n, h))), dj_snoc_l(q, k, n, p6(q, a, k, t, d, n, h), bd_fresh(k, n, p17(q, a, k, t, d, n, h))), dj_snoc_l(q, t, n, p7(q, a, k, t, d, n, h), bd_fresh(t, n, p18(q, a, k, t, d, n, h))), dj_snoc_l(q, d, n, p8(q, a, k, t, d, n, h), bd_fresh(d, n, p19(q, a, k, t, d, n, h))), p9(q, a, k, t, d, n, h), p10(q, a, k, t, d, n, h), p11(q, a, k, t, d, n, h), p12(q, a, k, t, d, n, h), p13(q, a, k, t, d, n, h), p14(q, a, k, t, d, n, h), bd_snoc_new(q, n, p15(q, a, k, t, d, n, h)), bd_succ(a, n, p16(q, a, k, t, d, n, h)), bd_succ(k, n, p17(q, a, k, t, d, n, h)), bd_succ(t, n, p18(q, a, k, t, d, n, h)), bd_succ(d, n, p19(q, a, k, t, d, n, h)), sm_sendQ(q, a, k, t, d, n, p20(q, a, k, t, d, n, h)))

def inv_sendA(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: T(IV(q, a, k, t, d, n))) -> T(IV(q, M.snoc(a, n), k, t, d, 1n+n)):
  mk(q, M.snoc(a, n), k, t, d, 1n+n, p0(q, a, k, t, d, n, h), nd_snoc(a, n, p1(q, a, k, t, d, n, h), bd_fresh(a, n, p16(q, a, k, t, d, n, h))), p2(q, a, k, t, d, n, h), p3(q, a, k, t, d, n, h), p4(q, a, k, t, d, n, h), dj_snoc_r(q, a, n, p5(q, a, k, t, d, n, h), bd_fresh(q, n, p15(q, a, k, t, d, n, h))), p6(q, a, k, t, d, n, h), p7(q, a, k, t, d, n, h), p8(q, a, k, t, d, n, h), dj_snoc_l(a, k, n, p9(q, a, k, t, d, n, h), bd_fresh(k, n, p17(q, a, k, t, d, n, h))), dj_snoc_l(a, t, n, p10(q, a, k, t, d, n, h), bd_fresh(t, n, p18(q, a, k, t, d, n, h))), dj_snoc_l(a, d, n, p11(q, a, k, t, d, n, h), bd_fresh(d, n, p19(q, a, k, t, d, n, h))), p12(q, a, k, t, d, n, h), p13(q, a, k, t, d, n, h), p14(q, a, k, t, d, n, h), bd_succ(q, n, p15(q, a, k, t, d, n, h)), bd_snoc_new(a, n, p16(q, a, k, t, d, n, h)), bd_succ(k, n, p17(q, a, k, t, d, n, h)), bd_succ(t, n, p18(q, a, k, t, d, n, h)), bd_succ(d, n, p19(q, a, k, t, d, n, h)), sm_sendA(q, a, k, t, d, n, p20(q, a, k, t, d, n, h)))

def inv_sendK(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: T(IV(q, a, k, t, d, n))) -> T(IV(q, a, M.snoc(k, n), t, d, 1n+n)):
  mk(q, a, M.snoc(k, n), t, d, 1n+n, p0(q, a, k, t, d, n, h), p1(q, a, k, t, d, n, h), nd_snoc(k, n, p2(q, a, k, t, d, n, h), bd_fresh(k, n, p17(q, a, k, t, d, n, h))), p3(q, a, k, t, d, n, h), p4(q, a, k, t, d, n, h), p5(q, a, k, t, d, n, h), dj_snoc_r(q, k, n, p6(q, a, k, t, d, n, h), bd_fresh(q, n, p15(q, a, k, t, d, n, h))), p7(q, a, k, t, d, n, h), p8(q, a, k, t, d, n, h), dj_snoc_r(a, k, n, p9(q, a, k, t, d, n, h), bd_fresh(a, n, p16(q, a, k, t, d, n, h))), p10(q, a, k, t, d, n, h), p11(q, a, k, t, d, n, h), dj_snoc_l(k, t, n, p12(q, a, k, t, d, n, h), bd_fresh(t, n, p18(q, a, k, t, d, n, h))), dj_snoc_l(k, d, n, p13(q, a, k, t, d, n, h), bd_fresh(d, n, p19(q, a, k, t, d, n, h))), p14(q, a, k, t, d, n, h), bd_succ(q, n, p15(q, a, k, t, d, n, h)), bd_succ(a, n, p16(q, a, k, t, d, n, h)), bd_snoc_new(k, n, p17(q, a, k, t, d, n, h)), bd_succ(t, n, p18(q, a, k, t, d, n, h)), bd_succ(d, n, p19(q, a, k, t, d, n, h)), sm_sendK(q, a, k, t, d, n, p20(q, a, k, t, d, n, h)))

def inv_sendD(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: T(IV(q, a, k, t, d, n))) -> T(IV(q, a, k, t, M.snoc(d, n), 1n+n)):
  mk(q, a, k, t, M.snoc(d, n), 1n+n, p0(q, a, k, t, d, n, h), p1(q, a, k, t, d, n, h), p2(q, a, k, t, d, n, h), p3(q, a, k, t, d, n, h), nd_snoc(d, n, p4(q, a, k, t, d, n, h), bd_fresh(d, n, p19(q, a, k, t, d, n, h))), p5(q, a, k, t, d, n, h), p6(q, a, k, t, d, n, h), p7(q, a, k, t, d, n, h), dj_snoc_r(q, d, n, p8(q, a, k, t, d, n, h), bd_fresh(q, n, p15(q, a, k, t, d, n, h))), p9(q, a, k, t, d, n, h), p10(q, a, k, t, d, n, h), dj_snoc_r(a, d, n, p11(q, a, k, t, d, n, h), bd_fresh(a, n, p16(q, a, k, t, d, n, h))), p12(q, a, k, t, d, n, h), dj_snoc_r(k, d, n, p13(q, a, k, t, d, n, h), bd_fresh(k, n, p17(q, a, k, t, d, n, h))), dj_snoc_r(t, d, n, p14(q, a, k, t, d, n, h), bd_fresh(t, n, p18(q, a, k, t, d, n, h))), bd_succ(q, n, p15(q, a, k, t, d, n, h)), bd_succ(a, n, p16(q, a, k, t, d, n, h)), bd_succ(k, n, p17(q, a, k, t, d, n, h)), bd_succ(t, n, p18(q, a, k, t, d, n, h)), bd_snoc_new(d, n, p19(q, a, k, t, d, n, h)), sm_sendD(q, a, k, t, d, n, p20(q, a, k, t, d, n, h)))

def inv_mv(+x: Nat, +r: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: T(IV(x <> r, a, k, t, d, n))) -> T(IV(r, a, k, M.snoc(t, x), d, n)):
  mk(r, a, k, M.snoc(t, x), d, n, nd_tl(x, r, p0(x <> r, a, k, t, d, n, h)), p1(x <> r, a, k, t, d, n, h), p2(x <> r, a, k, t, d, n, h), nd_snoc(t, x, p3(x <> r, a, k, t, d, n, h), dj_hd(x, r, t, p7(x <> r, a, k, t, d, n, h))), p4(x <> r, a, k, t, d, n, h), dj_tl(x, r, a, p5(x <> r, a, k, t, d, n, h)), dj_tl(x, r, k, p6(x <> r, a, k, t, d, n, h)), dj_snoc_r(r, t, x, dj_tl(x, r, t, p7(x <> r, a, k, t, d, n, h)), nd_hd(x, r, p0(x <> r, a, k, t, d, n, h))), dj_tl(x, r, d, p8(x <> r, a, k, t, d, n, h)), p9(x <> r, a, k, t, d, n, h), dj_snoc_r(a, t, x, p10(x <> r, a, k, t, d, n, h), dj_hd(x, r, a, p5(x <> r, a, k, t, d, n, h))), p11(x <> r, a, k, t, d, n, h), dj_snoc_r(k, t, x, p12(x <> r, a, k, t, d, n, h), dj_hd(x, r, k, p6(x <> r, a, k, t, d, n, h))), p13(x <> r, a, k, t, d, n, h), dj_snoc_l(t, d, x, p14(x <> r, a, k, t, d, n, h), dj_hd(x, r, d, p8(x <> r, a, k, t, d, n, h))), bd_tl(x, r, n, p15(x <> r, a, k, t, d, n, h)), p16(x <> r, a, k, t, d, n, h), p17(x <> r, a, k, t, d, n, h), bd_snoc(t, x, n, p18(x <> r, a, k, t, d, n, h), bd_hd(x, r, n, p15(x <> r, a, k, t, d, n, h))), p19(x <> r, a, k, t, d, n, h), sm_mv(x, r, a, k, t, d, n, p20(x <> r, a, k, t, d, n, h)))

def inv_tb(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +u: +List<Nat>, +h: T(IV(q, a, k, t, d, n))) -> T(IV(M.keep_users(q, u), a, List.append(&2, Nat, k, M.drop_users(q, u)), t, d, n)):
  mk(M.keep_users(q, u), a, List.append(&2, Nat, k, M.drop_users(q, u)), t, d, n, nd_keep(q, u, p0(q, a, k, t, d, n, h)), p1(q, a, k, t, d, n, h), nd_app(k, M.drop_users(q, u), p2(q, a, k, t, d, n, h), nd_drop(q, u, p0(q, a, k, t, d, n, h)), dj_sub_r(k, M.drop_users(q, u), q, drop_sub(q, u), dj_sym(q, k, p6(q, a, k, t, d, n, h)))), p3(q, a, k, t, d, n, h), p4(q, a, k, t, d, n, h), dj_sub_l(M.keep_users(q, u), q, a, keep_sub(q, u), p5(q, a, k, t, d, n, h)), dj_app_r(M.keep_users(q, u), k, M.drop_users(q, u), dj_sub_l(M.keep_users(q, u), q, k, keep_sub(q, u), p6(q, a, k, t, d, n, h)), kd_dj(q, u, p0(q, a, k, t, d, n, h))), dj_sub_l(M.keep_users(q, u), q, t, keep_sub(q, u), p7(q, a, k, t, d, n, h)), dj_sub_l(M.keep_users(q, u), q, d, keep_sub(q, u), p8(q, a, k, t, d, n, h)), dj_app_r(a, k, M.drop_users(q, u), p9(q, a, k, t, d, n, h), dj_sub_r(a, M.drop_users(q, u), q, drop_sub(q, u), dj_sym(q, a, p5(q, a, k, t, d, n, h)))), p10(q, a, k, t, d, n, h), p11(q, a, k, t, d, n, h), dj_app_l(k, M.drop_users(q, u), t, p12(q, a, k, t, d, n, h), dj_sub_l(M.drop_users(q, u), q, t, drop_sub(q, u), p7(q, a, k, t, d, n, h))), dj_app_l(k, M.drop_users(q, u), d, p13(q, a, k, t, d, n, h), dj_sub_l(M.drop_users(q, u), q, d, drop_sub(q, u), p8(q, a, k, t, d, n, h))), p14(q, a, k, t, d, n, h), bd_sub(M.keep_users(q, u), q, n, keep_sub(q, u), p15(q, a, k, t, d, n, h)), p16(q, a, k, t, d, n, h), bd_app(k, M.drop_users(q, u), n, p17(q, a, k, t, d, n, h), bd_sub(M.drop_users(q, u), q, n, drop_sub(q, u), p15(q, a, k, t, d, n, h))), p18(q, a, k, t, d, n, h), p19(q, a, k, t, d, n, h), sm_tb(q, a, k, t, d, n, u, p20(q, a, k, t, d, n, h)))

def inv_te(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: T(IV(q, a, k, t, d, n))) -> T(IV(List.append(&2, Nat, q, k), a, [], t, d, n)):
  mk(List.append(&2, Nat, q, k), a, [], t, d, n, nd_app(q, k, p0(q, a, k, t, d, n, h), p2(q, a, k, t, d, n, h), p6(q, a, k, t, d, n, h)), p1(q, a, k, t, d, n, h), {==}, p3(q, a, k, t, d, n, h), p4(q, a, k, t, d, n, h), dj_app_l(q, k, a, p5(q, a, k, t, d, n, h), dj_sym(a, k, p9(q, a, k, t, d, n, h))), dj_nil_r(List.append(&2, Nat, q, k)), dj_app_l(q, k, t, p7(q, a, k, t, d, n, h), p12(q, a, k, t, d, n, h)), dj_app_l(q, k, d, p8(q, a, k, t, d, n, h), p13(q, a, k, t, d, n, h)), dj_nil_r(a), p10(q, a, k, t, d, n, h), p11(q, a, k, t, d, n, h), {==}, {==}, p14(q, a, k, t, d, n, h), bd_app(q, k, n, p15(q, a, k, t, d, n, h), p17(q, a, k, t, d, n, h)), p16(q, a, k, t, d, n, h), {==}, p18(q, a, k, t, d, n, h), p19(q, a, k, t, d, n, h), sm_te(q, a, k, t, d, n, p20(q, a, k, t, d, n, h)))

def inv_ex(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: T(IV(q, a, k, t, d, n))) -> T(IV([], a, [], t, List.append(&2, Nat, d, List.append(&2, Nat, q, k)), n)):
  mk([], a, [], t, List.append(&2, Nat, d, List.append(&2, Nat, q, k)), n, {==}, p1(q, a, k, t, d, n, h), {==}, p3(q, a, k, t, d, n, h), nd_app(d, List.append(&2, Nat, q, k), p4(q, a, k, t, d, n, h), nd_app(q, k, p0(q, a, k, t, d, n, h), p2(q, a, k, t, d, n, h), p6(q, a, k, t, d, n, h)), dj_app_r(d, q, k, dj_sym(q, d, p8(q, a, k, t, d, n, h)), dj_sym(k, d, p13(q, a, k, t, d, n, h)))), {==}, {==}, {==}, {==}, dj_nil_r(a), p10(q, a, k, t, d, n, h), dj_app_r(a, d, List.append(&2, Nat, q, k), p11(q, a, k, t, d, n, h), dj_app_r(a, q, k, dj_sym(q, a, p5(q, a, k, t, d, n, h)), p9(q, a, k, t, d, n, h))), {==}, {==}, dj_app_r(t, d, List.append(&2, Nat, q, k), p14(q, a, k, t, d, n, h), dj_app_r(t, q, k, dj_sym(q, t, p7(q, a, k, t, d, n, h)), dj_sym(k, t, p12(q, a, k, t, d, n, h)))), {==}, p16(q, a, k, t, d, n, h), {==}, p18(q, a, k, t, d, n, h), bd_app(d, List.append(&2, Nat, q, k), n, p19(q, a, k, t, d, n, h), bd_app(q, k, n, p15(q, a, k, t, d, n, h), p17(q, a, k, t, d, n, h))), sm_ex(q, a, k, t, d, n, p20(q, a, k, t, d, n, h)))

def inv_di(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +id: Nat, +hm: T(M.mem(id, a)), +h: T(IV(q, a, k, t, d, n))) -> T(IV(M.snoc(q, id), M.remove(id, a), k, t, d, n)):
  mk(M.snoc(q, id), M.remove(id, a), k, t, d, n, nd_snoc(q, id, p0(q, a, k, t, d, n, h), dj_nm(a, q, id, hm, dj_sym(q, a, p5(q, a, k, t, d, n, h)))), nd_remove(id, a, p1(q, a, k, t, d, n, h)), p2(q, a, k, t, d, n, h), p3(q, a, k, t, d, n, h), p4(q, a, k, t, d, n, h), dj_snoc_l(q, M.remove(id, a), id, dj_sub_r(q, M.remove(id, a), a, rm_sub(id, a), p5(q, a, k, t, d, n, h)), nm_removed(id, a)), dj_snoc_l(q, k, id, p6(q, a, k, t, d, n, h), dj_nm(a, k, id, hm, p9(q, a, k, t, d, n, h))), dj_snoc_l(q, t, id, p7(q, a, k, t, d, n, h), dj_nm(a, t, id, hm, p10(q, a, k, t, d, n, h))), dj_snoc_l(q, d, id, p8(q, a, k, t, d, n, h), dj_nm(a, d, id, hm, p11(q, a, k, t, d, n, h))), dj_sub_l(M.remove(id, a), a, k, rm_sub(id, a), p9(q, a, k, t, d, n, h)), dj_sub_l(M.remove(id, a), a, t, rm_sub(id, a), p10(q, a, k, t, d, n, h)), dj_sub_l(M.remove(id, a), a, d, rm_sub(id, a), p11(q, a, k, t, d, n, h)), p12(q, a, k, t, d, n, h), p13(q, a, k, t, d, n, h), p14(q, a, k, t, d, n, h), bd_snoc(q, id, n, p15(q, a, k, t, d, n, h), bd_mem(a, n, id, hm, p16(q, a, k, t, d, n, h))), bd_sub(M.remove(id, a), a, n, rm_sub(id, a), p16(q, a, k, t, d, n, h)), p17(q, a, k, t, d, n, h), p18(q, a, k, t, d, n, h), p19(q, a, k, t, d, n, h), sm_di(q, a, k, t, d, n, id, hm, p1(q, a, k, t, d, n, h), p20(q, a, k, t, d, n, h)))

def inv_dt(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +id: Nat, +hm: T(M.mem(id, k)), +h: T(IV(q, a, k, t, d, n))) -> T(IV(M.snoc(q, id), a, M.remove(id, k), t, d, n)):
  mk(M.snoc(q, id), a, M.remove(id, k), t, d, n, nd_snoc(q, id, p0(q, a, k, t, d, n, h), dj_nm(k, q, id, hm, dj_sym(q, k, p6(q, a, k, t, d, n, h)))), p1(q, a, k, t, d, n, h), nd_remove(id, k, p2(q, a, k, t, d, n, h)), p3(q, a, k, t, d, n, h), p4(q, a, k, t, d, n, h), dj_snoc_l(q, a, id, p5(q, a, k, t, d, n, h), dj_nm(k, a, id, hm, dj_sym(a, k, p9(q, a, k, t, d, n, h)))), dj_snoc_l(q, M.remove(id, k), id, dj_sub_r(q, M.remove(id, k), k, rm_sub(id, k), p6(q, a, k, t, d, n, h)), nm_removed(id, k)), dj_snoc_l(q, t, id, p7(q, a, k, t, d, n, h), dj_nm(k, t, id, hm, p12(q, a, k, t, d, n, h))), dj_snoc_l(q, d, id, p8(q, a, k, t, d, n, h), dj_nm(k, d, id, hm, p13(q, a, k, t, d, n, h))), dj_sub_r(a, M.remove(id, k), k, rm_sub(id, k), p9(q, a, k, t, d, n, h)), p10(q, a, k, t, d, n, h), p11(q, a, k, t, d, n, h), dj_sub_l(M.remove(id, k), k, t, rm_sub(id, k), p12(q, a, k, t, d, n, h)), dj_sub_l(M.remove(id, k), k, d, rm_sub(id, k), p13(q, a, k, t, d, n, h)), p14(q, a, k, t, d, n, h), bd_snoc(q, id, n, p15(q, a, k, t, d, n, h), bd_mem(k, n, id, hm, p17(q, a, k, t, d, n, h))), p16(q, a, k, t, d, n, h), bd_sub(M.remove(id, k), k, n, rm_sub(id, k), p17(q, a, k, t, d, n, h)), p18(q, a, k, t, d, n, h), p19(q, a, k, t, d, n, h), sm_dt(q, a, k, t, d, n, id, hm, p2(q, a, k, t, d, n, h), p20(q, a, k, t, d, n, h)))

def inv_ri(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +id: Nat, +hm: T(M.mem(id, a)), +h: T(IV(q, a, k, t, d, n))) -> T(IV(q, M.remove(id, a), k, t, M.snoc(d, id), n)):
  mk(q, M.remove(id, a), k, t, M.snoc(d, id), n, p0(q, a, k, t, d, n, h), nd_remove(id, a, p1(q, a, k, t, d, n, h)), p2(q, a, k, t, d, n, h), p3(q, a, k, t, d, n, h), nd_snoc(d, id, p4(q, a, k, t, d, n, h), dj_nm(a, d, id, hm, p11(q, a, k, t, d, n, h))), dj_sub_r(q, M.remove(id, a), a, rm_sub(id, a), p5(q, a, k, t, d, n, h)), p6(q, a, k, t, d, n, h), p7(q, a, k, t, d, n, h), dj_snoc_r(q, d, id, p8(q, a, k, t, d, n, h), dj_nm(a, q, id, hm, dj_sym(q, a, p5(q, a, k, t, d, n, h)))), dj_sub_l(M.remove(id, a), a, k, rm_sub(id, a), p9(q, a, k, t, d, n, h)), dj_sub_l(M.remove(id, a), a, t, rm_sub(id, a), p10(q, a, k, t, d, n, h)), dj_snoc_r(M.remove(id, a), d, id, dj_sub_l(M.remove(id, a), a, d, rm_sub(id, a), p11(q, a, k, t, d, n, h)), nm_removed(id, a)), p12(q, a, k, t, d, n, h), dj_snoc_r(k, d, id, p13(q, a, k, t, d, n, h), dj_nm(a, k, id, hm, p9(q, a, k, t, d, n, h))), dj_snoc_r(t, d, id, p14(q, a, k, t, d, n, h), dj_nm(a, t, id, hm, p10(q, a, k, t, d, n, h))), p15(q, a, k, t, d, n, h), bd_sub(M.remove(id, a), a, n, rm_sub(id, a), p16(q, a, k, t, d, n, h)), p17(q, a, k, t, d, n, h), p18(q, a, k, t, d, n, h), bd_snoc(d, id, n, p19(q, a, k, t, d, n, h), bd_mem(a, n, id, hm, p16(q, a, k, t, d, n, h))), sm_ri(q, a, k, t, d, n, id, hm, p1(q, a, k, t, d, n, h), p20(q, a, k, t, d, n, h)))

def inv_rt(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +id: Nat, +hm: T(M.mem(id, k)), +h: T(IV(q, a, k, t, d, n))) -> T(IV(q, a, M.remove(id, k), t, M.snoc(d, id), n)):
  mk(q, a, M.remove(id, k), t, M.snoc(d, id), n, p0(q, a, k, t, d, n, h), p1(q, a, k, t, d, n, h), nd_remove(id, k, p2(q, a, k, t, d, n, h)), p3(q, a, k, t, d, n, h), nd_snoc(d, id, p4(q, a, k, t, d, n, h), dj_nm(k, d, id, hm, p13(q, a, k, t, d, n, h))), p5(q, a, k, t, d, n, h), dj_sub_r(q, M.remove(id, k), k, rm_sub(id, k), p6(q, a, k, t, d, n, h)), p7(q, a, k, t, d, n, h), dj_snoc_r(q, d, id, p8(q, a, k, t, d, n, h), dj_nm(k, q, id, hm, dj_sym(q, k, p6(q, a, k, t, d, n, h)))), dj_sub_r(a, M.remove(id, k), k, rm_sub(id, k), p9(q, a, k, t, d, n, h)), p10(q, a, k, t, d, n, h), dj_snoc_r(a, d, id, p11(q, a, k, t, d, n, h), dj_nm(k, a, id, hm, dj_sym(a, k, p9(q, a, k, t, d, n, h)))), dj_sub_l(M.remove(id, k), k, t, rm_sub(id, k), p12(q, a, k, t, d, n, h)), dj_snoc_r(M.remove(id, k), d, id, dj_sub_l(M.remove(id, k), k, d, rm_sub(id, k), p13(q, a, k, t, d, n, h)), nm_removed(id, k)), dj_snoc_r(t, d, id, p14(q, a, k, t, d, n, h), dj_nm(k, t, id, hm, p12(q, a, k, t, d, n, h))), p15(q, a, k, t, d, n, h), p16(q, a, k, t, d, n, h), bd_sub(M.remove(id, k), k, n, rm_sub(id, k), p17(q, a, k, t, d, n, h)), p18(q, a, k, t, d, n, h), bd_snoc(d, id, n, p19(q, a, k, t, d, n, h), bd_mem(k, n, id, hm, p17(q, a, k, t, d, n, h))), sm_rt(q, a, k, t, d, n, id, hm, p2(q, a, k, t, d, n, h), p20(q, a, k, t, d, n, h)))

def invw(+s: M.World) -> Bool:
  IV(S.queue(s), S.held_af(s), S.held_tk(s), S.typed(s), S.dropped(s), S.next_id(s))

def fgo(+q: +List<Nat>, +haf: +List<Nat>, +htk: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +u: +List<Nat>, +tt: +List<Nat>, +rl: +List<Nat>, +n: Nat, +tk: Bool, +i: Bool, +g: Bool, +h: T(IV(q, haf, htk, t, d, n))) -> T(invw(M.flush_go(q, M.W{[], haf, htk, t, d, u, tt, rl, n, tk, i, g}))):
  match q:
    case Nil{}:
      h
    case Con{+x, +rest}:
      fgo(rest, haf, htk, M.snoc(t, x), d, u, M.record(tk, x, tt), rl, n, tk, False{}, g, inv_mv(x, rest, haf, htk, t, d, n, h))

def fb(i: Bool, +s: M.World, +h: T(invw(s))) -> T(invw(M.flush_b(i, s))):
  match i:
    case False{}:
      h
    case True{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          fgo(q, haf, htk, t, d, u, tt, rl, n, tk, i, g, h)

def fl(+s: M.World, +h: T(invw(s))) -> T(invw(M.flush(s))):
  match s:
    case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
      fb(i, M.W{q, haf, htk, t, d, u, tt, rl, n, tk, i, g}, h)

def send_auto_inv(fu: Bool, +s: M.World, +h: T(invw(s))) -> T(invw(M.send_auto(fu, s))):
  match fu:
    case True{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          match tk:
            case True{}:
              inv_sendK(q, haf, htk, t, d, n, h)
            case False{}:
              fl(M.W{M.snoc(q, n), haf, htk, t, d, M.snoc(u, n), tt, rl, 1n+n, False{}, i, g}, inv_sendQ(q, haf, htk, t, d, n, h))
    case False{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          match tk:
            case True{}:
              inv_sendK(q, haf, htk, t, d, n, h)
            case False{}:
              fl(M.W{M.snoc(q, n), haf, htk, t, d, u, tt, rl, 1n+n, False{}, i, g}, inv_sendQ(q, haf, htk, t, d, n, h))

def send_live_inv(r: M.Route, fu: Bool, +s: M.World, +h: T(invw(s))) -> T(invw(M.send_live(r, fu, s))):
  match r:
    case M.Auto{}:
      send_auto_inv(fu, s, h)
    case M.AskFirst{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          inv_sendA(q, haf, htk, t, d, n, h)
    case M.RouteDrop{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          inv_sendD(q, haf, htk, t, d, n, h)

def send_inv(r: M.Route, fu: Bool, g: Bool, +s: M.World, +h: T(invw(s))) -> T(invw(M.send(r, fu, g, s))):
  match g:
    case True{}:
      h
    case False{}:
      send_live_inv(r, fu, s, h)

def send_ev_inv(fu: Bool, r: M.Route, +s: M.World, +h: T(invw(s))) -> T(invw(M.send_ev(fu, r, s))):
  match s:
    case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
      send_inv(r, fu, g, M.W{q, haf, htk, t, d, u, tt, rl, n, tk, i, g}, h)

def idle_inv(+s: M.World, +h: T(invw(s))) -> T(invw(M.idle_ev(s))):
  match s:
    case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
      match g:
        case True{}:
          h
        case False{}:
          fl(M.W{q, haf, htk, t, d, u, tt, rl, n, tk, True{}, False{}}, h)

def busy_inv(+s: M.World, +h: T(invw(s))) -> T(invw(M.busy_ev(s))):
  match s:
    case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
      h

def exit_inv(+s: M.World, +h: T(invw(s))) -> T(invw(M.exit_(s))):
  match s:
    case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
      inv_ex(q, haf, htk, t, d, n, h)

def tb_inv(+s: M.World, +h: T(invw(s))) -> T(invw(M.takeover_begin(s))):
  match s:
    case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
      inv_tb(q, haf, htk, t, d, n, [], h)

def te_inv(+s: M.World, +h: T(invw(s))) -> T(invw(M.takeover_end(s))):
  match s:
    case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
      fl(M.W{List.append(&2, Nat, q, htk), haf, [], t, d, u, tt, rl, n, False{}, i, g}, inv_te(q, haf, htk, t, d, n, h))

def deliver_if_inv(b: Bool, +id: Nat, +s: M.World, +h: T(invw(s)), hm: T(b) -> T(M.mem(id, S.held_af(s)))) -> T(invw(M.deliver_if(b, id, s))):
  match b:
    case False{}:
      h
    case True{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          fl(M.W{M.snoc(q, id), M.remove(id, haf), htk, t, d, u, tt, M.snoc(rl, id), n, tk, i, g}, inv_di(q, haf, htk, t, d, n, id, hm({==}), h))

def deliver_tk_inv(b: Bool, +id: Nat, +s: M.World, +h: T(invw(s)), hm: T(b) -> T(M.mem(id, S.held_tk(s)))) -> T(invw(M.deliver_tk(b, id, s))):
  match b:
    case False{}:
      h
    case True{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          fl(M.W{M.snoc(q, id), haf, M.remove(id, htk), t, d, u, tt, M.snoc(rl, id), n, tk, i, g}, inv_dt(q, haf, htk, t, d, n, id, hm({==}), h))

def deliver_pick_inv(a: Bool, b: Bool, +id: Nat, +s: M.World, +h: T(invw(s)), ha: T(a) -> T(M.mem(id, S.held_af(s))), hb: T(b) -> T(M.mem(id, S.held_tk(s)))) -> T(invw(M.deliver_pick(a, b, id, s))):
  match a:
    case True{}:
      deliver_if_inv(True{}, id, s, h, ha)
    case False{}:
      deliver_tk_inv(b, id, s, h, hb)

def user_deliver_inv(+id: Nat, +s: M.World, +h: T(invw(s))) -> T(invw(M.user_deliver(id, s))):
  match s:
    case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
      deliver_pick_inv(Bool.and(M.mem(id, haf), Bool.not(g)), Bool.and(M.mem(id, htk), Bool.not(g)), id, M.W{q, haf, htk, t, d, u, tt, rl, n, tk, i, g}, h, hh => and_l(M.mem(id, haf), Bool.not(g), hh), hh => and_l(M.mem(id, htk), Bool.not(g), hh))

def drop_if_inv(b: Bool, +id: Nat, +s: M.World, +h: T(invw(s)), hm: T(b) -> T(M.mem(id, S.held_af(s)))) -> T(invw(M.drop_if(b, id, s))):
  match b:
    case False{}:
      h
    case True{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          inv_ri(q, haf, htk, t, d, n, id, hm({==}), h)

def drop_tk_inv(b: Bool, +id: Nat, +s: M.World, +h: T(invw(s)), hm: T(b) -> T(M.mem(id, S.held_tk(s)))) -> T(invw(M.drop_tk(b, id, s))):
  match b:
    case False{}:
      h
    case True{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          inv_rt(q, haf, htk, t, d, n, id, hm({==}), h)

def drop_pick_inv(a: Bool, b: Bool, +id: Nat, +s: M.World, +h: T(invw(s)), ha: T(a) -> T(M.mem(id, S.held_af(s))), hb: T(b) -> T(M.mem(id, S.held_tk(s)))) -> T(invw(M.drop_pick(a, b, id, s))):
  match a:
    case True{}:
      drop_if_inv(True{}, id, s, h, ha)
    case False{}:
      drop_tk_inv(b, id, s, h, hb)

def user_drop_inv(+id: Nat, +s: M.World, +h: T(invw(s))) -> T(invw(M.user_drop(id, s))):
  match s:
    case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
      drop_pick_inv(M.mem(id, haf), M.mem(id, htk), id, M.W{q, haf, htk, t, d, u, tt, rl, n, tk, i, g}, h, hh => hh, hh => hh)

def restart_inv(alive: Bool, +s: M.World, +h: T(invw(s))) -> T(invw(M.restart(alive, s))):
  match alive:
    case True{}:
      te_inv(M.busy_ev(s), busy_inv(s, h))
    case False{}:
      te_inv(M.exit_(s), exit_inv(s, h))

def step_inv(e: M.Ev, +s: M.World, +h: T(invw(s))) -> T(invw(M.step(e, s))):
  match e:
    case M.Send{fu, r}:
      send_ev_inv(fu, r, s, h)
    case M.Idle{}:
      idle_inv(s, h)
    case M.Busy{}:
      busy_inv(s, h)
    case M.Exit{}:
      exit_inv(s, h)
    case M.TakeoverBegin{}:
      tb_inv(s, h)
    case M.TakeoverEnd{}:
      te_inv(s, h)
    case M.UserInput{}:
      tb_inv(s, h)
    case M.UserSubmit{}:
      te_inv(s, h)
    case M.UserClear{}:
      te_inv(s, h)
    case M.UserDeliver{id}:
      user_deliver_inv(id, s, h)
    case M.UserDrop{id}:
      user_drop_inv(id, s, h)
    case M.Restart{alive}:
      restart_inv(alive, s, h)
    case M.Ask{o, c}:
      h
    case M.HopMade{}:
      h
    case M.HopEnded{}:
      h
    case M.BoundPassed{}:
      h
    case M.Answer{}:
      h
    case M.Escalate{}:
      h
    case M.Reply{}:
      h

def run_inv(+evs: +List<M.Ev>, +s: M.World, +h: T(invw(s))) -> T(invw(M.run(evs, s))):
  match evs:
    case Nil{}:
      h
    case Con{e, +rest}:
      run_inv(rest, M.step(e, s), step_inv(e, s, h))

def inv_init() -> T(invw(M.init())):
  mk([], [], [], [], [], 1n, {==}, {==}, {==}, {==}, {==}, {==}, {==}, {==}, {==}, {==}, {==}, {==}, {==}, {==}, {==}, {==}, {==}, {==}, {==}, {==}, {==})

def inv_world(+evs: +List<M.Ev>) -> T(invw(S.world(evs))):
  run_inv(evs, M.init(), inv_init())

# ---- M1
def m1_main(+evs: +List<M.Ev>) -> T(S.nodup(S.typed(S.world(evs)))):
  p3(S.queue(S.world(evs)), S.held_af(S.world(evs)), S.held_tk(S.world(evs)), S.typed(S.world(evs)), S.dropped(S.world(evs)), S.next_id(S.world(evs)), inv_world(evs))

def Laws.m1_final_and_at_most_once(evs):
  m1_main(evs)

# ---- M5
def m5_main(+evs: +List<M.Ev>) -> T(Bool.and(S.disjoint(S.typed(S.world(evs)), S.dropped(S.world(evs))), Bool.and(S.disjoint(S.typed(S.world(evs)), S.queue(S.world(evs))), Bool.and(S.disjoint(S.typed(S.world(evs)), S.held_af(S.world(evs))), S.disjoint(S.typed(S.world(evs)), S.held_tk(S.world(evs))))))):
  and_i(S.disjoint(S.typed(S.world(evs)), S.dropped(S.world(evs))), Bool.and(S.disjoint(S.typed(S.world(evs)), S.queue(S.world(evs))), Bool.and(S.disjoint(S.typed(S.world(evs)), S.held_af(S.world(evs))), S.disjoint(S.typed(S.world(evs)), S.held_tk(S.world(evs))))), p14(S.queue(S.world(evs)), S.held_af(S.world(evs)), S.held_tk(S.world(evs)), S.typed(S.world(evs)), S.dropped(S.world(evs)), S.next_id(S.world(evs)), inv_world(evs)), and_i(S.disjoint(S.typed(S.world(evs)), S.queue(S.world(evs))), Bool.and(S.disjoint(S.typed(S.world(evs)), S.held_af(S.world(evs))), S.disjoint(S.typed(S.world(evs)), S.held_tk(S.world(evs)))), dj_sym(S.queue(S.world(evs)), S.typed(S.world(evs)), p7(S.queue(S.world(evs)), S.held_af(S.world(evs)), S.held_tk(S.world(evs)), S.typed(S.world(evs)), S.dropped(S.world(evs)), S.next_id(S.world(evs)), inv_world(evs))), and_i(S.disjoint(S.typed(S.world(evs)), S.held_af(S.world(evs))), S.disjoint(S.typed(S.world(evs)), S.held_tk(S.world(evs))), dj_sym(S.held_af(S.world(evs)), S.typed(S.world(evs)), p10(S.queue(S.world(evs)), S.held_af(S.world(evs)), S.held_tk(S.world(evs)), S.typed(S.world(evs)), S.dropped(S.world(evs)), S.next_id(S.world(evs)), inv_world(evs))), dj_sym(S.held_tk(S.world(evs)), S.typed(S.world(evs)), p12(S.queue(S.world(evs)), S.held_af(S.world(evs)), S.held_tk(S.world(evs)), S.typed(S.world(evs)), S.dropped(S.world(evs)), S.next_id(S.world(evs)), inv_world(evs))))))

def Laws.m5_terminal_states_are_absorbing(evs):
  m5_main(evs)

# ---- M6
def m6_main(+evs: +List<M.Ev>) -> EQ(SG(S.len(S.queue(S.world(evs))), S.len(S.held_af(S.world(evs))), S.len(S.held_tk(S.world(evs))), S.len(S.typed(S.world(evs))), S.len(S.dropped(S.world(evs)))), S.next_id(S.world(evs))):
  eq_elim(SG(S.len(S.queue(S.world(evs))), S.len(S.held_af(S.world(evs))), S.len(S.held_tk(S.world(evs))), S.len(S.typed(S.world(evs))), S.len(S.dropped(S.world(evs)))), S.next_id(S.world(evs)), p20(S.queue(S.world(evs)), S.held_af(S.world(evs)), S.held_tk(S.world(evs)), S.typed(S.world(evs)), S.dropped(S.world(evs)), S.next_id(S.world(evs)), inv_world(evs)))

def Laws.m6_no_silent_loss(evs):
  m6_main(evs)

# ---- M9
def restart_replay(alive: Bool, +s: M.World) -> {S.records(M.step(M.Restart{alive}, s)) == S.replay(S.records(s), alive) : S.Rec}:
  match alive:
    case True{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          {==}
    case False{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          {==}

def Laws.m9_restart_is_a_replay(evs, alive):
  restart_replay(alive, S.world(evs))

# ---- B39
# The in-flight step (B39, B40): the Messages in flight are the list `k` of the shared invariant `IV`, the queue is `q`, the delivered
# are `t`, the dropped are `d`, and `a` is a list this model never fills. Typing moves the queue to `k`, the Signal moves `k` to `t`,
# a kill moves `k` back to the front of `q`.
def sht(+lq: Nat, +la: Nat, +lk: Nat, +lt: Nat, +ld: Nat, +z: Nat) -> EQ(SG(lq, la, lk, Nat.add(lt, z), ld), Nat.add(z, SG(lq, la, lk, lt, ld))):
  tr(SG(lq, la, lk, Nat.add(lt, z), ld), 1n+Nat.add(z, Nat.add(lq, Nat.add(la, Nat.add(lk, Nat.add(lt, ld))))), Nat.add(z, SG(lq, la, lk, lt, ld)), sc(Nat.add(lq, Nat.add(la, Nat.add(lk, Nat.add(Nat.add(lt, z), ld)))), Nat.add(z, Nat.add(lq, Nat.add(la, Nat.add(lk, Nat.add(lt, ld))))), tr(Nat.add(lq, Nat.add(la, Nat.add(lk, Nat.add(Nat.add(lt, z), ld)))), Nat.add(lq, Nat.add(z, Nat.add(la, Nat.add(lk, Nat.add(lt, ld))))), Nat.add(z, Nat.add(lq, Nat.add(la, Nat.add(lk, Nat.add(lt, ld))))), ar(lq, Nat.add(la, Nat.add(lk, Nat.add(Nat.add(lt, z), ld))), Nat.add(z, Nat.add(la, Nat.add(lk, Nat.add(lt, ld)))), tr(Nat.add(la, Nat.add(lk, Nat.add(Nat.add(lt, z), ld))), Nat.add(la, Nat.add(z, Nat.add(lk, Nat.add(lt, ld)))), Nat.add(z, Nat.add(la, Nat.add(lk, Nat.add(lt, ld)))), ar(la, Nat.add(lk, Nat.add(Nat.add(lt, z), ld)), Nat.add(z, Nat.add(lk, Nat.add(lt, ld))), tr(Nat.add(lk, Nat.add(Nat.add(lt, z), ld)), Nat.add(lk, Nat.add(z, Nat.add(lt, ld))), Nat.add(z, Nat.add(lk, Nat.add(lt, ld))), ar(lk, Nat.add(Nat.add(lt, z), ld), Nat.add(z, Nat.add(lt, ld)), tr(Nat.add(Nat.add(lt, z), ld), Nat.add(lt, Nat.add(z, ld)), Nat.add(z, Nat.add(lt, ld)), add_assoc(lt, z, ld), swp(lt, z, ld))), swp(lk, z, Nat.add(lt, ld)))), swp(la, z, Nat.add(lk, Nat.add(lt, ld))))), swp(lq, z, Nat.add(la, Nat.add(lk, Nat.add(lt, ld)))))), sy(Nat.add(z, 1n+Nat.add(lq, Nat.add(la, Nat.add(lk, Nat.add(lt, ld))))), 1n+Nat.add(z, Nat.add(lq, Nat.add(la, Nat.add(lk, Nat.add(lt, ld))))), add_succ_r(z, Nat.add(lq, Nat.add(la, Nat.add(lk, Nat.add(lt, ld)))))))

# Typing: the queue becomes the batch in flight (none was in flight).
def sm_ty(+q: +List<Nat>, +a: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +hs: T(SUMB(q, a, [], t, d, n))) -> T(SUMB([], a, q, t, d, n)):
  eq_intro(SG(0n, S.len(a), S.len(q), S.len(t), S.len(d)), n, tr(SG(0n, S.len(a), S.len(q), S.len(t), S.len(d)), SG(S.len(q), S.len(a), 0n, S.len(t), S.len(d)), n, tr(SG(0n, S.len(a), S.len(q), S.len(t), S.len(d)), Nat.add(S.len(q), SG(0n, S.len(a), 0n, S.len(t), S.len(d))), SG(S.len(q), S.len(a), 0n, S.len(t), S.len(d)), shk(0n, S.len(a), 0n, S.len(t), S.len(d), S.len(q)), sy(SG(S.len(q), S.len(a), 0n, S.len(t), S.len(d)), Nat.add(S.len(q), SG(0n, S.len(a), 0n, S.len(t), S.len(d))), shq(0n, S.len(a), 0n, S.len(t), S.len(d), S.len(q)))), eq_elim(SG(S.len(q), S.len(a), 0n, S.len(t), S.len(d)), n, hs)))

# The Signal: the batch in flight is delivered.
def sm_cf(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +hs: T(SUMB(q, a, k, t, d, n))) -> T(SUMB(q, a, [], List.append(&2, Nat, t, k), d, n)):
  eq_intro(SG(S.len(q), S.len(a), 0n, S.len(List.append(&2, Nat, t, k)), S.len(d)), n, tr(SG(S.len(q), S.len(a), 0n, S.len(List.append(&2, Nat, t, k)), S.len(d)), Nat.add(S.len(k), SG(S.len(q), S.len(a), 0n, S.len(t), S.len(d))), n, tr(SG(S.len(q), S.len(a), 0n, S.len(List.append(&2, Nat, t, k)), S.len(d)), SG(S.len(q), S.len(a), 0n, Nat.add(S.len(t), S.len(k)), S.len(d)), Nat.add(S.len(k), SG(S.len(q), S.len(a), 0n, S.len(t), S.len(d))), cgt(S.len(q), S.len(a), 0n, S.len(List.append(&2, Nat, t, k)), Nat.add(S.len(t), S.len(k)), S.len(d), len_app(t, k)), sht(S.len(q), S.len(a), 0n, S.len(t), S.len(d), S.len(k))), tr(Nat.add(S.len(k), SG(S.len(q), S.len(a), 0n, S.len(t), S.len(d))), SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), n, sy(SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), Nat.add(S.len(k), SG(S.len(q), S.len(a), 0n, S.len(t), S.len(d))), shk(S.len(q), S.len(a), 0n, S.len(t), S.len(d), S.len(k))), eq_elim(SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), n, hs))))

def len_app_comm(+a: +List<Nat>, +b: +List<Nat>) -> EQ(S.len(List.append(&2, Nat, a, b)), S.len(List.append(&2, Nat, b, a))):
  tr(S.len(List.append(&2, Nat, a, b)), Nat.add(S.len(a), S.len(b)), S.len(List.append(&2, Nat, b, a)), len_app(a, b), tr(Nat.add(S.len(a), S.len(b)), Nat.add(S.len(b), S.len(a)), S.len(List.append(&2, Nat, b, a)), add_comm(S.len(a), S.len(b)), sy(S.len(List.append(&2, Nat, b, a)), Nat.add(S.len(b), S.len(a)), len_app(b, a))))

# The kill: the batch in flight is pending again, ahead of the queue.
def sm_kill(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +hs: T(SUMB(q, a, k, t, d, n))) -> T(SUMB(List.append(&2, Nat, k, q), a, [], t, d, n)):
  eq_intro(SG(S.len(List.append(&2, Nat, k, q)), S.len(a), 0n, S.len(t), S.len(d)), n, tr(SG(S.len(List.append(&2, Nat, k, q)), S.len(a), 0n, S.len(t), S.len(d)), SG(S.len(List.append(&2, Nat, q, k)), S.len(a), 0n, S.len(t), S.len(d)), n, cgq(S.len(List.append(&2, Nat, k, q)), S.len(List.append(&2, Nat, q, k)), S.len(a), 0n, S.len(t), S.len(d), len_app_comm(k, q)), eq_elim(SG(S.len(List.append(&2, Nat, q, k)), S.len(a), 0n, S.len(t), S.len(d)), n, sm_te(q, a, k, t, d, n, hs))))

def inv_ty(+q: +List<Nat>, +a: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: T(IV(q, a, [], t, d, n))) -> T(IV([], a, q, t, d, n)):
  mk([], a, q, t, d, n, {==}, p1(q, a, [], t, d, n, h), p0(q, a, [], t, d, n, h), p3(q, a, [], t, d, n, h), p4(q, a, [], t, d, n, h), {==}, {==}, {==}, {==}, dj_sym(q, a, p5(q, a, [], t, d, n, h)), p10(q, a, [], t, d, n, h), p11(q, a, [], t, d, n, h), p7(q, a, [], t, d, n, h), p8(q, a, [], t, d, n, h), p14(q, a, [], t, d, n, h), {==}, p16(q, a, [], t, d, n, h), p15(q, a, [], t, d, n, h), p18(q, a, [], t, d, n, h), p19(q, a, [], t, d, n, h), sm_ty(q, a, t, d, n, p20(q, a, [], t, d, n, h)))

def inv_cf(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: T(IV(q, a, k, t, d, n))) -> T(IV(q, a, [], List.append(&2, Nat, t, k), d, n)):
  mk(q, a, [], List.append(&2, Nat, t, k), d, n, p0(q, a, k, t, d, n, h), p1(q, a, k, t, d, n, h), {==}, nd_app(t, k, p3(q, a, k, t, d, n, h), p2(q, a, k, t, d, n, h), dj_sym(k, t, p12(q, a, k, t, d, n, h))), p4(q, a, k, t, d, n, h), p5(q, a, k, t, d, n, h), dj_nil_r(q), dj_app_r(q, t, k, p7(q, a, k, t, d, n, h), p6(q, a, k, t, d, n, h)), p8(q, a, k, t, d, n, h), dj_nil_r(a), dj_app_r(a, t, k, p10(q, a, k, t, d, n, h), p9(q, a, k, t, d, n, h)), p11(q, a, k, t, d, n, h), {==}, {==}, dj_app_l(t, k, d, p14(q, a, k, t, d, n, h), p13(q, a, k, t, d, n, h)), p15(q, a, k, t, d, n, h), p16(q, a, k, t, d, n, h), {==}, bd_app(t, k, n, p18(q, a, k, t, d, n, h), p17(q, a, k, t, d, n, h)), p19(q, a, k, t, d, n, h), sm_cf(q, a, k, t, d, n, p20(q, a, k, t, d, n, h)))

def inv_kill(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: T(IV(q, a, k, t, d, n))) -> T(IV(List.append(&2, Nat, k, q), a, [], t, d, n)):
  mk(List.append(&2, Nat, k, q), a, [], t, d, n, nd_app(k, q, p2(q, a, k, t, d, n, h), p0(q, a, k, t, d, n, h), dj_sym(q, k, p6(q, a, k, t, d, n, h))), p1(q, a, k, t, d, n, h), {==}, p3(q, a, k, t, d, n, h), p4(q, a, k, t, d, n, h), dj_app_l(k, q, a, dj_sym(a, k, p9(q, a, k, t, d, n, h)), p5(q, a, k, t, d, n, h)), dj_nil_r(List.append(&2, Nat, k, q)), dj_app_l(k, q, t, p12(q, a, k, t, d, n, h), p7(q, a, k, t, d, n, h)), dj_app_l(k, q, d, p13(q, a, k, t, d, n, h), p8(q, a, k, t, d, n, h)), dj_nil_r(a), p10(q, a, k, t, d, n, h), p11(q, a, k, t, d, n, h), {==}, {==}, p14(q, a, k, t, d, n, h), bd_app(k, q, n, p17(q, a, k, t, d, n, h), p15(q, a, k, t, d, n, h)), p16(q, a, k, t, d, n, h), {==}, p18(q, a, k, t, d, n, h), p19(q, a, k, t, d, n, h), sm_kill(q, a, k, t, d, n, p20(q, a, k, t, d, n, h)))

# The invariant of the in-flight model: the shared partition invariant with the unused list empty.
def invf(+s: M.Fl) -> Bool:
  IV(S.f_queue(s), [], S.f_inflight(s), S.f_delivered(s), S.f_dropped(s), S.f_next(s))

def fidle_go_inv(+inf: +List<Nat>, +q: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, hold: Bool, g: Bool, +h: T(IV(q, [], inf, t, d, n))) -> T(invf(M.fidle_go(inf, q, t, d, n, hold, g))):
  match inf:
    case Nil{}:
      inv_ty(q, [], t, d, n, h)
    case Con{+x, +rest}:
      h

def fidle_live_inv(hold: Bool, +s: M.Fl, +h: T(invf(s))) -> T(invf(M.fidle_live(hold, s))):
  match hold:
    case True{}:
      h
    case False{}:
      match s:
        case M.F{+q, +inf, +t, +d, +n, +hold2, +g}:
          fidle_go_inv(inf, q, t, d, n, hold2, g, h)

def fidle_inv(+s: M.Fl, +h: T(invf(s))) -> T(invf(M.fidle(s))):
  match s:
    case M.F{+q, +inf, +t, +d, +n, +hold, +g}:
      match g:
        case True{}:
          h
        case False{}:
          fidle_live_inv(hold, M.F{q, inf, t, d, n, hold, False{}}, h)

def fsend_inv(+s: M.Fl, +h: T(invf(s))) -> T(invf(M.fsend(s))):
  match s:
    case M.F{+q, +inf, +t, +d, +n, +hold, +g}:
      match g:
        case True{}:
          h
        case False{}:
          inv_sendQ(q, [], inf, t, d, n, h)

def fconfirm_inv(+s: M.Fl, +h: T(invf(s))) -> T(invf(M.fconfirm(s))):
  match s:
    case M.F{+q, +inf, +t, +d, +n, +hold, +g}:
      inv_cf(q, [], inf, t, d, n, h)

def fkill_inv(+s: M.Fl, +h: T(invf(s))) -> T(invf(M.fkill(s))):
  match s:
    case M.F{+q, +inf, +t, +d, +n, +hold, +g}:
      inv_kill(q, [], inf, t, d, n, h)

def fhold_inv(b: Bool, +s: M.Fl, +h: T(invf(s))) -> T(invf(M.fhold(b, s))):
  match s:
    case M.F{+q, +inf, +t, +d, +n, +hold, +g}:
      h

def fexit_inv(+s: M.Fl, +h: T(invf(s))) -> T(invf(M.fexit(s))):
  match s:
    case M.F{+q, +inf, +t, +d, +n, +hold, +g}:
      inv_ex(q, [], inf, t, d, n, h)

def fstep_inv(e: M.FEv, +s: M.Fl, +h: T(invf(s))) -> T(invf(M.fstep(e, s))):
  match e:
    case M.FSend{}:
      fsend_inv(s, h)
    case M.FIdle{}:
      fidle_inv(s, h)
    case M.FConfirm{}:
      fconfirm_inv(s, h)
    case M.FKill{}:
      fkill_inv(s, h)
    case M.FHold{}:
      fhold_inv(True{}, s, h)
    case M.FRelease{}:
      fhold_inv(False{}, s, h)
    case M.FExit{}:
      fexit_inv(s, h)

def frun_inv(+evs: +List<M.FEv>, +s: M.Fl, +h: T(invf(s))) -> T(invf(M.frun(evs, s))):
  match evs:
    case Nil{}:
      h
    case Con{e, +rest}:
      frun_inv(rest, M.fstep(e, s), fstep_inv(e, s, h))

def finv_world(+evs: +List<M.FEv>) -> T(invf(S.fworld(evs))):
  frun_inv(evs, M.finit(), mk([], [], [], [], [], 1n, {==}, {==}, {==}, {==}, {==}, {==}, {==}, {==}, {==}, {==}, {==}, {==}, {==}, {==}, {==}, {==}, {==}, {==}, {==}, {==}, {==}))

def b39_delivered_main(+evs: +List<M.FEv>) -> T(S.nodup(S.f_delivered(S.fworld(evs)))):
  p3(S.f_queue(S.fworld(evs)), [], S.f_inflight(S.fworld(evs)), S.f_delivered(S.fworld(evs)), S.f_dropped(S.fworld(evs)), S.f_next(S.fworld(evs)), finv_world(evs))

def Laws.b39_delivered_at_most_once(evs):
  b39_delivered_main(evs)

def b40_main(+evs: +List<M.FEv>) -> T(Bool.and(S.disjoint(S.f_delivered(S.fworld(evs)), S.f_queue(S.fworld(evs))), S.disjoint(S.f_delivered(S.fworld(evs)), S.f_inflight(S.fworld(evs))))):
  and_i(S.disjoint(S.f_delivered(S.fworld(evs)), S.f_queue(S.fworld(evs))), S.disjoint(S.f_delivered(S.fworld(evs)), S.f_inflight(S.fworld(evs))), dj_sym(S.f_queue(S.fworld(evs)), S.f_delivered(S.fworld(evs)), p7(S.f_queue(S.fworld(evs)), [], S.f_inflight(S.fworld(evs)), S.f_delivered(S.fworld(evs)), S.f_dropped(S.fworld(evs)), S.f_next(S.fworld(evs)), finv_world(evs))), dj_sym(S.f_inflight(S.fworld(evs)), S.f_delivered(S.fworld(evs)), p12(S.f_queue(S.fworld(evs)), [], S.f_inflight(S.fworld(evs)), S.f_delivered(S.fworld(evs)), S.f_dropped(S.fworld(evs)), S.f_next(S.fworld(evs)), finv_world(evs))))

def Laws.b39_a_retry_never_retypes_a_delivered_message(evs):
  b40_main(evs)

def b39_sum_main(+evs: +List<M.FEv>) -> EQ(SG(S.len(S.f_queue(S.fworld(evs))), 0n, S.len(S.f_inflight(S.fworld(evs))), S.len(S.f_delivered(S.fworld(evs))), S.len(S.f_dropped(S.fworld(evs)))), S.f_next(S.fworld(evs))):
  eq_elim(SG(S.len(S.f_queue(S.fworld(evs))), 0n, S.len(S.f_inflight(S.fworld(evs))), S.len(S.f_delivered(S.fworld(evs))), S.len(S.f_dropped(S.fworld(evs)))), S.f_next(S.fworld(evs)), p20(S.f_queue(S.fworld(evs)), [], S.f_inflight(S.fworld(evs)), S.f_delivered(S.fworld(evs)), S.f_dropped(S.fworld(evs)), S.f_next(S.fworld(evs)), finv_world(evs)))

def Laws.b39_no_silent_loss_in_flight(evs):
  b39_sum_main(evs)

def hold_refl(hd: Bool, +inf: +List<Nat>) -> T(S.implies(hd, S.all_in(inf, inf))):
  match hd:
    case True{}:
      all_in_refl(inf)
    case False{}:
      {==}

def hold_live(hd: Bool, +q: +List<Nat>, +inf: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, n: Nat, g: Bool) -> T(S.implies(hd, S.all_in(S.f_inflight(M.fidle_live(hd, M.F{q, inf, t, d, n, hd, g})), inf))):
  match hd:
    case True{}:
      all_in_refl(inf)
    case False{}:
      {==}

def fhold_types_nothing(+s: M.Fl) -> T(S.implies(S.f_hold(s), S.all_in(S.f_inflight(M.fstep(M.FIdle{}, s)), S.f_inflight(s)))):
  match s:
    case M.F{+q, +inf, +t, +d, +n, +hd, +g}:
      match g:
        case True{}:
          hold_refl(hd, inf)
        case False{}:
          hold_live(hd, q, inf, t, d, n, False{})

def Laws.b39_a_hold_types_no_batch(evs):
  fhold_types_nothing(S.fworld(evs))

# ---- M8
def not_or_l(a: Bool, b: Bool, +h: T(Bool.not(Bool.or(a, b)))) -> T(Bool.not(a)):
  match a:
    case False{}:
      {==}
    case True{}:
      no(T(Bool.not(True{})), h)

def not_or_r(a: Bool, b: Bool, +h: T(Bool.not(Bool.or(a, b)))) -> T(Bool.not(b)):
  match a:
    case False{}:
      h
    case True{}:
      no(T(Bool.not(b)), h)

def not_or_i(a: Bool, b: Bool, +ha: T(Bool.not(a)), +hb: T(Bool.not(b))) -> T(Bool.not(Bool.or(a, b))):
  match a:
    case False{}:
      hb
    case True{}:
      no(T(Bool.not(Bool.or(True{}, b))), ha)

def contra(a: Bool, b: Bool, f: T(a) -> T(b), +hn: T(Bool.not(b))) -> T(Bool.not(a)):
  match a:
    case False{}:
      {==}
    case True{}:
      match b:
        case True{}:
          no(T(Bool.not(True{})), hn)
        case False{}:
          no(T(Bool.not(True{})), f({==}))

def eq_comm(+x: Nat, +y: Nat) -> {Nat.is_eq(x, y) == Nat.is_eq(y, x) : Bool}:
  match x y:
    case 0n 0n:
      {==}
    case 0n 1n+yp:
      {==}
    case 1n+xp 0n:
      {==}
    case 1n+xp 1n+yp:
      eq_comm(xp, yp)

def neq_sym(+x: Nat, +y: Nat, +h: T(Bool.not(Nat.is_eq(x, y)))) -> T(Bool.not(Nat.is_eq(y, x))):
  %eq_comm(x, y) : T(Bool.not(_))
  h

# clean (B13): what it keeps is in its input, never holds the sender, and has no repeat.
def cA_go(p: Bool, m: Bool, +y: Nat, +x: Nat, +rest: +List<Nat>, +o: Nat, f: T(M.mem(y, M.clean(o, rest))) -> T(M.mem(y, rest)), +h: T(M.mem(y, M.clean_step(Bool.or(p, m), x, M.clean(o, rest))))) -> T(M.mem(y, x <> rest)):
  match p:
    case True{}:
      mem_cons_keep(y, x, rest, f(h))
    case False{}:
      match m:
        case True{}:
          mem_cons_keep(y, x, rest, f(h))
        case False{}:
          or_elim(M.mem(y, x <> rest), Nat.is_eq(y, x), M.mem(y, M.clean(o, rest)), he => or_l(Nat.is_eq(y, x), M.mem(y, rest), he), hm => mem_cons_keep(y, x, rest, f(hm)), h)

def cA(+y: Nat, +o: Nat, +xs: +List<Nat>, +h: T(M.mem(y, M.clean(o, xs)))) -> T(M.mem(y, xs)):
  match xs:
    case Nil{}:
      h
    case Con{+x, +rest}:
      cA_go(Nat.is_eq(x, o), M.mem(x, rest), y, x, rest, o, hh => cA(y, o, rest, hh), h)

def cB_go(p: Bool, m: Bool, +x: Nat, +rest: +List<Nat>, +o: Nat, hp: T(Bool.not(p)) -> T(Bool.not(Nat.is_eq(o, x))), +ih: T(Bool.not(M.mem(o, M.clean(o, rest))))) -> T(Bool.not(M.mem(o, M.clean_step(Bool.or(p, m), x, M.clean(o, rest))))):
  match p:
    case True{}:
      ih
    case False{}:
      match m:
        case True{}:
          ih
        case False{}:
          not_or_i(Nat.is_eq(o, x), M.mem(o, M.clean(o, rest)), hp({==}), ih)

def cB(+o: Nat, +xs: +List<Nat>) -> T(Bool.not(M.mem(o, M.clean(o, xs)))):
  match xs:
    case Nil{}:
      {==}
    case Con{+x, +rest}:
      cB_go(Nat.is_eq(x, o), M.mem(x, rest), x, rest, o, hh => neq_sym(x, o, hh), cB(o, rest))

def cN_go(p: Bool, m: Bool, +x: Nat, +rest: +List<Nat>, +o: Nat, hm: T(Bool.not(m)) -> T(Bool.not(M.mem(x, M.clean(o, rest)))), +ih: T(S.nodup(M.clean(o, rest)))) -> T(S.nodup(M.clean_step(Bool.or(p, m), x, M.clean(o, rest)))):
  match p:
    case True{}:
      ih
    case False{}:
      match m:
        case True{}:
          ih
        case False{}:
          and_i(Bool.not(M.mem(x, M.clean(o, rest))), S.nodup(M.clean(o, rest)), hm({==}), ih)

def cN(+o: Nat, +xs: +List<Nat>) -> T(S.nodup(M.clean(o, xs))):
  match xs:
    case Nil{}:
      {==}
    case Con{+x, +rest}:
      cN_go(Nat.is_eq(x, o), M.mem(x, rest), x, rest, o, hh => contra(M.mem(x, M.clean(o, rest)), M.mem(x, rest), hq => cA(x, o, rest, hq), hh), cN(o, rest))

def d0(+xs: +List<Nat>) -> T(S.disjoint(xs, [])):
  match xs:
    case Nil{}:
      {==}
    case Con{+x, +rest}:
      d0(rest)

def dj_cons(+x: Nat, +r: +List<Nat>, +hops: +List<Nat>, +hx: T(Bool.not(M.mem(x, r))), +hd: T(S.disjoint(r, hops))) -> T(S.disjoint(r, x <> hops)):
  match r:
    case Nil{}:
      {==}
    case Con{+y, +r2}:
      and_i(Bool.not(M.mem(y, x <> hops)), S.disjoint(r2, x <> hops), not_or_i(Nat.is_eq(y, x), M.mem(y, hops), neq_sym(x, y, not_or_l(Nat.is_eq(x, y), M.mem(x, r2), hx)), and_l(Bool.not(M.mem(y, hops)), S.disjoint(r2, hops), hd)), dj_cons(x, r2, hops, not_or_r(Nat.is_eq(x, y), M.mem(x, r2), hx), and_r(Bool.not(M.mem(y, hops)), S.disjoint(r2, hops), hd)))

# J: the chain's own invariant. The hops made and the hops left are each without repeat, share none, and neither holds the sender.
def J(+q: M.Q) -> Bool:
  Bool.and(S.nodup(S.q_hops(q)), Bool.and(S.nodup(S.q_rest(q)), Bool.and(S.disjoint(S.q_rest(q), S.q_hops(q)), Bool.and(Bool.not(M.mem(S.q_origin(q), S.q_hops(q))), Bool.not(M.mem(S.q_origin(q), S.q_rest(q)))))))

def jmk(+hops: +List<Nat>, +rest: +List<Nat>, +o: Nat, +a: T(S.nodup(hops)), +b: T(S.nodup(rest)), +c: T(S.disjoint(rest, hops)), +d: T(Bool.not(M.mem(o, hops))), +e: T(Bool.not(M.mem(o, rest)))) -> T(Bool.and(S.nodup(hops), Bool.and(S.nodup(rest), Bool.and(S.disjoint(rest, hops), Bool.and(Bool.not(M.mem(o, hops)), Bool.not(M.mem(o, rest))))))):
  and_i(S.nodup(hops), Bool.and(S.nodup(rest), Bool.and(S.disjoint(rest, hops), Bool.and(Bool.not(M.mem(o, hops)), Bool.not(M.mem(o, rest))))), a, and_i(S.nodup(rest), Bool.and(S.disjoint(rest, hops), Bool.and(Bool.not(M.mem(o, hops)), Bool.not(M.mem(o, rest)))), b, and_i(S.disjoint(rest, hops), Bool.and(Bool.not(M.mem(o, hops)), Bool.not(M.mem(o, rest))), c, and_i(Bool.not(M.mem(o, hops)), Bool.not(M.mem(o, rest)), d, e))))

def ja(+hops: +List<Nat>, +rest: +List<Nat>, +o: Nat, +h: T(Bool.and(S.nodup(hops), Bool.and(S.nodup(rest), Bool.and(S.disjoint(rest, hops), Bool.and(Bool.not(M.mem(o, hops)), Bool.not(M.mem(o, rest)))))))) -> T(S.nodup(hops)):
  and_l(S.nodup(hops), Bool.and(S.nodup(rest), Bool.and(S.disjoint(rest, hops), Bool.and(Bool.not(M.mem(o, hops)), Bool.not(M.mem(o, rest))))), h)

def jr1(+hops: +List<Nat>, +rest: +List<Nat>, +o: Nat, +h: T(Bool.and(S.nodup(hops), Bool.and(S.nodup(rest), Bool.and(S.disjoint(rest, hops), Bool.and(Bool.not(M.mem(o, hops)), Bool.not(M.mem(o, rest)))))))) -> T(Bool.and(S.nodup(rest), Bool.and(S.disjoint(rest, hops), Bool.and(Bool.not(M.mem(o, hops)), Bool.not(M.mem(o, rest)))))):
  and_r(S.nodup(hops), Bool.and(S.nodup(rest), Bool.and(S.disjoint(rest, hops), Bool.and(Bool.not(M.mem(o, hops)), Bool.not(M.mem(o, rest))))), h)

def jb(+hops: +List<Nat>, +rest: +List<Nat>, +o: Nat, +h: T(Bool.and(S.nodup(hops), Bool.and(S.nodup(rest), Bool.and(S.disjoint(rest, hops), Bool.and(Bool.not(M.mem(o, hops)), Bool.not(M.mem(o, rest)))))))) -> T(S.nodup(rest)):
  and_l(S.nodup(rest), Bool.and(S.disjoint(rest, hops), Bool.and(Bool.not(M.mem(o, hops)), Bool.not(M.mem(o, rest)))), jr1(hops, rest, o, h))

def jr2(+hops: +List<Nat>, +rest: +List<Nat>, +o: Nat, +h: T(Bool.and(S.nodup(hops), Bool.and(S.nodup(rest), Bool.and(S.disjoint(rest, hops), Bool.and(Bool.not(M.mem(o, hops)), Bool.not(M.mem(o, rest)))))))) -> T(Bool.and(S.disjoint(rest, hops), Bool.and(Bool.not(M.mem(o, hops)), Bool.not(M.mem(o, rest))))):
  and_r(S.nodup(rest), Bool.and(S.disjoint(rest, hops), Bool.and(Bool.not(M.mem(o, hops)), Bool.not(M.mem(o, rest)))), jr1(hops, rest, o, h))

def jc(+hops: +List<Nat>, +rest: +List<Nat>, +o: Nat, +h: T(Bool.and(S.nodup(hops), Bool.and(S.nodup(rest), Bool.and(S.disjoint(rest, hops), Bool.and(Bool.not(M.mem(o, hops)), Bool.not(M.mem(o, rest)))))))) -> T(S.disjoint(rest, hops)):
  and_l(S.disjoint(rest, hops), Bool.and(Bool.not(M.mem(o, hops)), Bool.not(M.mem(o, rest))), jr2(hops, rest, o, h))

def jr3(+hops: +List<Nat>, +rest: +List<Nat>, +o: Nat, +h: T(Bool.and(S.nodup(hops), Bool.and(S.nodup(rest), Bool.and(S.disjoint(rest, hops), Bool.and(Bool.not(M.mem(o, hops)), Bool.not(M.mem(o, rest)))))))) -> T(Bool.and(Bool.not(M.mem(o, hops)), Bool.not(M.mem(o, rest)))):
  and_r(S.disjoint(rest, hops), Bool.and(Bool.not(M.mem(o, hops)), Bool.not(M.mem(o, rest))), jr2(hops, rest, o, h))

def jd(+hops: +List<Nat>, +rest: +List<Nat>, +o: Nat, +h: T(Bool.and(S.nodup(hops), Bool.and(S.nodup(rest), Bool.and(S.disjoint(rest, hops), Bool.and(Bool.not(M.mem(o, hops)), Bool.not(M.mem(o, rest)))))))) -> T(Bool.not(M.mem(o, hops))):
  and_l(Bool.not(M.mem(o, hops)), Bool.not(M.mem(o, rest)), jr3(hops, rest, o, h))

def je(+hops: +List<Nat>, +rest: +List<Nat>, +o: Nat, +h: T(Bool.and(S.nodup(hops), Bool.and(S.nodup(rest), Bool.and(S.disjoint(rest, hops), Bool.and(Bool.not(M.mem(o, hops)), Bool.not(M.mem(o, rest)))))))) -> T(Bool.not(M.mem(o, rest))):
  and_r(Bool.not(M.mem(o, hops)), Bool.not(M.mem(o, rest)), jr3(hops, rest, o, h))
def j_ended(+q: M.Q, +h: T(J(q))) -> T(J(M.hop_ended(q))):
  match q:
    case M.Qn{ph, o, +rest, +hops, b}:
      match ph:
        case M.NoQ{}:
          h
        case M.Chained{}:
          h
        case M.OnHop{}:
          h
        case M.Ended{}:
          h
        case M.Answered{}:
          h
        case M.Escalated{}:
          h

def j_bound(+q: M.Q, +h: T(J(q))) -> T(J(M.bound_passed(q))):
  match q:
    case M.Qn{ph, o, +rest, +hops, b}:
      match ph:
        case M.NoQ{}:
          h
        case M.Chained{}:
          h
        case M.OnHop{}:
          h
        case M.Ended{}:
          h
        case M.Answered{}:
          h
        case M.Escalated{}:
          h

def j_answer(+q: M.Q, +h: T(J(q))) -> T(J(M.answer(q))):
  match q:
    case M.Qn{ph, o, +rest, +hops, b}:
      match ph:
        case M.NoQ{}:
          h
        case M.Chained{}:
          h
        case M.OnHop{}:
          h
        case M.Ended{}:
          h
        case M.Answered{}:
          h
        case M.Escalated{}:
          h

def j_reply(+q: M.Q, +h: T(J(q))) -> T(J(M.reply(q))):
  match q:
    case M.Qn{ph, o, +rest, +hops, b}:
      match ph:
        case M.NoQ{}:
          h
        case M.Chained{}:
          h
        case M.OnHop{}:
          h
        case M.Ended{}:
          h
        case M.Answered{}:
          h
        case M.Escalated{}:
          h

def j_escalate(+q: M.Q, +h: T(J(q))) -> T(J(M.escalate(q))):
  match q:
    case M.Qn{ph, o, +rest, +hops, b}:
      match ph:
        case M.NoQ{}:
          h
        case M.Chained{}:
          match rest:
            case Nil{}:
              h
            case Con{+x, +r}:
              h
        case M.OnHop{}:
          h
        case M.Ended{}:
          match rest:
            case Nil{}:
              h
            case Con{+x, +r}:
              h
        case M.Answered{}:
          h
        case M.Escalated{}:
          h

def j_hop_made(+q: M.Q, +h: T(J(q))) -> T(J(M.hop_made(q))):
  match q:
    case M.Qn{ph, o, +rest, +hops, b}:
      match ph:
        case M.NoQ{}:
          h
        case M.Chained{}:
          match rest:
            case Nil{}:
              h
            case Con{+x, +r}:
              jmk(x <> hops, r, o, and_i(Bool.not(M.mem(x, hops)), S.nodup(hops), and_l(Bool.not(M.mem(x, hops)), S.disjoint(r, hops), jc(hops, x <> r, o, h)), ja(hops, x <> r, o, h)), and_r(Bool.not(M.mem(x, r)), S.nodup(r), jb(hops, x <> r, o, h)), dj_cons(x, r, hops, and_l(Bool.not(M.mem(x, r)), S.nodup(r), jb(hops, x <> r, o, h)), and_r(Bool.not(M.mem(x, hops)), S.disjoint(r, hops), jc(hops, x <> r, o, h))), not_or_i(Nat.is_eq(o, x), M.mem(o, hops), not_or_l(Nat.is_eq(o, x), M.mem(o, r), je(hops, x <> r, o, h)), jd(hops, x <> r, o, h)), not_or_r(Nat.is_eq(o, x), M.mem(o, r), je(hops, x <> r, o, h)))
        case M.OnHop{}:
          h
        case M.Ended{}:
          match rest:
            case Nil{}:
              h
            case Con{+x, +r}:
              jmk(x <> hops, r, o, and_i(Bool.not(M.mem(x, hops)), S.nodup(hops), and_l(Bool.not(M.mem(x, hops)), S.disjoint(r, hops), jc(hops, x <> r, o, h)), ja(hops, x <> r, o, h)), and_r(Bool.not(M.mem(x, r)), S.nodup(r), jb(hops, x <> r, o, h)), dj_cons(x, r, hops, and_l(Bool.not(M.mem(x, r)), S.nodup(r), jb(hops, x <> r, o, h)), and_r(Bool.not(M.mem(x, hops)), S.disjoint(r, hops), jc(hops, x <> r, o, h))), not_or_i(Nat.is_eq(o, x), M.mem(o, hops), not_or_l(Nat.is_eq(o, x), M.mem(o, r), je(hops, x <> r, o, h)), jd(hops, x <> r, o, h)), not_or_r(Nat.is_eq(o, x), M.mem(o, r), je(hops, x <> r, o, h)))
        case M.Answered{}:
          h
        case M.Escalated{}:
          h

def j_ask(+o: Nat, +chain: +List<Nat>, +q: M.Q, +h: T(J(q))) -> T(J(M.ask(o, chain, q))):
  match q:
    case M.Qn{ph, o0, +rest, +hops, b}:
      match ph:
        case M.NoQ{}:
          jmk([], M.clean(o, chain), o, {==}, cN(o, chain), d0(M.clean(o, chain)), {==}, cB(o, chain))
        case M.Chained{}:
          h
        case M.OnHop{}:
          h
        case M.Ended{}:
          h
        case M.Answered{}:
          h
        case M.Escalated{}:
          h

def jq(e: M.Ev, +q: M.Q, +h: T(J(q))) -> T(J(M.qstep(e, q))):
  match e:
    case M.Send{fu, r}:
      h
    case M.Idle{}:
      h
    case M.Busy{}:
      h
    case M.Exit{}:
      h
    case M.TakeoverBegin{}:
      h
    case M.TakeoverEnd{}:
      h
    case M.UserInput{}:
      h
    case M.UserSubmit{}:
      h
    case M.UserClear{}:
      h
    case M.UserDeliver{id}:
      h
    case M.UserDrop{id}:
      h
    case M.Restart{alive}:
      h
    case M.Ask{o, chain}:
      j_ask(o, chain, q, h)
    case M.HopMade{}:
      j_hop_made(q, h)
    case M.HopEnded{}:
      j_ended(q, h)
    case M.BoundPassed{}:
      j_bound(q, h)
    case M.Answer{}:
      j_answer(q, h)
    case M.Escalate{}:
      j_escalate(q, h)
    case M.Reply{}:
      j_reply(q, h)

def jrun(+evs: +List<M.Ev>, +q: M.Q, +h: T(J(q))) -> T(J(M.qrun(evs, q))):
  match evs:
    case Nil{}:
      h
    case Con{e, +rest}:
      jrun(rest, M.qstep(e, q), jq(e, q, h))

def rd(+q: M.Q) -> M.Q:
  M.qstep(M.Escalate{}, M.qstep(M.BoundPassed{}, M.qstep(M.HopMade{}, q)))

def rd_settled(+q: M.Q, +h: T(S.settled(q))) -> T(S.settled(rd(q))):
  match q:
    case M.Qn{ph, o, +rest, +hops, b}:
      match ph:
        case M.NoQ{}:
          no(T(S.settled(rd(M.Qn{M.NoQ{}, o, rest, hops, b}))), h)
        case M.Chained{}:
          no(T(S.settled(rd(M.Qn{M.Chained{}, o, rest, hops, b}))), h)
        case M.OnHop{}:
          no(T(S.settled(rd(M.Qn{M.OnHop{}, o, rest, hops, b}))), h)
        case M.Ended{}:
          no(T(S.settled(rd(M.Qn{M.Ended{}, o, rest, hops, b}))), h)
        case M.Answered{}:
          {==}
        case M.Escalated{}:
          {==}

# A settled question stays settled under any number of rounds.
def ab(+n: Nat, +q: M.Q, +h: T(S.settled(q))) -> T(S.settled(M.qrun(S.qcycle(n), q))):
  match n:
    case 0n:
      h
    case 1n+p:
      ab(p, rd(q), rd_settled(q, h))

# A hop is live with r still to make: one round ends it, then as many rounds as hops are left.
def E_e(+r: +List<Nat>, +x: Nat, +o: Nat, +hops: +List<Nat>, +b: Nat) -> T(S.settled(M.qrun(S.qcycle(Nat.add(1n, S.len(r))), M.Qn{M.Ended{}, o, x <> r, hops, b}))):
  match r:
    case Nil{}:
      {==}
    case Con{+y, +r2}:
      E_e(r2, y, o, x <> hops, 1n+b)

def O(+r: +List<Nat>, +o: Nat, +hops: +List<Nat>, +b: Nat) -> T(S.settled(M.qrun(S.qcycle(Nat.add(1n, S.len(r))), M.Qn{M.OnHop{}, o, r, hops, b}))):
  match r:
    case Nil{}:
      {==}
    case Con{+x, +r2}:
      E_e(r2, x, o, hops, 1n+b)

def G_e(+r: +List<Nat>, +o: Nat, +hops: +List<Nat>, +b: Nat) -> T(S.settled(M.qrun(S.qcycle(Nat.add(1n, S.len(r))), M.Qn{M.Ended{}, o, r, hops, b}))):
  match r:
    case Nil{}:
      {==}
    case Con{+x, +r2}:
      match r2:
        case Nil{}:
          ab(1n, M.Qn{M.Escalated{}, o, [], x <> hops, 1n+b}, {==})
        case Con{+y, +r3}:
          G_e(y <> r3, o, x <> hops, 1n+b)

def G_c(+r: +List<Nat>, +o: Nat, +hops: +List<Nat>, +b: Nat) -> T(S.settled(M.qrun(S.qcycle(Nat.add(1n, S.len(r))), M.Qn{M.Chained{}, o, r, hops, b}))):
  match r:
    case Nil{}:
      {==}
    case Con{+x, +r2}:
      match r2:
        case Nil{}:
          ab(1n, M.Qn{M.Escalated{}, o, [], x <> hops, 1n+b}, {==})
        case Con{+y, +r3}:
          G_e(y <> r3, o, x <> hops, 1n+b)

def live(+q: M.Q) -> T(S.implies(Bool.not(S.is_noq(q)), S.settled(M.qrun(S.qcycle(Nat.add(1n, S.len(S.q_rest(q)))), q)))):
  match q:
    case M.Qn{ph, o, +rest, +hops, b}:
      match ph:
        case M.NoQ{}:
          {==}
        case M.Chained{}:
          G_c(rest, o, hops, b)
        case M.OnHop{}:
          O(rest, o, hops, b)
        case M.Ended{}:
          G_e(rest, o, hops, b)
        case M.Answered{}:
          ab(Nat.add(1n, S.len(rest)), M.Qn{M.Answered{}, o, rest, hops, b}, {==})
        case M.Escalated{}:
          ab(Nat.add(1n, S.len(rest)), M.Qn{M.Escalated{}, o, rest, hops, b}, {==})

def m8_q(+q: M.Q, +hj: T(J(q))) -> T(Bool.and(S.nodup(S.q_hops(q)), Bool.and(Bool.not(M.mem(S.q_origin(q), S.q_hops(q))), S.implies(Bool.not(S.is_noq(q)), S.settled(M.qrun(S.qcycle(Nat.add(1n, S.len(S.q_rest(q)))), q)))))):
  match q:
    case M.Qn{ph, o, +rest, +hops, b}:
      and_i(S.nodup(hops), Bool.and(Bool.not(M.mem(o, hops)), S.implies(Bool.not(S.is_noq(M.Qn{ph, o, rest, hops, b})), S.settled(M.qrun(S.qcycle(Nat.add(1n, S.len(rest))), M.Qn{ph, o, rest, hops, b})))), ja(hops, rest, o, hj), and_i(Bool.not(M.mem(o, hops)), S.implies(Bool.not(S.is_noq(M.Qn{ph, o, rest, hops, b})), S.settled(M.qrun(S.qcycle(Nat.add(1n, S.len(rest))), M.Qn{ph, o, rest, hops, b}))), jd(hops, rest, o, hj), live(M.Qn{ph, o, rest, hops, b})))

def m8_main(+evs: +List<M.Ev>) -> T(Bool.and(S.nodup(S.q_hops(S.qworld(evs))), Bool.and(Bool.not(M.mem(S.q_origin(S.qworld(evs)), S.q_hops(S.qworld(evs)))), S.implies(Bool.not(S.is_noq(S.qworld(evs))), S.settled(M.qrun(S.qcycle(Nat.add(1n, S.len(S.q_rest(S.qworld(evs))))), S.qworld(evs))))))):
  m8_q(S.qworld(evs), jrun(evs, M.qinit(), {==}))

def Laws.m8_escalation_terminates(evs):
  m8_main(evs)

# A35: safety/liveness of the reserved schedule is a refinement into existing proved steps.
# These quantify every before/during/after schedule, not a fixed example. Liveness requires
# coordinator release before the existing fair idle cycle; an indefinitely failed restart
# deliberately keeps pending work. No law or predicate above is weakened.
def a35_m1(+before: +List<M.Ev>, during: +List<M.Ev>, after: +List<M.Ev>) -> T(S.nodup(S.typed(S.world(M.restart_window(before, during, after))))):
  m1_main(M.restart_window(before, during, after))

def a35_m3(+before: +List<M.Ev>, +during: +List<M.Ev>, +after: +List<M.Ev>) -> T(S.all_in(S.tk_typed(S.world(M.restart_window(before, during, after))), S.released(S.world(M.restart_window(before, during, after))))):
  m3_main(M.restart_window(before, during, after))

def a35_reserved_stop(s: M.World) -> {S.records(M.step(M.restart_event(True{}, M.Exit{}), s)) == S.records(s) : S.Rec}:
  match s:
    case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
      {==}

def a35_reserved_reopen(s: M.World, alive: Bool) -> {S.records(M.step(M.restart_event(True{}, M.Restart{alive}), s)) == S.records(s) : S.Rec}:
  match s:
    case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
      {==}

def a35_prompt_record_is_idempotent(+j: M.PromptJournal) -> {M.record_prompt(M.record_prompt(j)) == M.record_prompt(j) : M.PromptJournal}:
  match j:
    case M.Journal{+record, +world}:
      match record:
        case M.Recorded{id}:
          {==}
        case M.Unrecorded{}:
          match world:
            case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
              {==}

def a35_m4(+before: +List<M.Ev>, +during: +List<M.Ev>, +after: +List<M.Ev>, e: M.Ev) -> T(S.is_prefix(S.typed(S.world(M.restart_window(before, during, after))), S.typed(M.step(e, S.world(M.restart_window(before, during, after)))))):
  m4_main(M.restart_window(before, during, after), e)

def a35_m5(+before: +List<M.Ev>, +during: +List<M.Ev>, +after: +List<M.Ev>) -> T(Bool.and(S.disjoint(S.typed(S.world(M.restart_window(before, during, after))), S.dropped(S.world(M.restart_window(before, during, after)))), Bool.and(S.disjoint(S.typed(S.world(M.restart_window(before, during, after))), S.queue(S.world(M.restart_window(before, during, after)))), Bool.and(S.disjoint(S.typed(S.world(M.restart_window(before, during, after))), S.held_af(S.world(M.restart_window(before, during, after)))), S.disjoint(S.typed(S.world(M.restart_window(before, during, after))), S.held_tk(S.world(M.restart_window(before, during, after)))))))):
  m5_main(M.restart_window(before, during, after))

def a35_m6(+before: +List<M.Ev>, +during: +List<M.Ev>, +after: +List<M.Ev>) -> EQ(SG(S.len(S.queue(S.world(M.restart_window(before, during, after)))), S.len(S.held_af(S.world(M.restart_window(before, during, after)))), S.len(S.held_tk(S.world(M.restart_window(before, during, after)))), S.len(S.typed(S.world(M.restart_window(before, during, after)))), S.len(S.dropped(S.world(M.restart_window(before, during, after))))), S.next_id(S.world(M.restart_window(before, during, after)))):
  m6_main(M.restart_window(before, during, after))

def a35_m7(+before: +List<M.Ev>, +during: +List<M.Ev>, +after: +List<M.Ev>, +fu: Bool, +r: M.Route) -> T(Bool.and(S.implies(S.gone(S.world(M.restart_window(before, during, after))), Bool.and(S.is_nil(S.queue(S.world(M.restart_window(before, during, after)))), S.is_nil(S.held_tk(S.world(M.restart_window(before, during, after)))))), S.implies(S.gone(S.world(M.restart_window(before, during, after))), Nat.is_eq(S.next_id(M.step(M.Send{fu, r}, S.world(M.restart_window(before, during, after)))), S.next_id(S.world(M.restart_window(before, during, after))))))):
  m7_main(M.restart_window(before, during, after), fu, r)

def a35_m10(+before: +List<M.Ev>, +during: +List<M.Ev>, +after: +List<M.Ev>) -> T(S.implies(Bool.not(S.gone(S.world(M.restart_window(before, during, after)))), S.is_nil(S.queue(M.run(S.cycle(S.len(S.queue(S.world(M.restart_window(before, during, after))))), S.world(M.restart_window(before, during, after))))))):
  m10_main(M.restart_window(before, during, after))

def a35_reserved_idle(s: M.World) -> {S.records(M.step(M.restart_event(True{}, M.Idle{}), s)) == S.records(s) : S.Rec}:
  match s:
    case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
      {==}

def a35_m9(+before: +List<M.Ev>, +during: +List<M.Ev>, +after: +List<M.Ev>, +alive: Bool) -> {S.records(M.step(M.Restart{alive}, S.world(M.restart_window(before, during, after)))) == S.replay(S.records(S.world(M.restart_window(before, during, after))), alive) : S.Rec}:
  restart_replay(alive, S.world(M.restart_window(before, during, after)))

def a35_m8(+before: +List<M.Ev>, +during: +List<M.Ev>, +after: +List<M.Ev>) -> T(Bool.and(S.nodup(S.q_hops(S.qworld(M.restart_window(before, during, after)))), Bool.and(Bool.not(M.mem(S.q_origin(S.qworld(M.restart_window(before, during, after))), S.q_hops(S.qworld(M.restart_window(before, during, after))))), S.implies(Bool.not(S.is_noq(S.qworld(M.restart_window(before, during, after)))), S.settled(M.qrun(S.qcycle(Nat.add(1n, S.len(S.q_rest(S.qworld(M.restart_window(before, during, after)))))), S.qworld(M.restart_window(before, during, after)))))))):
  m8_main(M.restart_window(before, during, after))

# Shared-id conservation for acknowledgement: one new delivered record and one new id.
def a35_sum_record(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +hs: T(SUMB(q, a, k, t, d, n))) -> T(SUMB(q, a, k, M.snoc(t, n), d, 1n+n)):
  eq_intro(SG(S.len(q), S.len(a), S.len(k), S.len(M.snoc(t, n)), S.len(d)), 1n+n, tr(SG(S.len(q), S.len(a), S.len(k), S.len(M.snoc(t, n)), S.len(d)), SG(S.len(q), S.len(a), S.len(k), 1n+S.len(t), S.len(d)), 1n+n, cgt(S.len(q), S.len(a), S.len(k), S.len(M.snoc(t, n)), 1n+S.len(t), S.len(d), len_snoc(t, n)), tr(SG(S.len(q), S.len(a), S.len(k), 1n+S.len(t), S.len(d)), 1n+SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), 1n+n, bt(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), sc(SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), n, eq_elim(SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), n, hs)))))

def a35_prompt_count(+j: M.PromptJournal) -> Bool:
  match j:
    case M.Journal{+record, +world}:
      SUMB(S.queue(world), S.held_af(world), S.held_tk(world), S.typed(world), S.dropped(world), S.next_id(world))

def a35_prompt_m6(+j: M.PromptJournal, +h: T(a35_prompt_count(j))) -> T(a35_prompt_count(M.record_prompt(j))):
  match j:
    case M.Journal{+record, +world}:
      match record:
        case M.Recorded{id}:
          h
        case M.Unrecorded{}:
          match world:
            case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
              a35_sum_record(q, haf, htk, t, d, n, h)

def a35_prompt_m1(+j: M.PromptJournal, +h: T(invw(M.journal_world(j)))) -> T(S.nodup(S.typed(M.journal_world(M.record_prompt(j))))):
  match j:
    case M.Journal{record, world}:
      match record:
        case M.Recorded{id}:
          match world:
            case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
              p3(q, haf, htk, t, d, n, h)
        case M.Unrecorded{}:
          match world:
            case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
              nd_snoc(t, n, p3(q, haf, htk, t, d, n, h), bd_fresh(t, n, p18(q, haf, htk, t, d, n, h)))

def a35_prompt_m4(+j: M.PromptJournal) -> T(S.is_prefix(S.typed(M.journal_world(j)), S.typed(M.journal_world(M.record_prompt(j))))):
  match j:
    case M.Journal{+record, +world}:
      match record:
        case M.Recorded{id}:
          prefix_refl(S.typed(world))
        case M.Unrecorded{}:
          match world:
            case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
              prefix_snoc(t, n)

def a35_prompt_disjoint_dropped(+j: M.PromptJournal, +h: T(invw(M.journal_world(j)))) -> T(S.disjoint(S.typed(M.journal_world(M.record_prompt(j))), S.dropped(M.journal_world(M.record_prompt(j))))):
  match j:
    case M.Journal{record, world}:
      match record:
        case M.Recorded{id}:
          match world:
            case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
              p14(q, haf, htk, t, d, n, h)
        case M.Unrecorded{}:
          match world:
            case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
              dj_snoc_l(t, d, n, p14(q, haf, htk, t, d, n, h), bd_fresh(d, n, p19(q, haf, htk, t, d, n, h)))

def a35_prompt_disjoint_queue(+j: M.PromptJournal, +h: T(invw(M.journal_world(j)))) -> T(S.disjoint(S.typed(M.journal_world(M.record_prompt(j))), S.queue(M.journal_world(M.record_prompt(j))))):
  match j:
    case M.Journal{record, world}:
      match record:
        case M.Recorded{id}:
          match world:
            case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
              dj_sym(q, t, p7(q, haf, htk, t, d, n, h))
        case M.Unrecorded{}:
          match world:
            case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
              dj_snoc_l(t, q, n, dj_sym(q, t, p7(q, haf, htk, t, d, n, h)), bd_fresh(q, n, p15(q, haf, htk, t, d, n, h)))

def a35_prompt_disjoint_ask_first(+j: M.PromptJournal, +h: T(invw(M.journal_world(j)))) -> T(S.disjoint(S.typed(M.journal_world(M.record_prompt(j))), S.held_af(M.journal_world(M.record_prompt(j))))):
  match j:
    case M.Journal{record, world}:
      match record:
        case M.Recorded{id}:
          match world:
            case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
              dj_sym(haf, t, p10(q, haf, htk, t, d, n, h))
        case M.Unrecorded{}:
          match world:
            case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
              dj_snoc_l(t, haf, n, dj_sym(haf, t, p10(q, haf, htk, t, d, n, h)), bd_fresh(haf, n, p16(q, haf, htk, t, d, n, h)))

def a35_prompt_disjoint_takeover(+j: M.PromptJournal, +h: T(invw(M.journal_world(j)))) -> T(S.disjoint(S.typed(M.journal_world(M.record_prompt(j))), S.held_tk(M.journal_world(M.record_prompt(j))))):
  match j:
    case M.Journal{record, world}:
      match record:
        case M.Recorded{id}:
          match world:
            case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
              dj_sym(htk, t, p12(q, haf, htk, t, d, n, h))
        case M.Unrecorded{}:
          match world:
            case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
              dj_snoc_l(t, htk, n, dj_sym(htk, t, p12(q, haf, htk, t, d, n, h)), bd_fresh(htk, n, p17(q, haf, htk, t, d, n, h)))

# M9 extended to the stored reservation frame: reserved records replay unchanged; outside
# the operation, the original M9 replay applies. The reservation itself cannot be lost.
def a35_store_reservation_replays(+s: M.ReservationStore, alive: Bool) -> {M.store_reserved(M.reopen_store(s, alive)) == M.store_reserved(s) : Bool}:
  match s:
    case M.Stored{+reserved, journal}:
      match journal:
        case M.Journal{record, world}:
          {==}

def a35_store_records_replay(reserved: Bool, r: S.Rec, alive: Bool) -> S.Rec:
  match reserved:
    case True{}:
      r
    case False{}:
      S.replay(r, alive)

def a35_store_m9(+reserved: Bool, +j: M.PromptJournal, +alive: Bool) -> {S.records(M.journal_world(M.store_journal(M.reopen_store(M.Stored{reserved, j}, alive)))) == a35_store_records_replay(reserved, S.records(M.journal_world(j)), alive) : S.Rec}:
  match reserved:
    case True{}:
      match j:
        case M.Journal{record, world}:
          match world:
            case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
              {==}
    case False{}:
      match j:
        case M.Journal{record, world}:
          restart_replay(alive, world)

# Retirement eligibility is explicit and independent of a lost Terminal or SessionStart.
# M7 still proves ordinary Exit drops its queue. A35 keeps archived pending in an ineligible
# receiver; M6/M10 liveness applies to eligible ordinary/released retained receivers.
def a35_retirement_ineligible(r: M.Retirement) -> {M.retirement_eligible(r) == False{} : Bool}:
  {==}

def a35_retirement_completion_idempotent(r: M.Retirement) -> {M.complete_retirement(M.complete_retirement(r)) == M.complete_retirement(r) : M.Retirement}:
  {==}

# M5/M6: stop, loss, reopen and rejected delivery preserve every status list and its order.
def a35_retirement_stop(r: M.Retirement, w: M.World) -> {S.records(M.step(M.retirement_event(r, M.Exit{}), w)) == S.records(w) : S.Rec}:
  match w:
    case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
      {==}

def a35_retirement_idle_never_types(r: M.Retirement, w: M.World) -> {S.typed(M.step(M.retirement_event(r, M.Idle{}), w)) == S.typed(w) : +List<Nat>}:
  match w:
    case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
      {==}

def a35_retirement_send_refused(r: M.Retirement, w: M.World, user: Bool, route: M.Route) -> {S.records(M.step(M.retirement_event(r, M.Send{user, route}), w)) == S.records(w) : S.Rec}:
  match w:
    case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
      {==}

def a35_retirement_manual_delivery_refused(r: M.Retirement, w: M.World, id: Nat) -> {S.records(M.step(M.retirement_event(r, M.UserDeliver{id}), w)) == S.records(w) : S.Rec}:
  match w:
    case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
      {==}

# M9: the SQLite retirement frame replays archived records, including after Rail removal.
def a35_retirement_reopen_records(s: M.RetirementStore) -> {S.records(M.retirement_world(M.reopen_retirement(s))) == S.records(M.retirement_world(s)) : S.Rec}:
  match s:
    case M.Retained{r, w}:
      match w:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          {==}

def a35_retirement_takeover_end_records(w: M.World) -> {S.records(M.retirement_takeover_end(w)) == S.records(w) : S.Rec}:
  match w:
    case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
      {==}

def a35_retirement_reopen_selection(s: M.RetirementStore) -> {M.retirement_state(M.reopen_retirement(s)) == M.retirement_state(s) : M.Retirement}:
  match s:
    case M.Retained{r, w}:
      match w:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +i, +g}:
          {==}
