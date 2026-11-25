---- MODULE RestartHold ----
\* U7191h: the Restart hold of `crates/rupd/src/restart.rs` over every order of its faults.
EXTENDS Naturals

CONSTANTS Keys, MaxPrograms

VARIABLES hold, holdKey, key, prog, alive, typed, answer

vars == <<hold, holdKey, key, prog, alive, typed, answer>>

States == {"none", "Reserved", "Starting", "Typing", "Started", "Acknowledged", "Released"}
Holding == {"Reserved", "Starting", "Typing", "Started", "Acknowledged"}
InFlight == {"Starting", "Typing", "Started", "Acknowledged"}

Init == /\ hold = "none" /\ holdKey = 0 /\ key \in Keys /\ prog = 0 /\ alive = FALSE
        /\ typed = [p \in 0..MaxPrograms |-> 0] /\ answer = "none"

\* A refusal always names what blocks it: the same request key left a program in flight.
Blocker == IF hold \in InFlight /\ holdKey = key THEN "unknown-outcome" ELSE "none"

\* A new request key takes over any other hold and stops the old program first (U7191d).
Restart ==
  /\ prog < MaxPrograms
  /\ \/ /\ Blocker = "none"
        /\ hold' = "Reserved" /\ holdKey' = key /\ prog' = prog + 1 /\ alive' = FALSE
        /\ answer' = "ok"
     \/ /\ Blocker # "none" /\ answer' = Blocker
        /\ UNCHANGED <<hold, holdKey, prog, alive>>
  /\ UNCHANGED <<key, typed>>

Start == /\ hold = "Reserved" /\ hold' = "Starting" /\ UNCHANGED <<holdKey, key, prog, alive, typed, answer>>
Started == /\ hold = "Starting" /\ hold' = "Started" /\ alive' = TRUE
           /\ UNCHANGED <<holdKey, key, prog, typed, answer>>
\* A start that failed with nothing typed returns to Reserved or frees the hold (U7191d).
StartFails == /\ hold = "Starting" /\ hold' = "Reserved" /\ UNCHANGED <<holdKey, key, prog, alive, typed, answer>>
Type == /\ hold = "Started" /\ alive /\ hold' = "Typing"
        /\ typed' = [typed EXCEPT ![prog] = @ + 1]
        /\ UNCHANGED <<holdKey, key, prog, alive, answer>>
Ack == /\ hold = "Typing" /\ hold' = "Acknowledged" /\ UNCHANGED <<holdKey, key, prog, alive, typed, answer>>
Release == /\ hold = "Acknowledged" /\ hold' = "Released" /\ UNCHANGED <<holdKey, key, prog, alive, typed, answer>>

\* The faults.
CoreKilled == /\ alive' = FALSE /\ UNCHANGED <<hold, holdKey, key, prog, typed, answer>>
Reload == /\ key' \in Keys /\ UNCHANGED <<hold, holdKey, prog, alive, typed, answer>>
DaemonRestart == UNCHANGED vars \* the hold is durable and nothing expires it
RailRemoval == /\ hold \in Holding /\ hold' = "Released" /\ alive' = FALSE
               /\ UNCHANGED <<holdKey, key, prog, typed, answer>>

Next == Restart \/ Start \/ Started \/ StartFails \/ Type \/ Ack \/ Release
        \/ CoreKilled \/ Reload \/ DaemonRestart \/ RailRemoval

Spec == Init /\ [][Next]_vars

TypeOK == hold \in States /\ answer \in {"none", "ok", "unknown-outcome"}
\* A refusal is only ever the named one: this request key left a program in flight.
RefusalNamed == [][(answer' = "unknown-outcome" /\ answer # "unknown-outcome") => (hold \in InFlight /\ holdKey = key)]_vars
\* A Mode prompt is typed at most once per program.
TypedOnce == \A p \in 0..MaxPrograms : typed[p] <= 1
====
