import Base
import ./model.bend as M
import ./spec.bend as S

# Logic and list-set lemmas the laws' proofs share. PROOF.bend reaches them as L.<name>.
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
