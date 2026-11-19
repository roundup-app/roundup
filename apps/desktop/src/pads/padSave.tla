---- MODULE padSave ----
\* The model of `step` in padSave.ts and of what answers it: the Daemon (a write lands, is refused or is lost) and the other Agents (an outside edit).
\* P7547a-c. `just pad-save-model` runs it; padSave.dump is its reachable states and steps, which padSave.test.ts walks `step` against.
EXTENDS Naturals

CONSTANTS MaxExternal, MaxWrites

VARIABLES save, ev, flight, ver, writes, stale

vars == <<save, ev, flight, ver, writes, stale>>

\* A Save with the fields `step` reads; a field its kind does not hold has its default, so one Save has one record.
S(k, d, o, v, b) == [kind |-> k, due |-> d, over |-> o, version |-> v, byMe |-> b]
Clean == S("clean", "none", "none", 0, FALSE)
Dirty(d) == S("dirty", d, "none", 0, FALSE)
Sending(v, o, d) == S("sending", d, o, v, FALSE)
Conflict(a, v) == S("conflict", "none", a, v, FALSE)
Paused == S("paused", "none", "none", 0, FALSE)
Deleted(b) == S("deleted", "none", "none", 0, b)

\* A SaveEvent with the fields `step` reads, as for a Save.
E(k, d, v, c, m, a, b) == [kind |-> k, due |-> d, version |-> v, current |-> c, mine |-> m, actor |-> a, byMe |-> b]
Ev(k) == E(k, "none", 0, FALSE, FALSE, "none", FALSE)

DueOr(s, d) == IF s.due = "none" THEN d ELSE s.due

\* padSave.ts `handlers` and `step`.
Step(s, e) ==
  IF s.kind = "deleted" THEN
    IF e.kind = "back" THEN (IF e.actor = "none" THEN Clean ELSE Conflict(e.actor, e.version))
    ELSE IF e.kind = "gone" THEN Deleted(s.byMe \/ e.byMe)
    ELSE s
  ELSE CASE
       e.kind = "gone" -> Deleted(e.byMe)
    [] e.kind = "settled" -> Clean
    [] e.kind = "back" -> s
    [] e.kind = "external" ->
         IF s.kind = "sending" THEN [s EXCEPT !.over = e.actor, !.version = e.version]
         ELSE Conflict(e.actor, e.version)
    [] e.kind = "skipped" -> IF s.kind = "dirty" THEN Dirty("none") ELSE s
    [] e.kind = "edited" ->
         IF s.kind = "clean" \/ (s.kind = "dirty" /\ s.due # "keep-mine") THEN Dirty("none") ELSE s
    [] e.kind = "due" ->
         IF e.due = "keep-mine" THEN
           IF s.kind = "sending" THEN (IF s.over = "none" THEN s ELSE [s EXCEPT !.due = "keep-mine"])
           ELSE IF s.kind = "conflict" THEN s ELSE Dirty("keep-mine")
         ELSE IF s.kind = "sending" THEN [s EXCEPT !.due = DueOr(s, "autosave")]
         ELSE IF s.kind = "dirty" THEN Dirty(DueOr(s, "autosave"))
         ELSE s
    [] e.kind = "send" ->
         IF (s.kind = "dirty" /\ s.due # "none") \/ (s.kind = "conflict" /\ e.mine)
         THEN Sending(e.version, IF s.kind = "conflict" THEN s.over ELSE "none", "none")
         ELSE s
    [] e.kind = "applied" ->
         IF s.kind # "sending" THEN s
         ELSE IF s.version = e.version THEN (IF e.current THEN Clean ELSE Dirty(s.due))
         ELSE IF s.due = "keep-mine" THEN Dirty("keep-mine")
         ELSE Conflict(IF s.over = "none" THEN "unknown" ELSE s.over, s.version)
    [] e.kind = "refused" ->
         IF s.kind # "sending" THEN s
         ELSE IF s.over = "none" THEN Dirty("none") ELSE Conflict(s.over, s.version)
    [] e.kind = "unknown" -> IF s.kind = "sending" THEN Paused ELSE s
    [] e.kind = "resume" -> IF s.kind = "paused" THEN Dirty("autosave") ELSE s

\* `flight` is the write the Daemon has not answered: the version it was sent at, and whether the Daemon takes it. A write of the field's own text lands only while the Pad holds nothing the field lacks; Keep mine always lands.
NoFlight == [on |-> FALSE, v |-> 0, lands |-> FALSE]

Init ==
  /\ save = Clean /\ ev = Ev("init") /\ flight = NoFlight /\ ver = 0 /\ writes = 0 /\ stale = FALSE

Take(e) == save' = Step(save, e) /\ ev' = e

Plain(e) == Take(e) /\ UNCHANGED <<flight, ver, writes, stale>>

Edited == Plain(Ev("edited"))
Due == \E d \in {"autosave", "keep-mine"} : Plain(E("due", d, 0, FALSE, FALSE, "none", FALSE))
Skipped == Plain(Ev("skipped"))
Resume == Plain(Ev("resume"))
\* An undo of the delete. The outside edit the field has not seen comes with it (`actor`, `version`), so a deleted save is then a conflict and not clean.
Back == \E a \in {"none", "unknown"} :
  /\ (a # "none") = stale
  /\ Plain(E("back", "none", IF a = "none" THEN 0 ELSE ver, FALSE, FALSE, a, FALSE))
Gone == \E b \in BOOLEAN : Plain(E("gone", "none", 0, FALSE, FALSE, "none", b))
Settled == Take(Ev("settled")) /\ stale' = FALSE /\ UNCHANGED <<flight, ver, writes>>

Send ==
  /\ ~flight.on
  /\ \E m \in BOOLEAN :
       LET v == IF save.kind = "conflict" THEN save.version ELSE ver
           e == E("send", "none", v, FALSE, m, "none", FALSE)
       IN /\ Take(e)
          /\ IF save.kind # "sending" /\ save'.kind = "sending"
             THEN \E lands \in BOOLEAN :
                    /\ (lands => m \/ ~stale)
                    /\ flight' = [on |-> TRUE, v |-> v, lands |-> lands]
             ELSE flight' = flight
  /\ UNCHANGED <<ver, writes, stale>>

Applied ==
  /\ flight.on /\ flight.lands /\ writes < MaxWrites
  /\ \E c \in BOOLEAN : Take(E("applied", "none", flight.v, c, FALSE, "none", FALSE))
  /\ flight' = NoFlight /\ writes' = writes + 1
  /\ stale' = IF flight.v = ver THEN FALSE ELSE stale
  /\ UNCHANGED ver

Refused ==
  /\ flight.on /\ ~flight.lands
  /\ Take(Ev("refused")) /\ flight' = NoFlight
  /\ UNCHANGED <<ver, writes, stale>>

Unknown ==
  /\ flight.on
  /\ Take(Ev("unknown")) /\ flight' = NoFlight
  /\ UNCHANGED <<ver, writes, stale>>

\* Another Agent writes the Pad. The field has no edit of its own to lose only while the save is clean, and then it takes the text (`settled`), so only a save with edits meets an `external`.
External ==
  /\ ver < MaxExternal /\ save.kind \notin {"clean", "deleted"}
  /\ \E a \in {"agent", "unknown"} : Take(E("external", "none", ver + 1, FALSE, FALSE, a, FALSE))
  /\ ver' = ver + 1 /\ stale' = TRUE
  /\ UNCHANGED <<flight, writes>>

Next == Edited \/ Due \/ Skipped \/ Resume \/ Back \/ Gone \/ Settled \/ Send \/ Applied \/ Refused \/ Unknown \/ External

Spec == Init /\ [][Next]_vars

\* "Saved" never hides an outside edit the user has not seen.
SavedNeverHidesOutsideEdit == save.kind = "clean" => ~stale
====
