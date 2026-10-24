import Base
import ./LAWS.bend as Laws
import ./model.bend as M
import ./spec.bend as S
import ./LIB.bend as L

# ---- M4

def prefix_refl(+l: +List<Nat>) -> L.T(S.is_prefix(l, l)):
  match l:
    case Nil{}:
      {==}
    case Con{+x, +rest}:
      L.and_i(Nat.is_eq(x, x), S.is_prefix(rest, rest), L.eq_refl(x), prefix_refl(rest))

def prefix_snoc(+l: +List<Nat>, +y: Nat) -> L.T(S.is_prefix(l, M.snoc(l, y))):
  match l:
    case Nil{}:
      {==}
    case Con{+x, +rest}:
      L.and_i(Nat.is_eq(x, x), S.is_prefix(rest, M.snoc(rest, y)), L.eq_refl(x), prefix_snoc(rest, y))

def prefix_drop(+l: +List<Nat>, +y: Nat, +m: +List<Nat>, +h: L.T(S.is_prefix(M.snoc(l, y), m))) -> L.T(S.is_prefix(l, m)):
  match l:
    case Nil{}:
      {==}
    case Con{+x, +rest}:
      match m:
        case Nil{}:
          L.no(L.T(S.is_prefix(x <> rest, [])), h)
        case Con{+z, +m2}:
          L.and_i(Nat.is_eq(x, z), S.is_prefix(rest, m2), L.and_l(Nat.is_eq(x, z), S.is_prefix(M.snoc(rest, y), m2), h), prefix_drop(rest, y, m2, L.and_r(Nat.is_eq(x, z), S.is_prefix(M.snoc(rest, y), m2), h)))

def fl_go4(+q: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +u: +List<Nat>, +n: Nat, +i: Bool, +g: Bool, +s0: +List<Nat>) -> L.T(S.is_prefix(t, S.typed(M.flush_go(q, M.W{s0, t, d, u, n, i, g})))):
  match q:
    case Nil{}:
      prefix_refl(t)
    case Con{+x, +rest}:
      prefix_drop(t, x, S.typed(M.flush_go(rest, M.W{[], M.snoc(t, x), d, u, n, False{}, g})), fl_go4(rest, M.snoc(t, x), d, u, n, False{}, g, []))

def fl4(+s: M.World) -> L.T(S.is_prefix(S.typed(s), S.typed(M.flush(s)))):
  match s:
    case M.W{+q, +t, +d, +u, +n, +i, +g}:
      match i:
        case False{}:
          prefix_refl(t)
        case True{}:
          fl_go4(q, t, d, u, n, True{}, g, [])

def send_auto4(fu: Bool, +s: M.World) -> L.T(S.is_prefix(S.typed(s), S.typed(M.send_auto(fu, s)))):
  match fu:
    case True{}:
      match s:
        case M.W{+q, +t, +d, +u, +n, +i, +g}:
          fl4(M.W{M.snoc(q, n), t, d, M.snoc(u, n), 1n+n, i, g})
    case False{}:
      match s:
        case M.W{+q, +t, +d, +u, +n, +i, +g}:
          fl4(M.W{M.snoc(q, n), t, d, u, 1n+n, i, g})

def send_ev4(fu: Bool, r: M.Route, +s: M.World) -> L.T(S.is_prefix(S.typed(s), S.typed(M.send_ev(fu, r, s)))):
  match r:
    case M.Auto{}:
      match s:
        case M.W{+q, +t, +d, +u, +n, +i, +g}:
          match g:
            case True{}:
              prefix_refl(t)
            case False{}:
              send_auto4(fu, M.W{q, t, d, u, n, i, False{}})
    case M.RouteDrop{}:
      match s:
        case M.W{+q, +t, +d, +u, +n, +i, +g}:
          match g:
            case True{}:
              prefix_refl(t)
            case False{}:
              prefix_refl(t)

def drop_q4(b: Bool, +id: Nat, +s: M.World) -> L.T(S.is_prefix(S.typed(s), S.typed(M.drop_q(b, id, s)))):
  match b:
    case False{}:
      match s:
        case M.W{+q, +t, +d, +u, +n, +i, +g}:
          prefix_refl(t)
    case True{}:
      match s:
        case M.W{+q, +t, +d, +u, +n, +i, +g}:
          prefix_refl(t)

def step4(e: M.Ev, +s: M.World) -> L.T(S.is_prefix(S.typed(s), S.typed(M.step(e, s)))):
  match e:
    case M.Send{fu, r}:
      send_ev4(fu, r, s)
    case M.Idle{}:
      match s:
        case M.W{+q, +t, +d, +u, +n, +i, +g}:
          match g:
            case True{}:
              prefix_refl(t)
            case False{}:
              fl4(M.W{q, t, d, u, n, True{}, False{}})
    case M.Busy{}:
      match s:
        case M.W{+q, +t, +d, +u, +n, +i, +g}:
          prefix_refl(t)
    case M.Exit{}:
      match s:
        case M.W{+q, +t, +d, +u, +n, +i, +g}:
          prefix_refl(t)
    case M.UserDrop{+id}:
      match s:
        case M.W{+q, +t, +d, +u, +n, +i, +g}:
          drop_q4(M.mem(id, q), id, M.W{q, t, d, u, n, i, g})
    case M.Restart{alive}:
      match alive:
        case True{}:
          match s:
            case M.W{+q, +t, +d, +u, +n, +i, +g}:
              prefix_refl(t)
        case False{}:
          match s:
            case M.W{+q, +t, +d, +u, +n, +i, +g}:
              prefix_refl(t)

def m4_main(+evs: +List<M.Ev>, e: M.Ev) -> L.T(S.is_prefix(S.typed(S.world(evs)), S.typed(M.step(e, S.world(evs))))):
  step4(e, S.world(evs))

def Laws.m4_typed_only_grows_at_the_end(evs, e):
  m4_main(evs, e)

# ---- M7

def G7(+s: M.World) -> Bool:
  S.implies(S.gone(s), S.is_nil(S.queue(s)))

def flush_go7(+q: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +u: +List<Nat>, +n: Nat, +i: Bool, +g: Bool, +hq: L.T(S.implies(g, S.is_nil(q)))) -> L.T(G7(M.flush_go(q, M.W{[], t, d, u, n, i, g}))):
  match q:
    case Nil{}:
      match g:
        case True{}:
          {==}
        case False{}:
          {==}
    case Con{+x, +rest}:
      match g:
        case True{}:
          L.no(L.T(G7(M.flush_go(x <> rest, M.W{[], t, d, u, n, i, True{}}))), hq)
        case False{}:
          flush_go7(rest, M.snoc(t, x), d, u, n, False{}, False{}, {==})

def flush7(+s: M.World, +h: L.T(G7(s))) -> L.T(G7(M.flush(s))):
  match s:
    case M.W{+q, +t, +d, +u, +n, +i, +g}:
      match i:
        case False{}:
          h
        case True{}:
          flush_go7(q, t, d, u, n, True{}, g, h)

def send_auto7(fu: Bool, +q: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +u: +List<Nat>, +n: Nat, +i: Bool) -> L.T(G7(M.send_auto(fu, M.W{q, t, d, u, n, i, False{}}))):
  match fu:
    case True{}:
      flush7(M.W{M.snoc(q, n), t, d, M.snoc(u, n), 1n+n, i, False{}}, {==})
    case False{}:
      flush7(M.W{M.snoc(q, n), t, d, u, 1n+n, i, False{}}, {==})

def send_ev7(fu: Bool, r: M.Route, +s: M.World, +h: L.T(G7(s))) -> L.T(G7(M.send_ev(fu, r, s))):
  match r:
    case M.Auto{}:
      match s:
        case M.W{+q, +t, +d, +u, +n, +i, +g}:
          match g:
            case True{}:
              h
            case False{}:
              send_auto7(fu, q, t, d, u, n, i)
    case M.RouteDrop{}:
      match s:
        case M.W{+q, +t, +d, +u, +n, +i, +g}:
          match g:
            case True{}:
              h
            case False{}:
              {==}

def drop_q7(b: Bool, +id: Nat, +s: M.World, +h: L.T(G7(s))) -> L.T(G7(M.drop_q(b, id, s))):
  match b:
    case False{}:
      h
    case True{}:
      match s:
        case M.W{+q, +t, +d, +u, +n, +i, +g}:
          match q:
            case Nil{}:
              h
            case Con{+y, +yr}:
              match g:
                case True{}:
                  L.no(L.T(G7(M.drop_q(True{}, id, M.W{y <> yr, t, d, u, n, i, True{}}))), h)
                case False{}:
                  {==}

def step7(e: M.Ev, +s: M.World, +h: L.T(G7(s))) -> L.T(G7(M.step(e, s))):
  match e:
    case M.Send{fu, r}:
      send_ev7(fu, r, s, h)
    case M.Idle{}:
      match s:
        case M.W{+q, +t, +d, +u, +n, +i, +g}:
          match g:
            case True{}:
              h
            case False{}:
              flush7(M.W{q, t, d, u, n, True{}, False{}}, {==})
    case M.Busy{}:
      match s:
        case M.W{+q, +t, +d, +u, +n, +i, +g}:
          h
    case M.Exit{}:
      match s:
        case M.W{+q, +t, +d, +u, +n, +i, +g}:
          {==}
    case M.UserDrop{+id}:
      match s:
        case M.W{+q, +t, +d, +u, +n, +i, +g}:
          drop_q7(M.mem(id, q), id, M.W{q, t, d, u, n, i, g}, h)
    case M.Restart{alive}:
      match alive:
        case True{}:
          match s:
            case M.W{+q, +t, +d, +u, +n, +i, +g}:
              h
        case False{}:
          match s:
            case M.W{+q, +t, +d, +u, +n, +i, +g}:
              {==}

def run7(+evs: +List<M.Ev>, +s: M.World, +h: L.T(G7(s))) -> L.T(G7(M.run(evs, s))):
  match evs:
    case Nil{}:
      h
    case Con{e, +rest}:
      run7(rest, M.step(e, s), step7(e, s, h))

def send_gone7(fu: Bool, r: M.Route, +s: M.World) -> L.T(S.implies(S.gone(s), Nat.is_eq(S.next_id(M.step(M.Send{fu, r}, s)), S.next_id(s)))):
  match r:
    case M.Auto{}:
      match s:
        case M.W{+q, +t, +d, +u, +n, +i, +g}:
          match g:
            case True{}:
              L.eq_refl(n)
            case False{}:
              {==}
    case M.RouteDrop{}:
      match s:
        case M.W{+q, +t, +d, +u, +n, +i, +g}:
          match g:
            case True{}:
              L.eq_refl(n)
            case False{}:
              {==}

def m7_main(+evs: +List<M.Ev>, +fu: Bool, +r: M.Route) -> L.T(Bool.and(S.implies(S.gone(S.world(evs)), S.is_nil(S.queue(S.world(evs)))), S.implies(S.gone(S.world(evs)), Nat.is_eq(S.next_id(M.step(M.Send{fu, r}, S.world(evs))), S.next_id(S.world(evs)))))):
  L.and_i(G7(S.world(evs)), S.implies(S.gone(S.world(evs)), Nat.is_eq(S.next_id(M.step(M.Send{fu, r}, S.world(evs))), S.next_id(S.world(evs)))), run7(evs, M.init(), {==}), send_gone7(fu, r, S.world(evs)))

def Laws.m7_receiver_gone(evs, fu, r):
  m7_main(evs, fu, r)

# ---- M10

def le_zero(p: Nat) -> L.T(Nat.is_le(0n, p)):
  match p:
    case 0n:
      {==}
    case 1n+pp:
      {==}

def le_refl(n: Nat) -> L.T(Nat.is_le(n, n)):
  match n:
    case 0n:
      {==}
    case 1n+p:
      le_refl(p)

def le0_nil(+l: +List<Nat>, +h: L.T(Nat.is_le(S.len(l), 0n))) -> L.T(S.is_nil(l)):
  match l:
    case Nil{}:
      {==}
    case Con{+x, +rest}:
      L.no(L.T(S.is_nil(x <> rest)), h)

def imp10(g: Bool, X: Bool, f: L.T(Bool.not(g)) -> L.T(X)) -> L.T(S.implies(Bool.not(g), X)):
  match g:
    case True{}:
      {==}
    case False{}:
      f({==})

def idle2(+s: M.World) -> M.World:
  M.step(M.Idle{}, M.step(M.Busy{}, s))

def fgo_alive10(+q: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +u: +List<Nat>, +n: Nat, +i: Bool) -> L.T(Bool.not(S.gone(M.flush_go(q, M.W{[], t, d, u, n, i, False{}})))):
  match q:
    case Nil{}:
      {==}
    case Con{+x, +rest}:
      fgo_alive10(rest, M.snoc(t, x), d, u, n, False{})

def fgo_empty10(p: Nat, +q: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +u: +List<Nat>, +n: Nat, +i: Bool, +g: Bool) -> L.T(Nat.is_le(S.len(S.queue(M.flush_go(q, M.W{[], t, d, u, n, i, g}))), p)):
  match q:
    case Nil{}:
      le_zero(p)
    case Con{+x, +rest}:
      fgo_empty10(p, rest, M.snoc(t, x), d, u, n, False{}, g)

def g10(+s: M.World, +hg: L.T(Bool.not(S.gone(s)))) -> L.T(Bool.not(S.gone(idle2(s)))):
  match s:
    case M.W{+q, +t, +d, +u, +n, +i, +g}:
      match q:
        case Nil{}:
          match g:
            case True{}:
              L.no(L.T(Bool.not(S.gone(idle2(M.W{[], t, d, u, n, i, True{}})))), hg)
            case False{}:
              {==}
        case Con{+x, +rest}:
          match g:
            case True{}:
              L.no(L.T(Bool.not(S.gone(idle2(M.W{x <> rest, t, d, u, n, i, True{}})))), hg)
            case False{}:
              fgo_alive10(rest, M.snoc(t, x), d, u, n, False{})

def k10(p: Nat, +s: M.World, +hg: L.T(Bool.not(S.gone(s))), +hk: L.T(Nat.is_le(S.len(S.queue(s)), 1n+p))) -> L.T(Nat.is_le(S.len(S.queue(idle2(s))), p)):
  match s:
    case M.W{+q, +t, +d, +u, +n, +i, +g}:
      match q:
        case Nil{}:
          match g:
            case True{}:
              L.no(L.T(Nat.is_le(S.len(S.queue(idle2(M.W{[], t, d, u, n, i, True{}}))), p)), hg)
            case False{}:
              le_zero(p)
        case Con{+x, +rest}:
          match g:
            case True{}:
              L.no(L.T(Nat.is_le(S.len(S.queue(idle2(M.W{x <> rest, t, d, u, n, i, True{}}))), p)), hg)
            case False{}:
              fgo_empty10(p, rest, M.snoc(t, x), d, u, n, False{}, False{})

def cyc10(+k: Nat, +s: M.World, +hg: L.T(Bool.not(S.gone(s))), +hk: L.T(Nat.is_le(S.len(S.queue(s)), k))) -> L.T(S.is_nil(S.queue(M.run(S.cycle(k), s)))):
  match k:
    case 0n:
      le0_nil(S.queue(s), hk)
    case 1n++p:
      cyc10(p, idle2(s), g10(s, hg), k10(p, s, hg, hk))

def m10_main(+evs: +List<M.Ev>) -> L.T(S.implies(Bool.not(S.gone(S.world(evs))), S.is_nil(S.queue(M.run(S.cycle(S.len(S.queue(S.world(evs)))), S.world(evs)))))):
  imp10(S.gone(S.world(evs)), S.is_nil(S.queue(M.run(S.cycle(S.len(S.queue(S.world(evs)))), S.world(evs)))), hg => cyc10(S.len(S.queue(S.world(evs))), S.world(evs), hg, le_refl(S.len(S.queue(S.world(evs))))))

def Laws.m10_pending_to_idle_is_eventually_typed(evs):
  m10_main(evs)

# ---- inv

def lt_ne(+x: Nat, +n: Nat, +h: L.T(Nat.is_lt(x, n))) -> L.T(Bool.not(Nat.is_eq(n, x))):
  match x n:
    case 0n 0n:
      L.no(L.T(Bool.not(Nat.is_eq(0n, 0n))), h)
    case 0n 1n+np:
      {==}
    case 1n+xp 0n:
      L.no(L.T(Bool.not(Nat.is_eq(0n, 1n+xp))), h)
    case 1n+xp 1n+np:
      lt_ne(xp, np, h)

def lt_succ(+x: Nat, +n: Nat, +h: L.T(Nat.is_lt(x, n))) -> L.T(Nat.is_lt(x, 1n+n)):
  match x n:
    case 0n 0n:
      L.no(L.T(Nat.is_lt(0n, 1n)), h)
    case 0n 1n+np:
      {==}
    case 1n+xp 0n:
      L.no(L.T(Nat.is_lt(1n+xp, 1n)), h)
    case 1n+xp 1n+np:
      lt_succ(xp, np, h)

def lt_new(+n: Nat) -> L.T(Nat.is_lt(n, 1n+n)):
  match n:
    case 0n:
      {==}
    case 1n+p:
      lt_new(p)

def NM(+x: Nat, +l: +List<Nat>) -> Data:
  L.T(Bool.not(M.mem(x, l)))

def nor_l(a: Bool, b: Bool, +h: L.T(Bool.not(Bool.or(a, b)))) -> L.T(Bool.not(a)):
  match a:
    case True{}:
      L.no(L.T(Bool.not(True{})), h)
    case False{}:
      {==}

def nor_r(a: Bool, b: Bool, +h: L.T(Bool.not(Bool.or(a, b)))) -> L.T(Bool.not(b)):
  match a:
    case True{}:
      L.no(L.T(Bool.not(b)), h)
    case False{}:
      h

def nor_i(a: Bool, b: Bool, +ha: L.T(Bool.not(a)), +hb: L.T(Bool.not(b))) -> L.T(Bool.not(Bool.or(a, b))):
  match a:
    case True{}:
      L.no(L.T(Bool.not(Bool.or(True{}, b))), ha)
    case False{}:
      hb

def ncase(m: Bool, +a: L.T(m), +b: L.T(Bool.not(m))) -> L.T(False{}):
  match m:
    case True{}:
      b
    case False{}:
      L.no(L.T(False{}), a)

def cp(m1: Bool, m2: Bool, f: L.T(m1) -> L.T(m2), +h: L.T(Bool.not(m2))) -> L.T(Bool.not(m1)):
  match m1:
    case True{}:
      L.no(L.T(Bool.not(True{})), ncase(m2, f({==}), h))
    case False{}:
      {==}

def eq_sym_b(+x: Nat, +y: Nat, +h: L.T(Nat.is_eq(x, y))) -> L.T(Nat.is_eq(y, x)):
  %L.eq_elim(x, y, h) : L.T(Nat.is_eq(_, x))
  L.eq_refl(x)

def ne_sym(+x: Nat, +y: Nat, +h: L.T(Bool.not(Nat.is_eq(x, y)))) -> L.T(Bool.not(Nat.is_eq(y, x))):
  cp(Nat.is_eq(y, x), Nat.is_eq(x, y), hh => eq_sym_b(y, x, hh), h)

def nm_sub(+x: Nat, +l: +List<Nat>, +m: +List<Nat>, +hs: L.T(S.all_in(l, m)), +h: NM(x, m)) -> NM(x, l):
  cp(M.mem(x, l), M.mem(x, m), hh => L.mem_all_in(x, l, m, hh, hs), h)

def nm_app(+x: Nat, +a: +List<Nat>, +b: +List<Nat>, +ha: NM(x, a), +hb: NM(x, b)) -> NM(x, List.append(&2, Nat, a, b)):
  match a:
    case Nil{}:
      hb
    case Con{+z, +rest}:
      nor_i(Nat.is_eq(x, z), M.mem(x, List.append(&2, Nat, rest, b)), nor_l(Nat.is_eq(x, z), M.mem(x, rest), ha), nm_app(x, rest, b, nor_r(Nat.is_eq(x, z), M.mem(x, rest), ha), hb))

def nm_snoc(+x: Nat, +l: +List<Nat>, +y: Nat, +hl: NM(x, l), +hy: L.T(Bool.not(Nat.is_eq(x, y)))) -> NM(x, M.snoc(l, y)):
  match l:
    case Nil{}:
      nor_i(Nat.is_eq(x, y), False{}, hy, {==})
    case Con{+z, +rest}:
      nor_i(Nat.is_eq(x, z), M.mem(x, M.snoc(rest, y)), nor_l(Nat.is_eq(x, z), M.mem(x, rest), hl), nm_snoc(x, rest, y, nor_r(Nat.is_eq(x, z), M.mem(x, rest), hl), hy))

def nm_cons(+x: Nat, +y: Nat, +l: +List<Nat>, +hy: L.T(Bool.not(Nat.is_eq(x, y))), +hl: NM(x, l)) -> NM(x, y <> l):
  nor_i(Nat.is_eq(x, y), M.mem(x, l), hy, hl)

def DJ(+a: +List<Nat>, +b: +List<Nat>) -> Data:
  L.T(S.disjoint(a, b))

def ND(+a: +List<Nat>) -> Data:
  L.T(S.nodup(a))

def nm_eq(+x: Nat, +z: Nat, +zs: +List<Nat>, +e: {x == z : Nat}, +h: NM(z, zs)) -> NM(x, zs):
  %Equal.sym(Nat, x, z, e) : NM(_, zs)
  h

def dj_hd(+x: Nat, +rest: +List<Nat>, +ys: +List<Nat>, +h: DJ(x <> rest, ys)) -> NM(x, ys):
  L.and_l(Bool.not(M.mem(x, ys)), S.disjoint(rest, ys), h)

def dj_tl(+x: Nat, +rest: +List<Nat>, +ys: +List<Nat>, +h: DJ(x <> rest, ys)) -> DJ(rest, ys):
  L.and_r(Bool.not(M.mem(x, ys)), S.disjoint(rest, ys), h)

def dj_cons_l(+x: Nat, +rest: +List<Nat>, +ys: +List<Nat>, +hx: NM(x, ys), +h: DJ(rest, ys)) -> DJ(x <> rest, ys):
  L.and_i(Bool.not(M.mem(x, ys)), S.disjoint(rest, ys), hx, h)

def dj_nm(+xs: +List<Nat>, +ys: +List<Nat>, +z: Nat, +hm: L.T(M.mem(z, xs)), +h: DJ(xs, ys)) -> NM(z, ys):
  match xs:
    case Nil{}:
      L.no(NM(z, ys), hm)
    case Con{+x, +rest}:
      L.or_elim(Bool.not(M.mem(z, ys)), Nat.is_eq(z, x), M.mem(z, rest), he => nm_eq(z, x, ys, L.eq_elim(z, x, he), dj_hd(x, rest, ys, h)), hr => dj_nm(rest, ys, z, hr, dj_tl(x, rest, ys, h)), hm)

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

def dj_sub_l(+a1: +List<Nat>, +a: +List<Nat>, +b: +List<Nat>, +hs: L.T(S.all_in(a1, a)), +h: DJ(a, b)) -> DJ(a1, b):
  match a1:
    case Nil{}:
      {==}
    case Con{+x, +rest}:
      dj_cons_l(x, rest, b, dj_nm(a, b, x, L.and_l(M.mem(x, a), S.all_in(rest, a), hs), h), dj_sub_l(rest, a, b, L.and_r(M.mem(x, a), S.all_in(rest, a), hs), h))

def nd_hd(+x: Nat, +rest: +List<Nat>, +h: ND(x <> rest)) -> NM(x, rest):
  L.and_l(Bool.not(M.mem(x, rest)), S.nodup(rest), h)

def nd_tl(+x: Nat, +rest: +List<Nat>, +h: ND(x <> rest)) -> ND(rest):
  L.and_r(Bool.not(M.mem(x, rest)), S.nodup(rest), h)

def nd_cons(+x: Nat, +rest: +List<Nat>, +hx: NM(x, rest), +h: ND(rest)) -> ND(x <> rest):
  L.and_i(Bool.not(M.mem(x, rest)), S.nodup(rest), hx, h)

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

def rs_nm(b: Bool, +x: Nat, +y: Nat, +tail: +List<Nat>, +hn: NM(x, tail), hb: L.T(Bool.not(b)) -> L.T(Bool.not(Nat.is_eq(x, y)))) -> NM(x, M.remove_step(b, y, tail)):
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
      rs_nd(Nat.is_eq(x, y), y, M.remove(x, rest), nm_sub(y, M.remove(x, rest), rest, L.rm_sub(x, rest), nd_hd(y, rest, h)), nd_remove(x, rest, nd_tl(y, rest, h)))

def bd(+l: +List<Nat>, +n: Nat) -> Bool:
  match l:
    case Nil{}:
      True{}
    case Con{+x, +rest}:
      Bool.and(Nat.is_lt(x, n), bd(rest, n))

def BD(+l: +List<Nat>, +n: Nat) -> Data:
  L.T(bd(l, n))

def lt_eq(+x: Nat, +y: Nat, +n: Nat, +e: {x == y : Nat}, +h: L.T(Nat.is_lt(y, n))) -> L.T(Nat.is_lt(x, n)):
  %Equal.sym(Nat, x, y, e) : L.T(Nat.is_lt(_, n))
  h

def bd_hd(+x: Nat, +rest: +List<Nat>, +n: Nat, +h: BD(x <> rest, n)) -> L.T(Nat.is_lt(x, n)):
  L.and_l(Nat.is_lt(x, n), bd(rest, n), h)

def bd_tl(+x: Nat, +rest: +List<Nat>, +n: Nat, +h: BD(x <> rest, n)) -> BD(rest, n):
  L.and_r(Nat.is_lt(x, n), bd(rest, n), h)

def bd_cons(+x: Nat, +rest: +List<Nat>, +n: Nat, +hx: L.T(Nat.is_lt(x, n)), +h: BD(rest, n)) -> BD(x <> rest, n):
  L.and_i(Nat.is_lt(x, n), bd(rest, n), hx, h)

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

def bd_mem(+m: +List<Nat>, +n: Nat, +x: Nat, +hm: L.T(M.mem(x, m)), +h: BD(m, n)) -> L.T(Nat.is_lt(x, n)):
  match m:
    case Nil{}:
      L.no(L.T(Nat.is_lt(x, n)), hm)
    case Con{+y, +rest}:
      L.or_elim(Nat.is_lt(x, n), Nat.is_eq(x, y), M.mem(x, rest), he => lt_eq(x, y, n, L.eq_elim(x, y, he), bd_hd(y, rest, n, h)), hr => bd_mem(rest, n, x, hr, bd_tl(y, rest, n, h)), hm)

def bd_sub(+l: +List<Nat>, +m: +List<Nat>, +n: Nat, +hs: L.T(S.all_in(l, m)), +h: BD(m, n)) -> BD(l, n):
  match l:
    case Nil{}:
      {==}
    case Con{+x, +rest}:
      bd_cons(x, rest, n, bd_mem(m, n, x, L.and_l(M.mem(x, m), S.all_in(rest, m), hs), h), bd_sub(rest, m, n, L.and_r(M.mem(x, m), S.all_in(rest, m), hs), h))

def bd_snoc(+l: +List<Nat>, +y: Nat, +n: Nat, +h: BD(l, n), +hy: L.T(Nat.is_lt(y, n))) -> BD(M.snoc(l, y), n):
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

def eq_intro(+x: Nat, +y: Nat, +e: EQ(x, y)) -> L.T(Nat.is_eq(x, y)):
  %e : L.T(Nat.is_eq(x, _))
  L.eq_refl(x)

def cgq(+x: Nat, +y: Nat, +la: Nat, +lk: Nat, +lt: Nat, +ld: Nat, +e: EQ(x, y)) -> EQ(SG(x, la, lk, lt, ld), SG(y, la, lk, lt, ld)):
  Equal.cong(Nat, Nat, v => SG(v, la, lk, lt, ld), x, y, e)

def cgt(+lq: Nat, +la: Nat, +lk: Nat, +x: Nat, +y: Nat, +ld: Nat, +e: EQ(x, y)) -> EQ(SG(lq, la, lk, x, ld), SG(lq, la, lk, y, ld)):
  Equal.cong(Nat, Nat, v => SG(lq, la, lk, v, ld), x, y, e)

def cgd(+lq: Nat, +la: Nat, +lk: Nat, +lt: Nat, +x: Nat, +y: Nat, +e: EQ(x, y)) -> EQ(SG(lq, la, lk, lt, x), SG(lq, la, lk, lt, y)):
  Equal.cong(Nat, Nat, v => SG(lq, la, lk, lt, v), x, y, e)

def bq(+lq: Nat, +la: Nat, +lk: Nat, +lt: Nat, +ld: Nat) -> EQ(SG(1n+lq, la, lk, lt, ld), 1n+SG(lq, la, lk, lt, ld)):
  {==}

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

def ra_step(b: Bool, +y: Nat, +rest: +List<Nat>, +tail: +List<Nat>, +hnb: L.T(Bool.not(b)), +ht: EQ(S.len(tail), S.len(rest))) -> EQ(S.len(M.remove_step(b, y, tail)), S.len(y <> rest)):
  match b:
    case True{}:
      L.no(EQ(S.len(M.remove_step(True{}, y, tail)), S.len(y <> rest)), hnb)
    case False{}:
      sc(S.len(tail), S.len(rest), ht)

def len_rm_absent(+id: Nat, +l: +List<Nat>, +h: NM(id, l)) -> EQ(S.len(M.remove(id, l)), S.len(l)):
  match l:
    case Nil{}:
      {==}
    case Con{+y, +rest}:
      ra_step(Nat.is_eq(id, y), y, rest, M.remove(id, rest), nor_l(Nat.is_eq(id, y), M.mem(id, rest), h), len_rm_absent(id, rest, nor_r(Nat.is_eq(id, y), M.mem(id, rest), h)))

def rm_len_step(b: Bool, +y: Nat, +rest: +List<Nat>, +tail: +List<Nat>, m: Bool, +hm: L.T(Bool.or(b, m)), hT: L.T(b) -> EQ(S.len(rest), S.len(tail)), hF: L.T(m) -> EQ(S.len(rest), 1n+S.len(tail))) -> EQ(S.len(y <> rest), 1n+S.len(M.remove_step(b, y, tail))):
  match b:
    case True{}:
      sc(S.len(rest), S.len(tail), hT({==}))
    case False{}:
      sc(S.len(rest), 1n+S.len(tail), hF(hm))

def len_rm(+id: Nat, +l: +List<Nat>, +hm: L.T(M.mem(id, l)), +hn: ND(l)) -> EQ(S.len(l), 1n+S.len(M.remove(id, l))):
  match l:
    case Nil{}:
      L.no(EQ(S.len([]), 1n+S.len(M.remove(id, []))), hm)
    case Con{+y, +rest}:
      rm_len_step(Nat.is_eq(id, y), y, rest, M.remove(id, rest), M.mem(id, rest), hm, he => sy(S.len(M.remove(id, rest)), S.len(rest), len_rm_absent(id, rest, nm_eq(id, y, rest, L.eq_elim(id, y, he), nd_hd(y, rest, hn)))), hr => len_rm(id, rest, hr, nd_tl(y, rest, hn)))

def shq(+lq: Nat, +la: Nat, +lk: Nat, +lt: Nat, +ld: Nat, +z: Nat) -> EQ(SG(Nat.add(lq, z), la, lk, lt, ld), Nat.add(z, SG(lq, la, lk, lt, ld))):
  tr(SG(Nat.add(lq, z), la, lk, lt, ld), 1n+Nat.add(z, Nat.add(lq, Nat.add(la, Nat.add(lk, Nat.add(lt, ld))))), Nat.add(z, SG(lq, la, lk, lt, ld)), sc(Nat.add(Nat.add(lq, z), Nat.add(la, Nat.add(lk, Nat.add(lt, ld)))), Nat.add(z, Nat.add(lq, Nat.add(la, Nat.add(lk, Nat.add(lt, ld))))), tr(Nat.add(Nat.add(lq, z), Nat.add(la, Nat.add(lk, Nat.add(lt, ld)))), Nat.add(lq, Nat.add(z, Nat.add(la, Nat.add(lk, Nat.add(lt, ld))))), Nat.add(z, Nat.add(lq, Nat.add(la, Nat.add(lk, Nat.add(lt, ld))))), add_assoc(lq, z, Nat.add(la, Nat.add(lk, Nat.add(lt, ld)))), swp(lq, z, Nat.add(la, Nat.add(lk, Nat.add(lt, ld)))))), sy(Nat.add(z, 1n+Nat.add(lq, Nat.add(la, Nat.add(lk, Nat.add(lt, ld))))), 1n+Nat.add(z, Nat.add(lq, Nat.add(la, Nat.add(lk, Nat.add(lt, ld))))), add_succ_r(z, Nat.add(lq, Nat.add(la, Nat.add(lk, Nat.add(lt, ld)))))))

def shk(+lq: Nat, +la: Nat, +lk: Nat, +lt: Nat, +ld: Nat, +z: Nat) -> EQ(SG(lq, la, Nat.add(lk, z), lt, ld), Nat.add(z, SG(lq, la, lk, lt, ld))):
  tr(SG(lq, la, Nat.add(lk, z), lt, ld), 1n+Nat.add(z, Nat.add(lq, Nat.add(la, Nat.add(lk, Nat.add(lt, ld))))), Nat.add(z, SG(lq, la, lk, lt, ld)), sc(Nat.add(lq, Nat.add(la, Nat.add(Nat.add(lk, z), Nat.add(lt, ld)))), Nat.add(z, Nat.add(lq, Nat.add(la, Nat.add(lk, Nat.add(lt, ld))))), tr(Nat.add(lq, Nat.add(la, Nat.add(Nat.add(lk, z), Nat.add(lt, ld)))), Nat.add(lq, Nat.add(z, Nat.add(la, Nat.add(lk, Nat.add(lt, ld))))), Nat.add(z, Nat.add(lq, Nat.add(la, Nat.add(lk, Nat.add(lt, ld))))), ar(lq, Nat.add(la, Nat.add(Nat.add(lk, z), Nat.add(lt, ld))), Nat.add(z, Nat.add(la, Nat.add(lk, Nat.add(lt, ld)))), tr(Nat.add(la, Nat.add(Nat.add(lk, z), Nat.add(lt, ld))), Nat.add(la, Nat.add(z, Nat.add(lk, Nat.add(lt, ld)))), Nat.add(z, Nat.add(la, Nat.add(lk, Nat.add(lt, ld)))), ar(la, Nat.add(Nat.add(lk, z), Nat.add(lt, ld)), Nat.add(z, Nat.add(lk, Nat.add(lt, ld))), tr(Nat.add(Nat.add(lk, z), Nat.add(lt, ld)), Nat.add(lk, Nat.add(z, Nat.add(lt, ld))), Nat.add(z, Nat.add(lk, Nat.add(lt, ld))), add_assoc(lk, z, Nat.add(lt, ld)), swp(lk, z, Nat.add(lt, ld)))), swp(la, z, Nat.add(lk, Nat.add(lt, ld))))), swp(lq, z, Nat.add(la, Nat.add(lk, Nat.add(lt, ld)))))), sy(Nat.add(z, 1n+Nat.add(lq, Nat.add(la, Nat.add(lk, Nat.add(lt, ld))))), 1n+Nat.add(z, Nat.add(lq, Nat.add(la, Nat.add(lk, Nat.add(lt, ld))))), add_succ_r(z, Nat.add(lq, Nat.add(la, Nat.add(lk, Nat.add(lt, ld)))))))

def shd(+lq: Nat, +la: Nat, +lk: Nat, +lt: Nat, +ld: Nat, +z: Nat) -> EQ(SG(lq, la, lk, lt, Nat.add(ld, z)), Nat.add(z, SG(lq, la, lk, lt, ld))):
  tr(SG(lq, la, lk, lt, Nat.add(ld, z)), 1n+Nat.add(z, Nat.add(lq, Nat.add(la, Nat.add(lk, Nat.add(lt, ld))))), Nat.add(z, SG(lq, la, lk, lt, ld)), sc(Nat.add(lq, Nat.add(la, Nat.add(lk, Nat.add(lt, Nat.add(ld, z))))), Nat.add(z, Nat.add(lq, Nat.add(la, Nat.add(lk, Nat.add(lt, ld))))), tr(Nat.add(lq, Nat.add(la, Nat.add(lk, Nat.add(lt, Nat.add(ld, z))))), Nat.add(lq, Nat.add(z, Nat.add(la, Nat.add(lk, Nat.add(lt, ld))))), Nat.add(z, Nat.add(lq, Nat.add(la, Nat.add(lk, Nat.add(lt, ld))))), ar(lq, Nat.add(la, Nat.add(lk, Nat.add(lt, Nat.add(ld, z)))), Nat.add(z, Nat.add(la, Nat.add(lk, Nat.add(lt, ld)))), tr(Nat.add(la, Nat.add(lk, Nat.add(lt, Nat.add(ld, z)))), Nat.add(la, Nat.add(z, Nat.add(lk, Nat.add(lt, ld)))), Nat.add(z, Nat.add(la, Nat.add(lk, Nat.add(lt, ld)))), ar(la, Nat.add(lk, Nat.add(lt, Nat.add(ld, z))), Nat.add(z, Nat.add(lk, Nat.add(lt, ld))), tr(Nat.add(lk, Nat.add(lt, Nat.add(ld, z))), Nat.add(lk, Nat.add(z, Nat.add(lt, ld))), Nat.add(z, Nat.add(lk, Nat.add(lt, ld))), ar(lk, Nat.add(lt, Nat.add(ld, z)), Nat.add(z, Nat.add(lt, ld)), tr(Nat.add(lt, Nat.add(ld, z)), Nat.add(lt, Nat.add(z, ld)), Nat.add(z, Nat.add(lt, ld)), ar(lt, Nat.add(ld, z), Nat.add(z, ld), add_comm(ld, z)), swp(lt, z, ld))), swp(lk, z, Nat.add(lt, ld)))), swp(la, z, Nat.add(lk, Nat.add(lt, ld))))), swp(lq, z, Nat.add(la, Nat.add(lk, Nat.add(lt, ld)))))), sy(Nat.add(z, 1n+Nat.add(lq, Nat.add(la, Nat.add(lk, Nat.add(lt, ld))))), 1n+Nat.add(z, Nat.add(lq, Nat.add(la, Nat.add(lk, Nat.add(lt, ld))))), add_succ_r(z, Nat.add(lq, Nat.add(la, Nat.add(lk, Nat.add(lt, ld)))))))

def sm_sendQ(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +hs: L.T(SUMB(q, a, k, t, d, n))) -> L.T(SUMB(M.snoc(q, n), a, k, t, d, 1n+n)):
  eq_intro(SG(S.len(M.snoc(q, n)), S.len(a), S.len(k), S.len(t), S.len(d)), 1n+n, tr(SG(S.len(M.snoc(q, n)), S.len(a), S.len(k), S.len(t), S.len(d)), SG(1n+S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), 1n+n, cgq(S.len(M.snoc(q, n)), 1n+S.len(q), S.len(a), S.len(k), S.len(t), S.len(d), len_snoc(q, n)), tr(SG(1n+S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), 1n+SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), 1n+n, bq(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), sc(SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), n, L.eq_elim(SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), n, hs)))))

def sm_sendD(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +hs: L.T(SUMB(q, a, k, t, d, n))) -> L.T(SUMB(q, a, k, t, M.snoc(d, n), 1n+n)):
  eq_intro(SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(M.snoc(d, n))), 1n+n, tr(SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(M.snoc(d, n))), SG(S.len(q), S.len(a), S.len(k), S.len(t), 1n+S.len(d)), 1n+n, cgd(S.len(q), S.len(a), S.len(k), S.len(t), S.len(M.snoc(d, n)), 1n+S.len(d), len_snoc(d, n)), tr(SG(S.len(q), S.len(a), S.len(k), S.len(t), 1n+S.len(d)), 1n+SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), 1n+n, bdd(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), sc(SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), n, L.eq_elim(SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), n, hs)))))

def sm_mv(+x: Nat, +r: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +hs: L.T(SUMB(x <> r, a, k, t, d, n))) -> L.T(SUMB(r, a, k, M.snoc(t, x), d, n)):
  eq_intro(SG(S.len(r), S.len(a), S.len(k), S.len(M.snoc(t, x)), S.len(d)), n, tr(SG(S.len(r), S.len(a), S.len(k), S.len(M.snoc(t, x)), S.len(d)), SG(S.len(r), S.len(a), S.len(k), 1n+S.len(t), S.len(d)), n, cgt(S.len(r), S.len(a), S.len(k), S.len(M.snoc(t, x)), 1n+S.len(t), S.len(d), len_snoc(t, x)), tr(SG(S.len(r), S.len(a), S.len(k), 1n+S.len(t), S.len(d)), 1n+SG(S.len(r), S.len(a), S.len(k), S.len(t), S.len(d)), n, bt(S.len(r), S.len(a), S.len(k), S.len(t), S.len(d)), tr(1n+SG(S.len(r), S.len(a), S.len(k), S.len(t), S.len(d)), SG(1n+S.len(r), S.len(a), S.len(k), S.len(t), S.len(d)), n, sy(SG(1n+S.len(r), S.len(a), S.len(k), S.len(t), S.len(d)), 1n+SG(S.len(r), S.len(a), S.len(k), S.len(t), S.len(d)), bq(S.len(r), S.len(a), S.len(k), S.len(t), S.len(d))), L.eq_elim(SG(S.len(x <> r), S.len(a), S.len(k), S.len(t), S.len(d)), n, hs)))))

def sm_te(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +hs: L.T(SUMB(q, a, k, t, d, n))) -> L.T(SUMB(List.append(&2, Nat, q, k), a, [], t, d, n)):
  eq_intro(SG(S.len(List.append(&2, Nat, q, k)), S.len(a), S.len([]), S.len(t), S.len(d)), n, tr(SG(S.len(List.append(&2, Nat, q, k)), S.len(a), 0n, S.len(t), S.len(d)), Nat.add(S.len(k), SG(S.len(q), S.len(a), 0n, S.len(t), S.len(d))), n, tr(SG(S.len(List.append(&2, Nat, q, k)), S.len(a), 0n, S.len(t), S.len(d)), SG(Nat.add(S.len(q), S.len(k)), S.len(a), 0n, S.len(t), S.len(d)), Nat.add(S.len(k), SG(S.len(q), S.len(a), 0n, S.len(t), S.len(d))), cgq(S.len(List.append(&2, Nat, q, k)), Nat.add(S.len(q), S.len(k)), S.len(a), 0n, S.len(t), S.len(d), len_app(q, k)), shq(S.len(q), S.len(a), 0n, S.len(t), S.len(d), S.len(k))), tr(Nat.add(S.len(k), SG(S.len(q), S.len(a), 0n, S.len(t), S.len(d))), SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), n, sy(SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), Nat.add(S.len(k), SG(S.len(q), S.len(a), 0n, S.len(t), S.len(d))), shk(S.len(q), S.len(a), 0n, S.len(t), S.len(d), S.len(k))), L.eq_elim(SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), n, hs))))

def sm_ex(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +hs: L.T(SUMB(q, a, k, t, d, n))) -> L.T(SUMB([], a, [], t, List.append(&2, Nat, d, List.append(&2, Nat, q, k)), n)):
  eq_intro(SG(S.len([]), S.len(a), S.len([]), S.len(t), S.len(List.append(&2, Nat, d, List.append(&2, Nat, q, k)))), n, tr(SG(0n, S.len(a), 0n, S.len(t), S.len(List.append(&2, Nat, d, List.append(&2, Nat, q, k)))), Nat.add(Nat.add(S.len(q), S.len(k)), SG(0n, S.len(a), 0n, S.len(t), S.len(d))), n, tr(SG(0n, S.len(a), 0n, S.len(t), S.len(List.append(&2, Nat, d, List.append(&2, Nat, q, k)))), SG(0n, S.len(a), 0n, S.len(t), Nat.add(S.len(d), Nat.add(S.len(q), S.len(k)))), Nat.add(Nat.add(S.len(q), S.len(k)), SG(0n, S.len(a), 0n, S.len(t), S.len(d))), cgd(0n, S.len(a), 0n, S.len(t), S.len(List.append(&2, Nat, d, List.append(&2, Nat, q, k))), Nat.add(S.len(d), Nat.add(S.len(q), S.len(k))), tr(S.len(List.append(&2, Nat, d, List.append(&2, Nat, q, k))), Nat.add(S.len(d), S.len(List.append(&2, Nat, q, k))), Nat.add(S.len(d), Nat.add(S.len(q), S.len(k))), len_app(d, List.append(&2, Nat, q, k)), ar(S.len(d), S.len(List.append(&2, Nat, q, k)), Nat.add(S.len(q), S.len(k)), len_app(q, k)))), shd(0n, S.len(a), 0n, S.len(t), S.len(d), Nat.add(S.len(q), S.len(k)))), tr(Nat.add(Nat.add(S.len(q), S.len(k)), SG(0n, S.len(a), 0n, S.len(t), S.len(d))), SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), n, tr(Nat.add(Nat.add(S.len(q), S.len(k)), SG(0n, S.len(a), 0n, S.len(t), S.len(d))), Nat.add(S.len(q), Nat.add(S.len(k), SG(0n, S.len(a), 0n, S.len(t), S.len(d)))), SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), add_assoc(S.len(q), S.len(k), SG(0n, S.len(a), 0n, S.len(t), S.len(d))), sy(SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), Nat.add(S.len(q), Nat.add(S.len(k), SG(0n, S.len(a), 0n, S.len(t), S.len(d)))), tr(SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), Nat.add(S.len(q), SG(0n, S.len(a), S.len(k), S.len(t), S.len(d))), Nat.add(S.len(q), Nat.add(S.len(k), SG(0n, S.len(a), 0n, S.len(t), S.len(d)))), shq(0n, S.len(a), S.len(k), S.len(t), S.len(d), S.len(q)), ar(S.len(q), SG(0n, S.len(a), S.len(k), S.len(t), S.len(d)), Nat.add(S.len(k), SG(0n, S.len(a), 0n, S.len(t), S.len(d))), shk(0n, S.len(a), 0n, S.len(t), S.len(d), S.len(k)))))), L.eq_elim(SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), n, hs))))

def sm_rq(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +id: Nat, +hm: L.T(M.mem(id, q)), +hn: ND(q), +hs: L.T(SUMB(q, a, k, t, d, n))) -> L.T(SUMB(M.remove(id, q), a, k, t, M.snoc(d, id), n)):
  eq_intro(SG(S.len(M.remove(id, q)), S.len(a), S.len(k), S.len(t), S.len(M.snoc(d, id))), n, tr(SG(S.len(M.remove(id, q)), S.len(a), S.len(k), S.len(t), S.len(M.snoc(d, id))), 1n+SG(S.len(M.remove(id, q)), S.len(a), S.len(k), S.len(t), S.len(d)), n, tr(SG(S.len(M.remove(id, q)), S.len(a), S.len(k), S.len(t), S.len(M.snoc(d, id))), SG(S.len(M.remove(id, q)), S.len(a), S.len(k), S.len(t), 1n+S.len(d)), 1n+SG(S.len(M.remove(id, q)), S.len(a), S.len(k), S.len(t), S.len(d)), cgd(S.len(M.remove(id, q)), S.len(a), S.len(k), S.len(t), S.len(M.snoc(d, id)), 1n+S.len(d), len_snoc(d, id)), bdd(S.len(M.remove(id, q)), S.len(a), S.len(k), S.len(t), S.len(d))), tr(1n+SG(S.len(M.remove(id, q)), S.len(a), S.len(k), S.len(t), S.len(d)), SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), n, sy(SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), 1n+SG(S.len(M.remove(id, q)), S.len(a), S.len(k), S.len(t), S.len(d)), tr(SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), SG(1n+S.len(M.remove(id, q)), S.len(a), S.len(k), S.len(t), S.len(d)), 1n+SG(S.len(M.remove(id, q)), S.len(a), S.len(k), S.len(t), S.len(d)), cgq(S.len(q), 1n+S.len(M.remove(id, q)), S.len(a), S.len(k), S.len(t), S.len(d), len_rm(id, q, hm, hn)), bq(S.len(M.remove(id, q)), S.len(a), S.len(k), S.len(t), S.len(d)))), L.eq_elim(SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), n, hs))))

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

def r0(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: L.T(IV0(q, a, k, t, d, n))) -> L.T(IV1(q, a, k, t, d, n)):
  L.and_r(S.nodup(q), IV1(q, a, k, t, d, n), h)

def l0(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: L.T(IV0(q, a, k, t, d, n))) -> L.T(S.nodup(q)):
  L.and_l(S.nodup(q), IV1(q, a, k, t, d, n), h)

def m0(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +x: L.T(S.nodup(q)), +rest: L.T(IV1(q, a, k, t, d, n))) -> L.T(IV0(q, a, k, t, d, n)):
  L.and_i(S.nodup(q), IV1(q, a, k, t, d, n), x, rest)

def r1(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: L.T(IV1(q, a, k, t, d, n))) -> L.T(IV2(q, a, k, t, d, n)):
  L.and_r(S.nodup(a), IV2(q, a, k, t, d, n), h)

def l1(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: L.T(IV1(q, a, k, t, d, n))) -> L.T(S.nodup(a)):
  L.and_l(S.nodup(a), IV2(q, a, k, t, d, n), h)

def m1(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +x: L.T(S.nodup(a)), +rest: L.T(IV2(q, a, k, t, d, n))) -> L.T(IV1(q, a, k, t, d, n)):
  L.and_i(S.nodup(a), IV2(q, a, k, t, d, n), x, rest)

def r2(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: L.T(IV2(q, a, k, t, d, n))) -> L.T(IV3(q, a, k, t, d, n)):
  L.and_r(S.nodup(k), IV3(q, a, k, t, d, n), h)

def l2(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: L.T(IV2(q, a, k, t, d, n))) -> L.T(S.nodup(k)):
  L.and_l(S.nodup(k), IV3(q, a, k, t, d, n), h)

def m2(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +x: L.T(S.nodup(k)), +rest: L.T(IV3(q, a, k, t, d, n))) -> L.T(IV2(q, a, k, t, d, n)):
  L.and_i(S.nodup(k), IV3(q, a, k, t, d, n), x, rest)

def r3(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: L.T(IV3(q, a, k, t, d, n))) -> L.T(IV4(q, a, k, t, d, n)):
  L.and_r(S.nodup(t), IV4(q, a, k, t, d, n), h)

def l3(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: L.T(IV3(q, a, k, t, d, n))) -> L.T(S.nodup(t)):
  L.and_l(S.nodup(t), IV4(q, a, k, t, d, n), h)

def m3(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +x: L.T(S.nodup(t)), +rest: L.T(IV4(q, a, k, t, d, n))) -> L.T(IV3(q, a, k, t, d, n)):
  L.and_i(S.nodup(t), IV4(q, a, k, t, d, n), x, rest)

def r4(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: L.T(IV4(q, a, k, t, d, n))) -> L.T(IV5(q, a, k, t, d, n)):
  L.and_r(S.nodup(d), IV5(q, a, k, t, d, n), h)

def l4(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: L.T(IV4(q, a, k, t, d, n))) -> L.T(S.nodup(d)):
  L.and_l(S.nodup(d), IV5(q, a, k, t, d, n), h)

def m4(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +x: L.T(S.nodup(d)), +rest: L.T(IV5(q, a, k, t, d, n))) -> L.T(IV4(q, a, k, t, d, n)):
  L.and_i(S.nodup(d), IV5(q, a, k, t, d, n), x, rest)

def r5(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: L.T(IV5(q, a, k, t, d, n))) -> L.T(IV6(q, a, k, t, d, n)):
  L.and_r(S.disjoint(q, a), IV6(q, a, k, t, d, n), h)

def l5(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: L.T(IV5(q, a, k, t, d, n))) -> L.T(S.disjoint(q, a)):
  L.and_l(S.disjoint(q, a), IV6(q, a, k, t, d, n), h)

def m5(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +x: L.T(S.disjoint(q, a)), +rest: L.T(IV6(q, a, k, t, d, n))) -> L.T(IV5(q, a, k, t, d, n)):
  L.and_i(S.disjoint(q, a), IV6(q, a, k, t, d, n), x, rest)

def r6(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: L.T(IV6(q, a, k, t, d, n))) -> L.T(IV7(q, a, k, t, d, n)):
  L.and_r(S.disjoint(q, k), IV7(q, a, k, t, d, n), h)

def l6(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: L.T(IV6(q, a, k, t, d, n))) -> L.T(S.disjoint(q, k)):
  L.and_l(S.disjoint(q, k), IV7(q, a, k, t, d, n), h)

def m6(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +x: L.T(S.disjoint(q, k)), +rest: L.T(IV7(q, a, k, t, d, n))) -> L.T(IV6(q, a, k, t, d, n)):
  L.and_i(S.disjoint(q, k), IV7(q, a, k, t, d, n), x, rest)

def r7(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: L.T(IV7(q, a, k, t, d, n))) -> L.T(IV8(q, a, k, t, d, n)):
  L.and_r(S.disjoint(q, t), IV8(q, a, k, t, d, n), h)

def l7(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: L.T(IV7(q, a, k, t, d, n))) -> L.T(S.disjoint(q, t)):
  L.and_l(S.disjoint(q, t), IV8(q, a, k, t, d, n), h)

def m7(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +x: L.T(S.disjoint(q, t)), +rest: L.T(IV8(q, a, k, t, d, n))) -> L.T(IV7(q, a, k, t, d, n)):
  L.and_i(S.disjoint(q, t), IV8(q, a, k, t, d, n), x, rest)

def r8(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: L.T(IV8(q, a, k, t, d, n))) -> L.T(IV9(q, a, k, t, d, n)):
  L.and_r(S.disjoint(q, d), IV9(q, a, k, t, d, n), h)

def l8(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: L.T(IV8(q, a, k, t, d, n))) -> L.T(S.disjoint(q, d)):
  L.and_l(S.disjoint(q, d), IV9(q, a, k, t, d, n), h)

def m8(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +x: L.T(S.disjoint(q, d)), +rest: L.T(IV9(q, a, k, t, d, n))) -> L.T(IV8(q, a, k, t, d, n)):
  L.and_i(S.disjoint(q, d), IV9(q, a, k, t, d, n), x, rest)

def r9(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: L.T(IV9(q, a, k, t, d, n))) -> L.T(IV10(q, a, k, t, d, n)):
  L.and_r(S.disjoint(a, k), IV10(q, a, k, t, d, n), h)

def l9(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: L.T(IV9(q, a, k, t, d, n))) -> L.T(S.disjoint(a, k)):
  L.and_l(S.disjoint(a, k), IV10(q, a, k, t, d, n), h)

def m9(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +x: L.T(S.disjoint(a, k)), +rest: L.T(IV10(q, a, k, t, d, n))) -> L.T(IV9(q, a, k, t, d, n)):
  L.and_i(S.disjoint(a, k), IV10(q, a, k, t, d, n), x, rest)

def r10(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: L.T(IV10(q, a, k, t, d, n))) -> L.T(IV11(q, a, k, t, d, n)):
  L.and_r(S.disjoint(a, t), IV11(q, a, k, t, d, n), h)

def l10(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: L.T(IV10(q, a, k, t, d, n))) -> L.T(S.disjoint(a, t)):
  L.and_l(S.disjoint(a, t), IV11(q, a, k, t, d, n), h)

def m10(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +x: L.T(S.disjoint(a, t)), +rest: L.T(IV11(q, a, k, t, d, n))) -> L.T(IV10(q, a, k, t, d, n)):
  L.and_i(S.disjoint(a, t), IV11(q, a, k, t, d, n), x, rest)

def r11(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: L.T(IV11(q, a, k, t, d, n))) -> L.T(IV12(q, a, k, t, d, n)):
  L.and_r(S.disjoint(a, d), IV12(q, a, k, t, d, n), h)

def l11(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: L.T(IV11(q, a, k, t, d, n))) -> L.T(S.disjoint(a, d)):
  L.and_l(S.disjoint(a, d), IV12(q, a, k, t, d, n), h)

def m11(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +x: L.T(S.disjoint(a, d)), +rest: L.T(IV12(q, a, k, t, d, n))) -> L.T(IV11(q, a, k, t, d, n)):
  L.and_i(S.disjoint(a, d), IV12(q, a, k, t, d, n), x, rest)

def r12(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: L.T(IV12(q, a, k, t, d, n))) -> L.T(IV13(q, a, k, t, d, n)):
  L.and_r(S.disjoint(k, t), IV13(q, a, k, t, d, n), h)

def l12(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: L.T(IV12(q, a, k, t, d, n))) -> L.T(S.disjoint(k, t)):
  L.and_l(S.disjoint(k, t), IV13(q, a, k, t, d, n), h)

def m12(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +x: L.T(S.disjoint(k, t)), +rest: L.T(IV13(q, a, k, t, d, n))) -> L.T(IV12(q, a, k, t, d, n)):
  L.and_i(S.disjoint(k, t), IV13(q, a, k, t, d, n), x, rest)

def r13(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: L.T(IV13(q, a, k, t, d, n))) -> L.T(IV14(q, a, k, t, d, n)):
  L.and_r(S.disjoint(k, d), IV14(q, a, k, t, d, n), h)

def l13(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: L.T(IV13(q, a, k, t, d, n))) -> L.T(S.disjoint(k, d)):
  L.and_l(S.disjoint(k, d), IV14(q, a, k, t, d, n), h)

def m13(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +x: L.T(S.disjoint(k, d)), +rest: L.T(IV14(q, a, k, t, d, n))) -> L.T(IV13(q, a, k, t, d, n)):
  L.and_i(S.disjoint(k, d), IV14(q, a, k, t, d, n), x, rest)

def r14(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: L.T(IV14(q, a, k, t, d, n))) -> L.T(IV15(q, a, k, t, d, n)):
  L.and_r(S.disjoint(t, d), IV15(q, a, k, t, d, n), h)

def l14(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: L.T(IV14(q, a, k, t, d, n))) -> L.T(S.disjoint(t, d)):
  L.and_l(S.disjoint(t, d), IV15(q, a, k, t, d, n), h)

def m14(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +x: L.T(S.disjoint(t, d)), +rest: L.T(IV15(q, a, k, t, d, n))) -> L.T(IV14(q, a, k, t, d, n)):
  L.and_i(S.disjoint(t, d), IV15(q, a, k, t, d, n), x, rest)

def r15(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: L.T(IV15(q, a, k, t, d, n))) -> L.T(IV16(q, a, k, t, d, n)):
  L.and_r(bd(q, n), IV16(q, a, k, t, d, n), h)

def l15(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: L.T(IV15(q, a, k, t, d, n))) -> L.T(bd(q, n)):
  L.and_l(bd(q, n), IV16(q, a, k, t, d, n), h)

def m15(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +x: L.T(bd(q, n)), +rest: L.T(IV16(q, a, k, t, d, n))) -> L.T(IV15(q, a, k, t, d, n)):
  L.and_i(bd(q, n), IV16(q, a, k, t, d, n), x, rest)

def r16(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: L.T(IV16(q, a, k, t, d, n))) -> L.T(IV17(q, a, k, t, d, n)):
  L.and_r(bd(a, n), IV17(q, a, k, t, d, n), h)

def l16(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: L.T(IV16(q, a, k, t, d, n))) -> L.T(bd(a, n)):
  L.and_l(bd(a, n), IV17(q, a, k, t, d, n), h)

def m16(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +x: L.T(bd(a, n)), +rest: L.T(IV17(q, a, k, t, d, n))) -> L.T(IV16(q, a, k, t, d, n)):
  L.and_i(bd(a, n), IV17(q, a, k, t, d, n), x, rest)

def r17(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: L.T(IV17(q, a, k, t, d, n))) -> L.T(IV18(q, a, k, t, d, n)):
  L.and_r(bd(k, n), IV18(q, a, k, t, d, n), h)

def l17(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: L.T(IV17(q, a, k, t, d, n))) -> L.T(bd(k, n)):
  L.and_l(bd(k, n), IV18(q, a, k, t, d, n), h)

def m17(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +x: L.T(bd(k, n)), +rest: L.T(IV18(q, a, k, t, d, n))) -> L.T(IV17(q, a, k, t, d, n)):
  L.and_i(bd(k, n), IV18(q, a, k, t, d, n), x, rest)

def r18(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: L.T(IV18(q, a, k, t, d, n))) -> L.T(IV19(q, a, k, t, d, n)):
  L.and_r(bd(t, n), IV19(q, a, k, t, d, n), h)

def l18(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: L.T(IV18(q, a, k, t, d, n))) -> L.T(bd(t, n)):
  L.and_l(bd(t, n), IV19(q, a, k, t, d, n), h)

def m18(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +x: L.T(bd(t, n)), +rest: L.T(IV19(q, a, k, t, d, n))) -> L.T(IV18(q, a, k, t, d, n)):
  L.and_i(bd(t, n), IV19(q, a, k, t, d, n), x, rest)

def r19(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: L.T(IV19(q, a, k, t, d, n))) -> L.T(IV20(q, a, k, t, d, n)):
  L.and_r(bd(d, n), IV20(q, a, k, t, d, n), h)

def l19(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: L.T(IV19(q, a, k, t, d, n))) -> L.T(bd(d, n)):
  L.and_l(bd(d, n), IV20(q, a, k, t, d, n), h)

def m19(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +x: L.T(bd(d, n)), +rest: L.T(IV20(q, a, k, t, d, n))) -> L.T(IV19(q, a, k, t, d, n)):
  L.and_i(bd(d, n), IV20(q, a, k, t, d, n), x, rest)

def p0(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: L.T(IV(q, a, k, t, d, n))) -> L.T(S.nodup(q)):
  l0(q, a, k, t, d, n, h)

def p1(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: L.T(IV(q, a, k, t, d, n))) -> L.T(S.nodup(a)):
  l1(q, a, k, t, d, n, r0(q, a, k, t, d, n, h))

def p2(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: L.T(IV(q, a, k, t, d, n))) -> L.T(S.nodup(k)):
  l2(q, a, k, t, d, n, r1(q, a, k, t, d, n, r0(q, a, k, t, d, n, h)))

def p3(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: L.T(IV(q, a, k, t, d, n))) -> L.T(S.nodup(t)):
  l3(q, a, k, t, d, n, r2(q, a, k, t, d, n, r1(q, a, k, t, d, n, r0(q, a, k, t, d, n, h))))

def p4(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: L.T(IV(q, a, k, t, d, n))) -> L.T(S.nodup(d)):
  l4(q, a, k, t, d, n, r3(q, a, k, t, d, n, r2(q, a, k, t, d, n, r1(q, a, k, t, d, n, r0(q, a, k, t, d, n, h)))))

def p5(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: L.T(IV(q, a, k, t, d, n))) -> L.T(S.disjoint(q, a)):
  l5(q, a, k, t, d, n, r4(q, a, k, t, d, n, r3(q, a, k, t, d, n, r2(q, a, k, t, d, n, r1(q, a, k, t, d, n, r0(q, a, k, t, d, n, h))))))

def p6(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: L.T(IV(q, a, k, t, d, n))) -> L.T(S.disjoint(q, k)):
  l6(q, a, k, t, d, n, r5(q, a, k, t, d, n, r4(q, a, k, t, d, n, r3(q, a, k, t, d, n, r2(q, a, k, t, d, n, r1(q, a, k, t, d, n, r0(q, a, k, t, d, n, h)))))))

def p7(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: L.T(IV(q, a, k, t, d, n))) -> L.T(S.disjoint(q, t)):
  l7(q, a, k, t, d, n, r6(q, a, k, t, d, n, r5(q, a, k, t, d, n, r4(q, a, k, t, d, n, r3(q, a, k, t, d, n, r2(q, a, k, t, d, n, r1(q, a, k, t, d, n, r0(q, a, k, t, d, n, h))))))))

def p8(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: L.T(IV(q, a, k, t, d, n))) -> L.T(S.disjoint(q, d)):
  l8(q, a, k, t, d, n, r7(q, a, k, t, d, n, r6(q, a, k, t, d, n, r5(q, a, k, t, d, n, r4(q, a, k, t, d, n, r3(q, a, k, t, d, n, r2(q, a, k, t, d, n, r1(q, a, k, t, d, n, r0(q, a, k, t, d, n, h)))))))))

def p9(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: L.T(IV(q, a, k, t, d, n))) -> L.T(S.disjoint(a, k)):
  l9(q, a, k, t, d, n, r8(q, a, k, t, d, n, r7(q, a, k, t, d, n, r6(q, a, k, t, d, n, r5(q, a, k, t, d, n, r4(q, a, k, t, d, n, r3(q, a, k, t, d, n, r2(q, a, k, t, d, n, r1(q, a, k, t, d, n, r0(q, a, k, t, d, n, h))))))))))

def p10(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: L.T(IV(q, a, k, t, d, n))) -> L.T(S.disjoint(a, t)):
  l10(q, a, k, t, d, n, r9(q, a, k, t, d, n, r8(q, a, k, t, d, n, r7(q, a, k, t, d, n, r6(q, a, k, t, d, n, r5(q, a, k, t, d, n, r4(q, a, k, t, d, n, r3(q, a, k, t, d, n, r2(q, a, k, t, d, n, r1(q, a, k, t, d, n, r0(q, a, k, t, d, n, h)))))))))))

def p11(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: L.T(IV(q, a, k, t, d, n))) -> L.T(S.disjoint(a, d)):
  l11(q, a, k, t, d, n, r10(q, a, k, t, d, n, r9(q, a, k, t, d, n, r8(q, a, k, t, d, n, r7(q, a, k, t, d, n, r6(q, a, k, t, d, n, r5(q, a, k, t, d, n, r4(q, a, k, t, d, n, r3(q, a, k, t, d, n, r2(q, a, k, t, d, n, r1(q, a, k, t, d, n, r0(q, a, k, t, d, n, h))))))))))))

def p12(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: L.T(IV(q, a, k, t, d, n))) -> L.T(S.disjoint(k, t)):
  l12(q, a, k, t, d, n, r11(q, a, k, t, d, n, r10(q, a, k, t, d, n, r9(q, a, k, t, d, n, r8(q, a, k, t, d, n, r7(q, a, k, t, d, n, r6(q, a, k, t, d, n, r5(q, a, k, t, d, n, r4(q, a, k, t, d, n, r3(q, a, k, t, d, n, r2(q, a, k, t, d, n, r1(q, a, k, t, d, n, r0(q, a, k, t, d, n, h)))))))))))))

def p13(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: L.T(IV(q, a, k, t, d, n))) -> L.T(S.disjoint(k, d)):
  l13(q, a, k, t, d, n, r12(q, a, k, t, d, n, r11(q, a, k, t, d, n, r10(q, a, k, t, d, n, r9(q, a, k, t, d, n, r8(q, a, k, t, d, n, r7(q, a, k, t, d, n, r6(q, a, k, t, d, n, r5(q, a, k, t, d, n, r4(q, a, k, t, d, n, r3(q, a, k, t, d, n, r2(q, a, k, t, d, n, r1(q, a, k, t, d, n, r0(q, a, k, t, d, n, h))))))))))))))

def p14(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: L.T(IV(q, a, k, t, d, n))) -> L.T(S.disjoint(t, d)):
  l14(q, a, k, t, d, n, r13(q, a, k, t, d, n, r12(q, a, k, t, d, n, r11(q, a, k, t, d, n, r10(q, a, k, t, d, n, r9(q, a, k, t, d, n, r8(q, a, k, t, d, n, r7(q, a, k, t, d, n, r6(q, a, k, t, d, n, r5(q, a, k, t, d, n, r4(q, a, k, t, d, n, r3(q, a, k, t, d, n, r2(q, a, k, t, d, n, r1(q, a, k, t, d, n, r0(q, a, k, t, d, n, h)))))))))))))))

def p15(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: L.T(IV(q, a, k, t, d, n))) -> L.T(bd(q, n)):
  l15(q, a, k, t, d, n, r14(q, a, k, t, d, n, r13(q, a, k, t, d, n, r12(q, a, k, t, d, n, r11(q, a, k, t, d, n, r10(q, a, k, t, d, n, r9(q, a, k, t, d, n, r8(q, a, k, t, d, n, r7(q, a, k, t, d, n, r6(q, a, k, t, d, n, r5(q, a, k, t, d, n, r4(q, a, k, t, d, n, r3(q, a, k, t, d, n, r2(q, a, k, t, d, n, r1(q, a, k, t, d, n, r0(q, a, k, t, d, n, h))))))))))))))))

def p16(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: L.T(IV(q, a, k, t, d, n))) -> L.T(bd(a, n)):
  l16(q, a, k, t, d, n, r15(q, a, k, t, d, n, r14(q, a, k, t, d, n, r13(q, a, k, t, d, n, r12(q, a, k, t, d, n, r11(q, a, k, t, d, n, r10(q, a, k, t, d, n, r9(q, a, k, t, d, n, r8(q, a, k, t, d, n, r7(q, a, k, t, d, n, r6(q, a, k, t, d, n, r5(q, a, k, t, d, n, r4(q, a, k, t, d, n, r3(q, a, k, t, d, n, r2(q, a, k, t, d, n, r1(q, a, k, t, d, n, r0(q, a, k, t, d, n, h)))))))))))))))))

def p17(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: L.T(IV(q, a, k, t, d, n))) -> L.T(bd(k, n)):
  l17(q, a, k, t, d, n, r16(q, a, k, t, d, n, r15(q, a, k, t, d, n, r14(q, a, k, t, d, n, r13(q, a, k, t, d, n, r12(q, a, k, t, d, n, r11(q, a, k, t, d, n, r10(q, a, k, t, d, n, r9(q, a, k, t, d, n, r8(q, a, k, t, d, n, r7(q, a, k, t, d, n, r6(q, a, k, t, d, n, r5(q, a, k, t, d, n, r4(q, a, k, t, d, n, r3(q, a, k, t, d, n, r2(q, a, k, t, d, n, r1(q, a, k, t, d, n, r0(q, a, k, t, d, n, h))))))))))))))))))

def p18(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: L.T(IV(q, a, k, t, d, n))) -> L.T(bd(t, n)):
  l18(q, a, k, t, d, n, r17(q, a, k, t, d, n, r16(q, a, k, t, d, n, r15(q, a, k, t, d, n, r14(q, a, k, t, d, n, r13(q, a, k, t, d, n, r12(q, a, k, t, d, n, r11(q, a, k, t, d, n, r10(q, a, k, t, d, n, r9(q, a, k, t, d, n, r8(q, a, k, t, d, n, r7(q, a, k, t, d, n, r6(q, a, k, t, d, n, r5(q, a, k, t, d, n, r4(q, a, k, t, d, n, r3(q, a, k, t, d, n, r2(q, a, k, t, d, n, r1(q, a, k, t, d, n, r0(q, a, k, t, d, n, h)))))))))))))))))))

def p19(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: L.T(IV(q, a, k, t, d, n))) -> L.T(bd(d, n)):
  l19(q, a, k, t, d, n, r18(q, a, k, t, d, n, r17(q, a, k, t, d, n, r16(q, a, k, t, d, n, r15(q, a, k, t, d, n, r14(q, a, k, t, d, n, r13(q, a, k, t, d, n, r12(q, a, k, t, d, n, r11(q, a, k, t, d, n, r10(q, a, k, t, d, n, r9(q, a, k, t, d, n, r8(q, a, k, t, d, n, r7(q, a, k, t, d, n, r6(q, a, k, t, d, n, r5(q, a, k, t, d, n, r4(q, a, k, t, d, n, r3(q, a, k, t, d, n, r2(q, a, k, t, d, n, r1(q, a, k, t, d, n, r0(q, a, k, t, d, n, h))))))))))))))))))))

def p20(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: L.T(IV(q, a, k, t, d, n))) -> L.T(SUMB(q, a, k, t, d, n)):
  r19(q, a, k, t, d, n, r18(q, a, k, t, d, n, r17(q, a, k, t, d, n, r16(q, a, k, t, d, n, r15(q, a, k, t, d, n, r14(q, a, k, t, d, n, r13(q, a, k, t, d, n, r12(q, a, k, t, d, n, r11(q, a, k, t, d, n, r10(q, a, k, t, d, n, r9(q, a, k, t, d, n, r8(q, a, k, t, d, n, r7(q, a, k, t, d, n, r6(q, a, k, t, d, n, r5(q, a, k, t, d, n, r4(q, a, k, t, d, n, r3(q, a, k, t, d, n, r2(q, a, k, t, d, n, r1(q, a, k, t, d, n, r0(q, a, k, t, d, n, h))))))))))))))))))))

def mk(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +x0: L.T(S.nodup(q)), +x1: L.T(S.nodup(a)), +x2: L.T(S.nodup(k)), +x3: L.T(S.nodup(t)), +x4: L.T(S.nodup(d)), +x5: L.T(S.disjoint(q, a)), +x6: L.T(S.disjoint(q, k)), +x7: L.T(S.disjoint(q, t)), +x8: L.T(S.disjoint(q, d)), +x9: L.T(S.disjoint(a, k)), +x10: L.T(S.disjoint(a, t)), +x11: L.T(S.disjoint(a, d)), +x12: L.T(S.disjoint(k, t)), +x13: L.T(S.disjoint(k, d)), +x14: L.T(S.disjoint(t, d)), +x15: L.T(bd(q, n)), +x16: L.T(bd(a, n)), +x17: L.T(bd(k, n)), +x18: L.T(bd(t, n)), +x19: L.T(bd(d, n)), +x20: L.T(SUMB(q, a, k, t, d, n))) -> L.T(IV(q, a, k, t, d, n)):
  m0(q, a, k, t, d, n, x0, m1(q, a, k, t, d, n, x1, m2(q, a, k, t, d, n, x2, m3(q, a, k, t, d, n, x3, m4(q, a, k, t, d, n, x4, m5(q, a, k, t, d, n, x5, m6(q, a, k, t, d, n, x6, m7(q, a, k, t, d, n, x7, m8(q, a, k, t, d, n, x8, m9(q, a, k, t, d, n, x9, m10(q, a, k, t, d, n, x10, m11(q, a, k, t, d, n, x11, m12(q, a, k, t, d, n, x12, m13(q, a, k, t, d, n, x13, m14(q, a, k, t, d, n, x14, m15(q, a, k, t, d, n, x15, m16(q, a, k, t, d, n, x16, m17(q, a, k, t, d, n, x17, m18(q, a, k, t, d, n, x18, m19(q, a, k, t, d, n, x19, x20))))))))))))))))))))

def inv_sendQ(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: L.T(IV(q, a, k, t, d, n))) -> L.T(IV(M.snoc(q, n), a, k, t, d, 1n+n)):
  mk(M.snoc(q, n), a, k, t, d, 1n+n, nd_snoc(q, n, p0(q, a, k, t, d, n, h), bd_fresh(q, n, p15(q, a, k, t, d, n, h))), p1(q, a, k, t, d, n, h), p2(q, a, k, t, d, n, h), p3(q, a, k, t, d, n, h), p4(q, a, k, t, d, n, h), dj_snoc_l(q, a, n, p5(q, a, k, t, d, n, h), bd_fresh(a, n, p16(q, a, k, t, d, n, h))), dj_snoc_l(q, k, n, p6(q, a, k, t, d, n, h), bd_fresh(k, n, p17(q, a, k, t, d, n, h))), dj_snoc_l(q, t, n, p7(q, a, k, t, d, n, h), bd_fresh(t, n, p18(q, a, k, t, d, n, h))), dj_snoc_l(q, d, n, p8(q, a, k, t, d, n, h), bd_fresh(d, n, p19(q, a, k, t, d, n, h))), p9(q, a, k, t, d, n, h), p10(q, a, k, t, d, n, h), p11(q, a, k, t, d, n, h), p12(q, a, k, t, d, n, h), p13(q, a, k, t, d, n, h), p14(q, a, k, t, d, n, h), bd_snoc_new(q, n, p15(q, a, k, t, d, n, h)), bd_succ(a, n, p16(q, a, k, t, d, n, h)), bd_succ(k, n, p17(q, a, k, t, d, n, h)), bd_succ(t, n, p18(q, a, k, t, d, n, h)), bd_succ(d, n, p19(q, a, k, t, d, n, h)), sm_sendQ(q, a, k, t, d, n, p20(q, a, k, t, d, n, h)))

def inv_sendD(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: L.T(IV(q, a, k, t, d, n))) -> L.T(IV(q, a, k, t, M.snoc(d, n), 1n+n)):
  mk(q, a, k, t, M.snoc(d, n), 1n+n, p0(q, a, k, t, d, n, h), p1(q, a, k, t, d, n, h), p2(q, a, k, t, d, n, h), p3(q, a, k, t, d, n, h), nd_snoc(d, n, p4(q, a, k, t, d, n, h), bd_fresh(d, n, p19(q, a, k, t, d, n, h))), p5(q, a, k, t, d, n, h), p6(q, a, k, t, d, n, h), p7(q, a, k, t, d, n, h), dj_snoc_r(q, d, n, p8(q, a, k, t, d, n, h), bd_fresh(q, n, p15(q, a, k, t, d, n, h))), p9(q, a, k, t, d, n, h), p10(q, a, k, t, d, n, h), dj_snoc_r(a, d, n, p11(q, a, k, t, d, n, h), bd_fresh(a, n, p16(q, a, k, t, d, n, h))), p12(q, a, k, t, d, n, h), dj_snoc_r(k, d, n, p13(q, a, k, t, d, n, h), bd_fresh(k, n, p17(q, a, k, t, d, n, h))), dj_snoc_r(t, d, n, p14(q, a, k, t, d, n, h), bd_fresh(t, n, p18(q, a, k, t, d, n, h))), bd_succ(q, n, p15(q, a, k, t, d, n, h)), bd_succ(a, n, p16(q, a, k, t, d, n, h)), bd_succ(k, n, p17(q, a, k, t, d, n, h)), bd_succ(t, n, p18(q, a, k, t, d, n, h)), bd_snoc_new(d, n, p19(q, a, k, t, d, n, h)), sm_sendD(q, a, k, t, d, n, p20(q, a, k, t, d, n, h)))

def inv_mv(+x: Nat, +r: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: L.T(IV(x <> r, a, k, t, d, n))) -> L.T(IV(r, a, k, M.snoc(t, x), d, n)):
  mk(r, a, k, M.snoc(t, x), d, n, nd_tl(x, r, p0(x <> r, a, k, t, d, n, h)), p1(x <> r, a, k, t, d, n, h), p2(x <> r, a, k, t, d, n, h), nd_snoc(t, x, p3(x <> r, a, k, t, d, n, h), dj_hd(x, r, t, p7(x <> r, a, k, t, d, n, h))), p4(x <> r, a, k, t, d, n, h), dj_tl(x, r, a, p5(x <> r, a, k, t, d, n, h)), dj_tl(x, r, k, p6(x <> r, a, k, t, d, n, h)), dj_snoc_r(r, t, x, dj_tl(x, r, t, p7(x <> r, a, k, t, d, n, h)), nd_hd(x, r, p0(x <> r, a, k, t, d, n, h))), dj_tl(x, r, d, p8(x <> r, a, k, t, d, n, h)), p9(x <> r, a, k, t, d, n, h), dj_snoc_r(a, t, x, p10(x <> r, a, k, t, d, n, h), dj_hd(x, r, a, p5(x <> r, a, k, t, d, n, h))), p11(x <> r, a, k, t, d, n, h), dj_snoc_r(k, t, x, p12(x <> r, a, k, t, d, n, h), dj_hd(x, r, k, p6(x <> r, a, k, t, d, n, h))), p13(x <> r, a, k, t, d, n, h), dj_snoc_l(t, d, x, p14(x <> r, a, k, t, d, n, h), dj_hd(x, r, d, p8(x <> r, a, k, t, d, n, h))), bd_tl(x, r, n, p15(x <> r, a, k, t, d, n, h)), p16(x <> r, a, k, t, d, n, h), p17(x <> r, a, k, t, d, n, h), bd_snoc(t, x, n, p18(x <> r, a, k, t, d, n, h), bd_hd(x, r, n, p15(x <> r, a, k, t, d, n, h))), p19(x <> r, a, k, t, d, n, h), sm_mv(x, r, a, k, t, d, n, p20(x <> r, a, k, t, d, n, h)))

def inv_ex(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: L.T(IV(q, a, k, t, d, n))) -> L.T(IV([], a, [], t, List.append(&2, Nat, d, List.append(&2, Nat, q, k)), n)):
  mk([], a, [], t, List.append(&2, Nat, d, List.append(&2, Nat, q, k)), n, {==}, p1(q, a, k, t, d, n, h), {==}, p3(q, a, k, t, d, n, h), nd_app(d, List.append(&2, Nat, q, k), p4(q, a, k, t, d, n, h), nd_app(q, k, p0(q, a, k, t, d, n, h), p2(q, a, k, t, d, n, h), p6(q, a, k, t, d, n, h)), dj_app_r(d, q, k, dj_sym(q, d, p8(q, a, k, t, d, n, h)), dj_sym(k, d, p13(q, a, k, t, d, n, h)))), {==}, {==}, {==}, {==}, dj_nil_r(a), p10(q, a, k, t, d, n, h), dj_app_r(a, d, List.append(&2, Nat, q, k), p11(q, a, k, t, d, n, h), dj_app_r(a, q, k, dj_sym(q, a, p5(q, a, k, t, d, n, h)), p9(q, a, k, t, d, n, h))), {==}, {==}, dj_app_r(t, d, List.append(&2, Nat, q, k), p14(q, a, k, t, d, n, h), dj_app_r(t, q, k, dj_sym(q, t, p7(q, a, k, t, d, n, h)), dj_sym(k, t, p12(q, a, k, t, d, n, h)))), {==}, p16(q, a, k, t, d, n, h), {==}, p18(q, a, k, t, d, n, h), bd_app(d, List.append(&2, Nat, q, k), n, p19(q, a, k, t, d, n, h), bd_app(q, k, n, p15(q, a, k, t, d, n, h), p17(q, a, k, t, d, n, h))), sm_ex(q, a, k, t, d, n, p20(q, a, k, t, d, n, h)))

def inv_rq(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +id: Nat, +hm: L.T(M.mem(id, q)), +h: L.T(IV(q, a, k, t, d, n))) -> L.T(IV(M.remove(id, q), a, k, t, M.snoc(d, id), n)):
  mk(M.remove(id, q), a, k, t, M.snoc(d, id), n, nd_remove(id, q, p0(q, a, k, t, d, n, h)), p1(q, a, k, t, d, n, h), p2(q, a, k, t, d, n, h), p3(q, a, k, t, d, n, h), nd_snoc(d, id, p4(q, a, k, t, d, n, h), dj_nm(q, d, id, hm, p8(q, a, k, t, d, n, h))), dj_sub_l(M.remove(id, q), q, a, L.rm_sub(id, q), p5(q, a, k, t, d, n, h)), dj_sub_l(M.remove(id, q), q, k, L.rm_sub(id, q), p6(q, a, k, t, d, n, h)), dj_sub_l(M.remove(id, q), q, t, L.rm_sub(id, q), p7(q, a, k, t, d, n, h)), dj_snoc_r(M.remove(id, q), d, id, dj_sub_l(M.remove(id, q), q, d, L.rm_sub(id, q), p8(q, a, k, t, d, n, h)), nm_removed(id, q)), p9(q, a, k, t, d, n, h), p10(q, a, k, t, d, n, h), dj_snoc_r(a, d, id, p11(q, a, k, t, d, n, h), dj_nm(q, a, id, hm, p5(q, a, k, t, d, n, h))), p12(q, a, k, t, d, n, h), dj_snoc_r(k, d, id, p13(q, a, k, t, d, n, h), dj_nm(q, k, id, hm, p6(q, a, k, t, d, n, h))), dj_snoc_r(t, d, id, p14(q, a, k, t, d, n, h), dj_nm(q, t, id, hm, p7(q, a, k, t, d, n, h))), bd_sub(M.remove(id, q), q, n, L.rm_sub(id, q), p15(q, a, k, t, d, n, h)), p16(q, a, k, t, d, n, h), p17(q, a, k, t, d, n, h), p18(q, a, k, t, d, n, h), bd_snoc(d, id, n, p19(q, a, k, t, d, n, h), bd_mem(q, n, id, hm, p15(q, a, k, t, d, n, h))), sm_rq(q, a, k, t, d, n, id, hm, p0(q, a, k, t, d, n, h), p20(q, a, k, t, d, n, h)))

def sm_exq(+q: +List<Nat>, +a: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +hs: L.T(SUMB(q, a, [], t, d, n))) -> L.T(SUMB([], a, [], t, List.append(&2, Nat, d, q), n)):
  eq_intro(SG(0n, S.len(a), 0n, S.len(t), S.len(List.append(&2, Nat, d, q))), n, tr(SG(0n, S.len(a), 0n, S.len(t), S.len(List.append(&2, Nat, d, q))), SG(0n, S.len(a), 0n, S.len(t), Nat.add(S.len(d), S.len(q))), n, cgd(0n, S.len(a), 0n, S.len(t), S.len(List.append(&2, Nat, d, q)), Nat.add(S.len(d), S.len(q)), len_app(d, q)), tr(SG(0n, S.len(a), 0n, S.len(t), Nat.add(S.len(d), S.len(q))), SG(S.len(q), S.len(a), 0n, S.len(t), S.len(d)), n, tr(SG(0n, S.len(a), 0n, S.len(t), Nat.add(S.len(d), S.len(q))), Nat.add(S.len(q), SG(0n, S.len(a), 0n, S.len(t), S.len(d))), SG(S.len(q), S.len(a), 0n, S.len(t), S.len(d)), shd(0n, S.len(a), 0n, S.len(t), S.len(d), S.len(q)), sy(SG(S.len(q), S.len(a), 0n, S.len(t), S.len(d)), Nat.add(S.len(q), SG(0n, S.len(a), 0n, S.len(t), S.len(d))), shq(0n, S.len(a), 0n, S.len(t), S.len(d), S.len(q)))), L.eq_elim(SG(S.len(q), S.len(a), 0n, S.len(t), S.len(d)), n, hs))))

def inv_exq(+q: +List<Nat>, +a: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: L.T(IV(q, a, [], t, d, n))) -> L.T(IV([], a, [], t, List.append(&2, Nat, d, q), n)):
  mk([], a, [], t, List.append(&2, Nat, d, q), n, {==}, p1(q, a, [], t, d, n, h), {==}, p3(q, a, [], t, d, n, h), nd_app(d, q, p4(q, a, [], t, d, n, h), p0(q, a, [], t, d, n, h), dj_sym(q, d, p8(q, a, [], t, d, n, h))), {==}, {==}, {==}, {==}, dj_nil_r(a), p10(q, a, [], t, d, n, h), dj_app_r(a, d, q, p11(q, a, [], t, d, n, h), dj_sym(q, a, p5(q, a, [], t, d, n, h))), {==}, {==}, dj_app_r(t, d, q, p14(q, a, [], t, d, n, h), dj_sym(q, t, p7(q, a, [], t, d, n, h))), {==}, p16(q, a, [], t, d, n, h), {==}, p18(q, a, [], t, d, n, h), bd_app(d, q, n, p19(q, a, [], t, d, n, h), p15(q, a, [], t, d, n, h)), sm_exq(q, a, t, d, n, p20(q, a, [], t, d, n, h)))

def invw(+s: M.World) -> Bool:
  IV(S.queue(s), [], [], S.typed(s), S.dropped(s), S.next_id(s))

def fgo(+q: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +u: +List<Nat>, +n: Nat, +i: Bool, +g: Bool, +h: L.T(IV(q, [], [], t, d, n))) -> L.T(invw(M.flush_go(q, M.W{[], t, d, u, n, i, g}))):
  match q:
    case Nil{}:
      h
    case Con{+x, +rest}:
      fgo(rest, M.snoc(t, x), d, u, n, False{}, g, inv_mv(x, rest, [], [], t, d, n, h))

def fb(i: Bool, +s: M.World, +h: L.T(invw(s))) -> L.T(invw(M.flush_b(i, s))):
  match i:
    case False{}:
      h
    case True{}:
      match s:
        case M.W{+q, +t, +d, +u, +n, +i, +g}:
          fgo(q, t, d, u, n, i, g, h)

def fl(+s: M.World, +h: L.T(invw(s))) -> L.T(invw(M.flush(s))):
  match s:
    case M.W{+q, +t, +d, +u, +n, +i, +g}:
      fb(i, M.W{q, t, d, u, n, i, g}, h)

def send_auto_inv(fu: Bool, +s: M.World, +h: L.T(invw(s))) -> L.T(invw(M.send_auto(fu, s))):
  match fu:
    case True{}:
      match s:
        case M.W{+q, +t, +d, +u, +n, +i, +g}:
          fl(M.W{M.snoc(q, n), t, d, M.snoc(u, n), 1n+n, i, g}, inv_sendQ(q, [], [], t, d, n, h))
    case False{}:
      match s:
        case M.W{+q, +t, +d, +u, +n, +i, +g}:
          fl(M.W{M.snoc(q, n), t, d, u, 1n+n, i, g}, inv_sendQ(q, [], [], t, d, n, h))

def send_live_inv(r: M.Route, fu: Bool, +s: M.World, +h: L.T(invw(s))) -> L.T(invw(M.send_live(r, fu, s))):
  match r:
    case M.Auto{}:
      send_auto_inv(fu, s, h)
    case M.RouteDrop{}:
      match s:
        case M.W{+q, +t, +d, +u, +n, +i, +g}:
          inv_sendD(q, [], [], t, d, n, h)

def send_inv(r: M.Route, fu: Bool, g: Bool, +s: M.World, +h: L.T(invw(s))) -> L.T(invw(M.send(r, fu, g, s))):
  match g:
    case True{}:
      h
    case False{}:
      send_live_inv(r, fu, s, h)

def send_ev_inv(fu: Bool, r: M.Route, +s: M.World, +h: L.T(invw(s))) -> L.T(invw(M.send_ev(fu, r, s))):
  match s:
    case M.W{+q, +t, +d, +u, +n, +i, +g}:
      send_inv(r, fu, g, M.W{q, t, d, u, n, i, g}, h)

def idle_inv(+s: M.World, +h: L.T(invw(s))) -> L.T(invw(M.idle_ev(s))):
  match s:
    case M.W{+q, +t, +d, +u, +n, +i, +g}:
      match g:
        case True{}:
          h
        case False{}:
          fl(M.W{q, t, d, u, n, True{}, False{}}, h)

def busy_inv(+s: M.World, +h: L.T(invw(s))) -> L.T(invw(M.busy_ev(s))):
  match s:
    case M.W{+q, +t, +d, +u, +n, +i, +g}:
      h

def exit_inv(+s: M.World, +h: L.T(invw(s))) -> L.T(invw(M.exit_(s))):
  match s:
    case M.W{+q, +t, +d, +u, +n, +i, +g}:
      inv_exq(q, [], t, d, n, h)

def drop_q_inv(b: Bool, +id: Nat, +s: M.World, +h: L.T(invw(s)), hm: L.T(b) -> L.T(M.mem(id, S.queue(s)))) -> L.T(invw(M.drop_q(b, id, s))):
  match b:
    case False{}:
      h
    case True{}:
      match s:
        case M.W{+q, +t, +d, +u, +n, +i, +g}:
          inv_rq(q, [], [], t, d, n, id, hm({==}), h)

def user_drop_inv(+id: Nat, +s: M.World, +h: L.T(invw(s))) -> L.T(invw(M.user_drop(id, s))):
  match s:
    case M.W{+q, +t, +d, +u, +n, +i, +g}:
      drop_q_inv(M.mem(id, q), id, M.W{q, t, d, u, n, i, g}, h, hh => hh)

def restart_inv(alive: Bool, +s: M.World, +h: L.T(invw(s))) -> L.T(invw(M.restart(alive, s))):
  match alive:
    case True{}:
      match s:
        case M.W{+q, +t, +d, +u, +n, +i, +g}:
          h
    case False{}:
      match s:
        case M.W{+q, +t, +d, +u, +n, +i, +g}:
          inv_exq(q, [], t, d, n, h)

def step_inv(e: M.Ev, +s: M.World, +h: L.T(invw(s))) -> L.T(invw(M.step(e, s))):
  match e:
    case M.Send{fu, r}:
      send_ev_inv(fu, r, s, h)
    case M.Idle{}:
      idle_inv(s, h)
    case M.Busy{}:
      busy_inv(s, h)
    case M.Exit{}:
      exit_inv(s, h)
    case M.UserDrop{id}:
      user_drop_inv(id, s, h)
    case M.Restart{alive}:
      restart_inv(alive, s, h)

def run_inv(+evs: +List<M.Ev>, +s: M.World, +h: L.T(invw(s))) -> L.T(invw(M.run(evs, s))):
  match evs:
    case Nil{}:
      h
    case Con{e, +rest}:
      run_inv(rest, M.step(e, s), step_inv(e, s, h))

def inv_init() -> L.T(invw(M.init())):
  mk([], [], [], [], [], 1n, {==}, {==}, {==}, {==}, {==}, {==}, {==}, {==}, {==}, {==}, {==}, {==}, {==}, {==}, {==}, {==}, {==}, {==}, {==}, {==}, {==})

def inv_world(+evs: +List<M.Ev>) -> L.T(invw(S.world(evs))):
  run_inv(evs, M.init(), inv_init())

# ---- M1
def m1_main(+evs: +List<M.Ev>) -> L.T(S.nodup(S.typed(S.world(evs)))):
  p3(S.queue(S.world(evs)), [], [], S.typed(S.world(evs)), S.dropped(S.world(evs)), S.next_id(S.world(evs)), inv_world(evs))

def Laws.m1_final_and_at_most_once(evs):
  m1_main(evs)

# ---- M5
def m5_main(+evs: +List<M.Ev>) -> L.T(Bool.and(S.disjoint(S.typed(S.world(evs)), S.dropped(S.world(evs))), S.disjoint(S.typed(S.world(evs)), S.queue(S.world(evs))))):
  L.and_i(S.disjoint(S.typed(S.world(evs)), S.dropped(S.world(evs))), S.disjoint(S.typed(S.world(evs)), S.queue(S.world(evs))), p14(S.queue(S.world(evs)), [], [], S.typed(S.world(evs)), S.dropped(S.world(evs)), S.next_id(S.world(evs)), inv_world(evs)), dj_sym(S.queue(S.world(evs)), S.typed(S.world(evs)), p7(S.queue(S.world(evs)), [], [], S.typed(S.world(evs)), S.dropped(S.world(evs)), S.next_id(S.world(evs)), inv_world(evs))))

def Laws.m5_terminal_states_are_absorbing(evs):
  m5_main(evs)

# ---- M6
def m6_main(+evs: +List<M.Ev>) -> EQ(SG(S.len(S.queue(S.world(evs))), 0n, 0n, S.len(S.typed(S.world(evs))), S.len(S.dropped(S.world(evs)))), S.next_id(S.world(evs))):
  L.eq_elim(SG(S.len(S.queue(S.world(evs))), 0n, 0n, S.len(S.typed(S.world(evs))), S.len(S.dropped(S.world(evs)))), S.next_id(S.world(evs)), p20(S.queue(S.world(evs)), [], [], S.typed(S.world(evs)), S.dropped(S.world(evs)), S.next_id(S.world(evs)), inv_world(evs)))

def Laws.m6_no_silent_loss(evs):
  m6_main(evs)

# ---- M9
def restart_replay(alive: Bool, +s: M.World) -> {S.records(M.step(M.Restart{alive}, s)) == S.replay(S.records(s), alive) : S.Rec}:
  match alive:
    case True{}:
      match s:
        case M.W{+q, +t, +d, +u, +n, +i, +g}:
          {==}
    case False{}:
      match s:
        case M.W{+q, +t, +d, +u, +n, +i, +g}:
          {==}

def Laws.m9_restart_is_a_replay(evs, alive):
  restart_replay(alive, S.world(evs))

# ---- B39
# The in-flight step (B39, B40): the Messages in flight are the list `k` of the shared invariant `IV`, the queue is `q`, the delivered
# are `t`, the dropped are `d`, and `a` is a list this model never fills (it is empty, as in `invw`). Sending moves the queue to `k`, the receipt moves `k` to `t`,
# a kill moves `k` back to the front of `q`.

def sht(+lq: Nat, +la: Nat, +lk: Nat, +lt: Nat, +ld: Nat, +z: Nat) -> EQ(SG(lq, la, lk, Nat.add(lt, z), ld), Nat.add(z, SG(lq, la, lk, lt, ld))):
  tr(SG(lq, la, lk, Nat.add(lt, z), ld), 1n+Nat.add(z, Nat.add(lq, Nat.add(la, Nat.add(lk, Nat.add(lt, ld))))), Nat.add(z, SG(lq, la, lk, lt, ld)), sc(Nat.add(lq, Nat.add(la, Nat.add(lk, Nat.add(Nat.add(lt, z), ld)))), Nat.add(z, Nat.add(lq, Nat.add(la, Nat.add(lk, Nat.add(lt, ld))))), tr(Nat.add(lq, Nat.add(la, Nat.add(lk, Nat.add(Nat.add(lt, z), ld)))), Nat.add(lq, Nat.add(z, Nat.add(la, Nat.add(lk, Nat.add(lt, ld))))), Nat.add(z, Nat.add(lq, Nat.add(la, Nat.add(lk, Nat.add(lt, ld))))), ar(lq, Nat.add(la, Nat.add(lk, Nat.add(Nat.add(lt, z), ld))), Nat.add(z, Nat.add(la, Nat.add(lk, Nat.add(lt, ld)))), tr(Nat.add(la, Nat.add(lk, Nat.add(Nat.add(lt, z), ld))), Nat.add(la, Nat.add(z, Nat.add(lk, Nat.add(lt, ld)))), Nat.add(z, Nat.add(la, Nat.add(lk, Nat.add(lt, ld)))), ar(la, Nat.add(lk, Nat.add(Nat.add(lt, z), ld)), Nat.add(z, Nat.add(lk, Nat.add(lt, ld))), tr(Nat.add(lk, Nat.add(Nat.add(lt, z), ld)), Nat.add(lk, Nat.add(z, Nat.add(lt, ld))), Nat.add(z, Nat.add(lk, Nat.add(lt, ld))), ar(lk, Nat.add(Nat.add(lt, z), ld), Nat.add(z, Nat.add(lt, ld)), tr(Nat.add(Nat.add(lt, z), ld), Nat.add(lt, Nat.add(z, ld)), Nat.add(z, Nat.add(lt, ld)), add_assoc(lt, z, ld), swp(lt, z, ld))), swp(lk, z, Nat.add(lt, ld)))), swp(la, z, Nat.add(lk, Nat.add(lt, ld))))), swp(lq, z, Nat.add(la, Nat.add(lk, Nat.add(lt, ld)))))), sy(Nat.add(z, 1n+Nat.add(lq, Nat.add(la, Nat.add(lk, Nat.add(lt, ld))))), 1n+Nat.add(z, Nat.add(lq, Nat.add(la, Nat.add(lk, Nat.add(lt, ld))))), add_succ_r(z, Nat.add(lq, Nat.add(la, Nat.add(lk, Nat.add(lt, ld)))))))

# Typing: the queue becomes the batch in flight (none was in flight).
def sm_ty(+q: +List<Nat>, +a: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +hs: L.T(SUMB(q, a, [], t, d, n))) -> L.T(SUMB([], a, q, t, d, n)):
  eq_intro(SG(0n, S.len(a), S.len(q), S.len(t), S.len(d)), n, tr(SG(0n, S.len(a), S.len(q), S.len(t), S.len(d)), SG(S.len(q), S.len(a), 0n, S.len(t), S.len(d)), n, tr(SG(0n, S.len(a), S.len(q), S.len(t), S.len(d)), Nat.add(S.len(q), SG(0n, S.len(a), 0n, S.len(t), S.len(d))), SG(S.len(q), S.len(a), 0n, S.len(t), S.len(d)), shk(0n, S.len(a), 0n, S.len(t), S.len(d), S.len(q)), sy(SG(S.len(q), S.len(a), 0n, S.len(t), S.len(d)), Nat.add(S.len(q), SG(0n, S.len(a), 0n, S.len(t), S.len(d))), shq(0n, S.len(a), 0n, S.len(t), S.len(d), S.len(q)))), L.eq_elim(SG(S.len(q), S.len(a), 0n, S.len(t), S.len(d)), n, hs)))

# The Signal: the batch in flight is delivered.
def sm_cf(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +hs: L.T(SUMB(q, a, k, t, d, n))) -> L.T(SUMB(q, a, [], List.append(&2, Nat, t, k), d, n)):
  eq_intro(SG(S.len(q), S.len(a), 0n, S.len(List.append(&2, Nat, t, k)), S.len(d)), n, tr(SG(S.len(q), S.len(a), 0n, S.len(List.append(&2, Nat, t, k)), S.len(d)), Nat.add(S.len(k), SG(S.len(q), S.len(a), 0n, S.len(t), S.len(d))), n, tr(SG(S.len(q), S.len(a), 0n, S.len(List.append(&2, Nat, t, k)), S.len(d)), SG(S.len(q), S.len(a), 0n, Nat.add(S.len(t), S.len(k)), S.len(d)), Nat.add(S.len(k), SG(S.len(q), S.len(a), 0n, S.len(t), S.len(d))), cgt(S.len(q), S.len(a), 0n, S.len(List.append(&2, Nat, t, k)), Nat.add(S.len(t), S.len(k)), S.len(d), len_app(t, k)), sht(S.len(q), S.len(a), 0n, S.len(t), S.len(d), S.len(k))), tr(Nat.add(S.len(k), SG(S.len(q), S.len(a), 0n, S.len(t), S.len(d))), SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), n, sy(SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), Nat.add(S.len(k), SG(S.len(q), S.len(a), 0n, S.len(t), S.len(d))), shk(S.len(q), S.len(a), 0n, S.len(t), S.len(d), S.len(k))), L.eq_elim(SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), n, hs))))

def len_app_comm(+a: +List<Nat>, +b: +List<Nat>) -> EQ(S.len(List.append(&2, Nat, a, b)), S.len(List.append(&2, Nat, b, a))):
  tr(S.len(List.append(&2, Nat, a, b)), Nat.add(S.len(a), S.len(b)), S.len(List.append(&2, Nat, b, a)), len_app(a, b), tr(Nat.add(S.len(a), S.len(b)), Nat.add(S.len(b), S.len(a)), S.len(List.append(&2, Nat, b, a)), add_comm(S.len(a), S.len(b)), sy(S.len(List.append(&2, Nat, b, a)), Nat.add(S.len(b), S.len(a)), len_app(b, a))))

# The kill: the batch in flight is pending again, ahead of the queue.
def sm_kill(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +hs: L.T(SUMB(q, a, k, t, d, n))) -> L.T(SUMB(List.append(&2, Nat, k, q), a, [], t, d, n)):
  eq_intro(SG(S.len(List.append(&2, Nat, k, q)), S.len(a), 0n, S.len(t), S.len(d)), n, tr(SG(S.len(List.append(&2, Nat, k, q)), S.len(a), 0n, S.len(t), S.len(d)), SG(S.len(List.append(&2, Nat, q, k)), S.len(a), 0n, S.len(t), S.len(d)), n, cgq(S.len(List.append(&2, Nat, k, q)), S.len(List.append(&2, Nat, q, k)), S.len(a), 0n, S.len(t), S.len(d), len_app_comm(k, q)), L.eq_elim(SG(S.len(List.append(&2, Nat, q, k)), S.len(a), 0n, S.len(t), S.len(d)), n, sm_te(q, a, k, t, d, n, hs))))

def inv_ty(+q: +List<Nat>, +a: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: L.T(IV(q, a, [], t, d, n))) -> L.T(IV([], a, q, t, d, n)):
  mk([], a, q, t, d, n, {==}, p1(q, a, [], t, d, n, h), p0(q, a, [], t, d, n, h), p3(q, a, [], t, d, n, h), p4(q, a, [], t, d, n, h), {==}, {==}, {==}, {==}, dj_sym(q, a, p5(q, a, [], t, d, n, h)), p10(q, a, [], t, d, n, h), p11(q, a, [], t, d, n, h), p7(q, a, [], t, d, n, h), p8(q, a, [], t, d, n, h), p14(q, a, [], t, d, n, h), {==}, p16(q, a, [], t, d, n, h), p15(q, a, [], t, d, n, h), p18(q, a, [], t, d, n, h), p19(q, a, [], t, d, n, h), sm_ty(q, a, t, d, n, p20(q, a, [], t, d, n, h)))

def inv_cf(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: L.T(IV(q, a, k, t, d, n))) -> L.T(IV(q, a, [], List.append(&2, Nat, t, k), d, n)):
  mk(q, a, [], List.append(&2, Nat, t, k), d, n, p0(q, a, k, t, d, n, h), p1(q, a, k, t, d, n, h), {==}, nd_app(t, k, p3(q, a, k, t, d, n, h), p2(q, a, k, t, d, n, h), dj_sym(k, t, p12(q, a, k, t, d, n, h))), p4(q, a, k, t, d, n, h), p5(q, a, k, t, d, n, h), dj_nil_r(q), dj_app_r(q, t, k, p7(q, a, k, t, d, n, h), p6(q, a, k, t, d, n, h)), p8(q, a, k, t, d, n, h), dj_nil_r(a), dj_app_r(a, t, k, p10(q, a, k, t, d, n, h), p9(q, a, k, t, d, n, h)), p11(q, a, k, t, d, n, h), {==}, {==}, dj_app_l(t, k, d, p14(q, a, k, t, d, n, h), p13(q, a, k, t, d, n, h)), p15(q, a, k, t, d, n, h), p16(q, a, k, t, d, n, h), {==}, bd_app(t, k, n, p18(q, a, k, t, d, n, h), p17(q, a, k, t, d, n, h)), p19(q, a, k, t, d, n, h), sm_cf(q, a, k, t, d, n, p20(q, a, k, t, d, n, h)))

def inv_kill(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +h: L.T(IV(q, a, k, t, d, n))) -> L.T(IV(List.append(&2, Nat, k, q), a, [], t, d, n)):
  mk(List.append(&2, Nat, k, q), a, [], t, d, n, nd_app(k, q, p2(q, a, k, t, d, n, h), p0(q, a, k, t, d, n, h), dj_sym(q, k, p6(q, a, k, t, d, n, h))), p1(q, a, k, t, d, n, h), {==}, p3(q, a, k, t, d, n, h), p4(q, a, k, t, d, n, h), dj_app_l(k, q, a, dj_sym(a, k, p9(q, a, k, t, d, n, h)), p5(q, a, k, t, d, n, h)), dj_nil_r(List.append(&2, Nat, k, q)), dj_app_l(k, q, t, p12(q, a, k, t, d, n, h), p7(q, a, k, t, d, n, h)), dj_app_l(k, q, d, p13(q, a, k, t, d, n, h), p8(q, a, k, t, d, n, h)), dj_nil_r(a), p10(q, a, k, t, d, n, h), p11(q, a, k, t, d, n, h), {==}, {==}, p14(q, a, k, t, d, n, h), bd_app(k, q, n, p17(q, a, k, t, d, n, h), p15(q, a, k, t, d, n, h)), p16(q, a, k, t, d, n, h), {==}, p18(q, a, k, t, d, n, h), p19(q, a, k, t, d, n, h), sm_kill(q, a, k, t, d, n, p20(q, a, k, t, d, n, h)))

def invf(+s: M.Fl) -> Bool:
  IV(S.f_queue(s), [], S.f_inflight(s), S.f_delivered(s), S.f_dropped(s), S.f_next(s))

def fidle_go_inv(+inf: +List<Nat>, +q: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, g: Bool, +h: L.T(IV(q, [], inf, t, d, n))) -> L.T(invf(M.fidle_go(inf, q, t, d, n, g))):
  match inf:
    case Nil{}:
      inv_ty(q, [], t, d, n, h)
    case Con{+x, +rest}:
      h

def fidle_inv(+s: M.Fl, +h: L.T(invf(s))) -> L.T(invf(M.fidle(s))):
  match s:
    case M.F{+q, +inf, +t, +d, +n, +g}:
      match g:
        case True{}:
          h
        case False{}:
          fidle_go_inv(inf, q, t, d, n, False{}, h)

def fsend_inv(+s: M.Fl, +h: L.T(invf(s))) -> L.T(invf(M.fsend(s))):
  match s:
    case M.F{+q, +inf, +t, +d, +n, +g}:
      match g:
        case True{}:
          h
        case False{}:
          inv_sendQ(q, [], inf, t, d, n, h)

def fconfirm_inv(+s: M.Fl, +h: L.T(invf(s))) -> L.T(invf(M.fconfirm(s))):
  match s:
    case M.F{+q, +inf, +t, +d, +n, +g}:
      inv_cf(q, [], inf, t, d, n, h)

def fkill_inv(+s: M.Fl, +h: L.T(invf(s))) -> L.T(invf(M.fkill(s))):
  match s:
    case M.F{+q, +inf, +t, +d, +n, +g}:
      inv_kill(q, [], inf, t, d, n, h)

def fexit_inv(+s: M.Fl, +h: L.T(invf(s))) -> L.T(invf(M.fexit(s))):
  match s:
    case M.F{+q, +inf, +t, +d, +n, +g}:
      inv_ex(q, [], inf, t, d, n, h)

def fstep_inv(e: M.FEv, +s: M.Fl, +h: L.T(invf(s))) -> L.T(invf(M.fstep(e, s))):
  match e:
    case M.FSend{}:
      fsend_inv(s, h)
    case M.FIdle{}:
      fidle_inv(s, h)
    case M.FConfirm{}:
      fconfirm_inv(s, h)
    case M.FKill{}:
      fkill_inv(s, h)
    case M.FExit{}:
      fexit_inv(s, h)

def frun_inv(+evs: +List<M.FEv>, +s: M.Fl, +h: L.T(invf(s))) -> L.T(invf(M.frun(evs, s))):
  match evs:
    case Nil{}:
      h
    case Con{e, +rest}:
      frun_inv(rest, M.fstep(e, s), fstep_inv(e, s, h))

def finv_world(+evs: +List<M.FEv>) -> L.T(invf(S.fworld(evs))):
  frun_inv(evs, M.finit(), mk([], [], [], [], [], 1n, {==}, {==}, {==}, {==}, {==}, {==}, {==}, {==}, {==}, {==}, {==}, {==}, {==}, {==}, {==}, {==}, {==}, {==}, {==}, {==}, {==}))

def b39_delivered_main(+evs: +List<M.FEv>) -> L.T(S.nodup(S.f_delivered(S.fworld(evs)))):
  p3(S.f_queue(S.fworld(evs)), [], S.f_inflight(S.fworld(evs)), S.f_delivered(S.fworld(evs)), S.f_dropped(S.fworld(evs)), S.f_next(S.fworld(evs)), finv_world(evs))

def Laws.b39_delivered_at_most_once(evs):
  b39_delivered_main(evs)

def b40_main(+evs: +List<M.FEv>) -> L.T(Bool.and(S.disjoint(S.f_delivered(S.fworld(evs)), S.f_queue(S.fworld(evs))), S.disjoint(S.f_delivered(S.fworld(evs)), S.f_inflight(S.fworld(evs))))):
  L.and_i(S.disjoint(S.f_delivered(S.fworld(evs)), S.f_queue(S.fworld(evs))), S.disjoint(S.f_delivered(S.fworld(evs)), S.f_inflight(S.fworld(evs))), dj_sym(S.f_queue(S.fworld(evs)), S.f_delivered(S.fworld(evs)), p7(S.f_queue(S.fworld(evs)), [], S.f_inflight(S.fworld(evs)), S.f_delivered(S.fworld(evs)), S.f_dropped(S.fworld(evs)), S.f_next(S.fworld(evs)), finv_world(evs))), dj_sym(S.f_inflight(S.fworld(evs)), S.f_delivered(S.fworld(evs)), p12(S.f_queue(S.fworld(evs)), [], S.f_inflight(S.fworld(evs)), S.f_delivered(S.fworld(evs)), S.f_dropped(S.fworld(evs)), S.f_next(S.fworld(evs)), finv_world(evs))))

def Laws.b39_a_retry_never_retypes_a_delivered_message(evs):
  b40_main(evs)

def b39_sum_main(+evs: +List<M.FEv>) -> EQ(SG(S.len(S.f_queue(S.fworld(evs))), 0n, S.len(S.f_inflight(S.fworld(evs))), S.len(S.f_delivered(S.fworld(evs))), S.len(S.f_dropped(S.fworld(evs)))), S.f_next(S.fworld(evs))):
  L.eq_elim(SG(S.len(S.f_queue(S.fworld(evs))), 0n, S.len(S.f_inflight(S.fworld(evs))), S.len(S.f_delivered(S.fworld(evs))), S.len(S.f_dropped(S.fworld(evs)))), S.f_next(S.fworld(evs)), p20(S.f_queue(S.fworld(evs)), [], S.f_inflight(S.fworld(evs)), S.f_delivered(S.fworld(evs)), S.f_dropped(S.fworld(evs)), S.f_next(S.fworld(evs)), finv_world(evs)))

def Laws.b39_no_silent_loss_in_flight(evs):
  b39_sum_main(evs)

# ---- A35
# A35: safety/liveness of the reserved schedule is a refinement into existing proved steps.
# These quantify every before/during/after schedule, not a fixed example. Liveness requires
# coordinator release before the existing fair idle cycle; an indefinitely failed restart
# deliberately keeps pending work. No law or predicate above is weakened.
def a35_m1(+before: +List<M.Ev>, during: +List<M.Ev>, after: +List<M.Ev>) -> L.T(S.nodup(S.typed(S.world(M.restart_window(before, during, after))))):
  m1_main(M.restart_window(before, during, after))

def a35_m4(+before: +List<M.Ev>, +during: +List<M.Ev>, +after: +List<M.Ev>, e: M.Ev) -> L.T(S.is_prefix(S.typed(S.world(M.restart_window(before, during, after))), S.typed(M.step(e, S.world(M.restart_window(before, during, after)))))):
  m4_main(M.restart_window(before, during, after), e)

def a35_m10(+before: +List<M.Ev>, +during: +List<M.Ev>, +after: +List<M.Ev>) -> L.T(S.implies(Bool.not(S.gone(S.world(M.restart_window(before, during, after)))), S.is_nil(S.queue(M.run(S.cycle(S.len(S.queue(S.world(M.restart_window(before, during, after))))), S.world(M.restart_window(before, during, after))))))):
  m10_main(M.restart_window(before, during, after))

def a35_m9(+before: +List<M.Ev>, +during: +List<M.Ev>, +after: +List<M.Ev>, +alive: Bool) -> {S.records(M.step(M.Restart{alive}, S.world(M.restart_window(before, during, after)))) == S.replay(S.records(S.world(M.restart_window(before, during, after))), alive) : S.Rec}:
  restart_replay(alive, S.world(M.restart_window(before, during, after)))

# Shared-id conservation for acknowledgement: one new delivered record and one new id.
def a35_sum_record(+q: +List<Nat>, +a: +List<Nat>, +k: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +n: Nat, +hs: L.T(SUMB(q, a, k, t, d, n))) -> L.T(SUMB(q, a, k, M.snoc(t, n), d, 1n+n)):
  eq_intro(SG(S.len(q), S.len(a), S.len(k), S.len(M.snoc(t, n)), S.len(d)), 1n+n, tr(SG(S.len(q), S.len(a), S.len(k), S.len(M.snoc(t, n)), S.len(d)), SG(S.len(q), S.len(a), S.len(k), 1n+S.len(t), S.len(d)), 1n+n, cgt(S.len(q), S.len(a), S.len(k), S.len(M.snoc(t, n)), 1n+S.len(t), S.len(d), len_snoc(t, n)), tr(SG(S.len(q), S.len(a), S.len(k), 1n+S.len(t), S.len(d)), 1n+SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), 1n+n, bt(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), sc(SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), n, L.eq_elim(SG(S.len(q), S.len(a), S.len(k), S.len(t), S.len(d)), n, hs)))))

def a35_m5(+before: +List<M.Ev>, +during: +List<M.Ev>, +after: +List<M.Ev>) -> L.T(Bool.and(S.disjoint(S.typed(S.world(M.restart_window(before, during, after))), S.dropped(S.world(M.restart_window(before, during, after)))), S.disjoint(S.typed(S.world(M.restart_window(before, during, after))), S.queue(S.world(M.restart_window(before, during, after)))))):
  m5_main(M.restart_window(before, during, after))

def a35_m6(+before: +List<M.Ev>, +during: +List<M.Ev>, +after: +List<M.Ev>) -> EQ(SG(S.len(S.queue(S.world(M.restart_window(before, during, after)))), 0n, 0n, S.len(S.typed(S.world(M.restart_window(before, during, after)))), S.len(S.dropped(S.world(M.restart_window(before, during, after))))), S.next_id(S.world(M.restart_window(before, during, after)))):
  m6_main(M.restart_window(before, during, after))

def a35_m7(+before: +List<M.Ev>, +during: +List<M.Ev>, +after: +List<M.Ev>, +fu: Bool, +r: M.Route) -> L.T(Bool.and(S.implies(S.gone(S.world(M.restart_window(before, during, after))), S.is_nil(S.queue(S.world(M.restart_window(before, during, after))))), S.implies(S.gone(S.world(M.restart_window(before, during, after))), Nat.is_eq(S.next_id(M.step(M.Send{fu, r}, S.world(M.restart_window(before, during, after)))), S.next_id(S.world(M.restart_window(before, during, after))))))):
  m7_main(M.restart_window(before, during, after), fu, r)

def a35_reserved_stop(s: M.World) -> {S.records(M.step(M.restart_event(True{}, M.Exit{}), s)) == S.records(s) : S.Rec}:
  match s:
    case M.W{+q, +t, +d, +u, +n, +i, +g}:
      {==}

def a35_reserved_reopen(s: M.World, alive: Bool) -> {S.records(M.step(M.restart_event(True{}, M.Restart{alive}), s)) == S.records(s) : S.Rec}:
  match s:
    case M.W{+q, +t, +d, +u, +n, +i, +g}:
      {==}

def a35_reserved_idle(s: M.World) -> {S.records(M.step(M.restart_event(True{}, M.Idle{}), s)) == S.records(s) : S.Rec}:
  match s:
    case M.W{+q, +t, +d, +u, +n, +i, +g}:
      {==}

def a35_prompt_record_is_idempotent(+j: M.PromptJournal) -> {M.record_prompt(M.record_prompt(j)) == M.record_prompt(j) : M.PromptJournal}:
  match j:
    case M.Journal{+record, +world}:
      match record:
        case M.Recorded{id}:
          {==}
        case M.Unrecorded{}:
          match world:
            case M.W{+q, +t, +d, +u, +n, +i, +g}:
              {==}

def a35_prompt_count(+j: M.PromptJournal) -> Bool:
  match j:
    case M.Journal{+record, +world}:
      SUMB(S.queue(world), [], [], S.typed(world), S.dropped(world), S.next_id(world))

def a35_prompt_m6(+j: M.PromptJournal, +h: L.T(a35_prompt_count(j))) -> L.T(a35_prompt_count(M.record_prompt(j))):
  match j:
    case M.Journal{+record, +world}:
      match record:
        case M.Recorded{id}:
          h
        case M.Unrecorded{}:
          match world:
            case M.W{+q, +t, +d, +u, +n, +i, +g}:
              a35_sum_record(q, [], [], t, d, n, h)

def a35_prompt_m1(+j: M.PromptJournal, +h: L.T(invw(M.journal_world(j)))) -> L.T(S.nodup(S.typed(M.journal_world(M.record_prompt(j))))):
  match j:
    case M.Journal{record, world}:
      match record:
        case M.Recorded{id}:
          match world:
            case M.W{+q, +t, +d, +u, +n, +i, +g}:
              p3(q, [], [], t, d, n, h)
        case M.Unrecorded{}:
          match world:
            case M.W{+q, +t, +d, +u, +n, +i, +g}:
              nd_snoc(t, n, p3(q, [], [], t, d, n, h), bd_fresh(t, n, p18(q, [], [], t, d, n, h)))

def a35_prompt_m4(+j: M.PromptJournal) -> L.T(S.is_prefix(S.typed(M.journal_world(j)), S.typed(M.journal_world(M.record_prompt(j))))):
  match j:
    case M.Journal{+record, +world}:
      match record:
        case M.Recorded{id}:
          prefix_refl(S.typed(world))
        case M.Unrecorded{}:
          match world:
            case M.W{+q, +t, +d, +u, +n, +i, +g}:
              prefix_snoc(t, n)

def a35_prompt_disjoint_dropped(+j: M.PromptJournal, +h: L.T(invw(M.journal_world(j)))) -> L.T(S.disjoint(S.typed(M.journal_world(M.record_prompt(j))), S.dropped(M.journal_world(M.record_prompt(j))))):
  match j:
    case M.Journal{record, world}:
      match record:
        case M.Recorded{id}:
          match world:
            case M.W{+q, +t, +d, +u, +n, +i, +g}:
              p14(q, [], [], t, d, n, h)
        case M.Unrecorded{}:
          match world:
            case M.W{+q, +t, +d, +u, +n, +i, +g}:
              dj_snoc_l(t, d, n, p14(q, [], [], t, d, n, h), bd_fresh(d, n, p19(q, [], [], t, d, n, h)))

def a35_prompt_disjoint_queue(+j: M.PromptJournal, +h: L.T(invw(M.journal_world(j)))) -> L.T(S.disjoint(S.typed(M.journal_world(M.record_prompt(j))), S.queue(M.journal_world(M.record_prompt(j))))):
  match j:
    case M.Journal{record, world}:
      match record:
        case M.Recorded{id}:
          match world:
            case M.W{+q, +t, +d, +u, +n, +i, +g}:
              dj_sym(q, t, p7(q, [], [], t, d, n, h))
        case M.Unrecorded{}:
          match world:
            case M.W{+q, +t, +d, +u, +n, +i, +g}:
              dj_snoc_l(t, q, n, dj_sym(q, t, p7(q, [], [], t, d, n, h)), bd_fresh(q, n, p15(q, [], [], t, d, n, h)))

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
            case M.W{+q, +t, +d, +u, +n, +i, +g}:
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

# M5/M6: stop, loss, reopen and rejected sends preserve every status list and its order.
def a35_retirement_stop(r: M.Retirement, w: M.World) -> {S.records(M.step(M.retirement_event(r, M.Exit{}), w)) == S.records(w) : S.Rec}:
  match w:
    case M.W{+q, +t, +d, +u, +n, +i, +g}:
      {==}

def a35_retirement_idle_never_types(r: M.Retirement, w: M.World) -> {S.typed(M.step(M.retirement_event(r, M.Idle{}), w)) == S.typed(w) : +List<Nat>}:
  match w:
    case M.W{+q, +t, +d, +u, +n, +i, +g}:
      {==}

def a35_retirement_send_refused(r: M.Retirement, w: M.World, user: Bool, route: M.Route) -> {S.records(M.step(M.retirement_event(r, M.Send{user, route}), w)) == S.records(w) : S.Rec}:
  match w:
    case M.W{+q, +t, +d, +u, +n, +i, +g}:
      {==}

# M9: the SQLite retirement frame replays archived records, including after Rail removal.
def a35_retirement_reopen_records(s: M.RetirementStore) -> {S.records(M.retirement_world(M.reopen_retirement(s))) == S.records(M.retirement_world(s)) : S.Rec}:
  match s:
    case M.Retained{r, w}:
      match w:
        case M.W{+q, +t, +d, +u, +n, +i, +g}:
          {==}

def a35_retirement_reopen_selection(s: M.RetirementStore) -> {M.retirement_state(M.reopen_retirement(s)) == M.retirement_state(s) : M.Retirement}:
  match s:
    case M.Retained{r, w}:
      match w:
        case M.W{+q, +t, +d, +u, +n, +i, +g}:
          {==}
