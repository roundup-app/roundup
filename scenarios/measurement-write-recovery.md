# Measurement revision write recovery

Module: the existing measurement collector and Rail storage in `crates/agents`.
Ids: U3119a–U3119b.

Outcome: a request collected across a failed revision write becomes discoverable to revision-based readers after storage recovers, exactly once and under a newer retained revision.

Amendment (#3574, P14): a "request" in these scenarios is an Execution interval or Timed activity after tokens and money are removed (U3016l); the acceptance is otherwise unchanged and its tests read an interval where they read a request.

Scope: repair collection persistence and revision notification using the existing Measurement, Measurements and MeasurementsChanged contracts. No new RPC, vendor interpretation, dashboard behavior, schema requirement or Message/delivery change is requested. U3016d's source/read-failure acceptance remains in force; these scenarios add the distinct revision-write failure case. This specification changes acceptance only; #3119 owns implementation and progress.

**U3119a retired.** Measurement collection and storage are removed by #4454 (`scenarios/remove-time-timeline.md`, U4454d); its tests go with the code.

**U3119b retired.** Same as U3119a.
