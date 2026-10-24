import Base
import ./LAWS.bend as Laws
import ./model.bend as M
import ./spec.bend as S
import ./LIB.bend as L

# M2: a held Message leaves only by its owner.
def fl_go2(+q: +List<Nat>, +haf: +List<Nat>, +htk: +List<Nat>, +t: +List<Nat>, +d: +List<Nat>, +u: +List<Nat>, +tt: +List<Nat>, +rl: +List<Nat>, +n: Nat, +us: Bool, +tk: Bool, +i: Bool, +g: Bool, +s0: +List<Nat>) -> L.T(S.all_in(haf, S.held_af(M.flush_go(q, M.W{s0, haf, htk, t, d, u, tt, rl, n, tk, us, i, g})))):
  match q:
    case Nil{}:
      L.all_in_refl(haf)
    case Con{+x, +rest}:
      fl_go2(rest, haf, htk, M.snoc(t, x), d, u, M.record(Bool.or(tk, us), x, tt), rl, n, us, tk, False{}, g, [])

def fl2(+s: M.World) -> L.T(S.all_in(S.held_af(s), S.held_af(M.flush(s)))):
  match s:
    case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +us, +i, +g}:
      match i:
        case False{}:
          L.all_in_refl(haf)
        case True{}:
          fl_go2(q, haf, htk, t, d, u, tt, rl, n, us, tk, True{}, g, [])

def H2(+s: M.World, +s2: M.World) -> Bool:
  S.all_in(S.held_af(s), S.held_af(s2))

def send_auto2(fu: Bool, +s: M.World) -> L.T(H2(s, M.send_auto(fu, s))):
  match fu:
    case True{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +us, +i, +g}:
          match tk:
            case True{}:
              L.all_in_refl(haf)
            case False{}:
              match us:
                case True{}:
                  L.all_in_refl(haf)
                case False{}:
                  fl2(M.W{M.snoc(q, n), haf, htk, t, d, M.snoc(u, n), tt, rl, 1n+n, False{}, False{}, i, g})
    case False{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +us, +i, +g}:
          match tk:
            case True{}:
              L.all_in_refl(haf)
            case False{}:
              match us:
                case True{}:
                  L.all_in_refl(haf)
                case False{}:
                  fl2(M.W{M.snoc(q, n), haf, htk, t, d, u, tt, rl, 1n+n, False{}, False{}, i, g})

def send_ev2(fu: Bool, r: M.Route, +s: M.World) -> L.T(H2(s, M.send_ev(fu, r, s))):
  match r:
    case M.Auto{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +us, +i, +g}:
          match g:
            case True{}:
              L.all_in_refl(haf)
            case False{}:
              send_auto2(fu, M.W{q, haf, htk, t, d, u, tt, rl, n, tk, us, i, False{}})
    case M.AskFirst{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +us, +i, +g}:
          match g:
            case True{}:
              L.all_in_refl(haf)
            case False{}:
              L.all_in_snoc_self(haf, n)
    case M.RouteDrop{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +us, +i, +g}:
          match g:
            case True{}:
              L.all_in_refl(haf)
            case False{}:
              L.all_in_refl(haf)

def step2(e: M.Ev, +s: M.World) -> L.T(S.implies(Bool.not(S.is_user_call(e)), H2(s, M.step(e, s)))):
  match e:
    case M.Send{fu, r}:
      send_ev2(fu, r, s)
    case M.Idle{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +us, +i, +g}:
          match g:
            case True{}:
              L.all_in_refl(haf)
            case False{}:
              fl2(M.W{q, haf, htk, t, d, u, tt, rl, n, tk, us, True{}, False{}})
    case M.Busy{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +us, +i, +g}:
          L.all_in_refl(haf)
    case M.Exit{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +us, +i, +g}:
          L.all_in_refl(haf)
    case M.TakeoverBegin{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +us, +i, +g}:
          L.all_in_refl(haf)
    case M.TakeoverEnd{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +us, +i, +g}:
          match us:
            case True{}:
              L.all_in_refl(haf)
            case False{}:
              fl2(M.W{List.append(&2, Nat, q, htk), haf, [], t, d, u, tt, rl, n, False{}, False{}, i, g})
    case M.UserInput{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +us, +i, +g}:
          L.all_in_refl(haf)
    case M.UserSubmit{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +us, +i, +g}:
          match tk:
            case True{}:
              L.all_in_refl(haf)
            case False{}:
              fl2(M.W{List.append(&2, Nat, q, htk), haf, [], t, d, u, tt, rl, n, False{}, False{}, i, g})
    case M.UserClear{}:
      match s:
        case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +us, +i, +g}:
          match tk:
            case True{}:
              L.all_in_refl(haf)
            case False{}:
              fl2(M.W{List.append(&2, Nat, q, htk), haf, [], t, d, u, tt, rl, n, False{}, False{}, i, g})
    case M.UserDeliver{id}:
      {==}
    case M.UserDrop{id}:
      {==}
    case M.Restart{alive}:
      match alive:
        case True{}:
          match s:
            case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +us, +i, +g}:
              fl2(M.W{List.append(&2, Nat, q, htk), haf, [], t, d, u, tt, rl, n, False{}, False{}, False{}, g})
        case False{}:
          match s:
            case M.W{+q, +haf, +htk, +t, +d, +u, +tt, +rl, +n, +tk, +us, +i, +g}:
              fl2(M.W{[], haf, [], t, List.append(&2, Nat, d, List.append(&2, Nat, q, htk)), u, tt, rl, n, False{}, False{}, False{}, True{}})

def m2_main(+evs: +List<M.Ev>, e: M.Ev) -> L.T(S.implies(Bool.not(S.is_user_call(e)), S.all_in(S.held_af(S.world(evs)), S.held_af(M.step(e, S.world(evs)))))):
  step2(e, S.world(evs))

def Laws.m2_held_leaves_only_by_its_owner(evs, e):
  m2_main(evs, e)
