# Machines (step 2 of the Multi-Machine Strategy)

Module: `crates/herdr` and `crates/rupd`. Decision: `docs/adr/0012-herdr-core-machine-layer.md`; Principles: P15 and P16 in `PRINCIPLES.md`. herdr-core is the machine layer; `rupd` and the Doors stay on this Mac. This file is specification only; each planned test ships with its implementation Issue.

**Machine** (`Machine`, `machine.list`, `machine.add`): a place an Agent runs and a Project folder lives, as herdr-core lists it, this Mac included. roundup stores no machine row and has no machine table.

## Checks on main

1. `PRINCIPLES.md`, headings `P3 Cards over chatter` and `P4 Black-box harness`: the Gates MC4 and MC3 rely on, unchanged.
2. `GLOSSARY.md`, section `Daemon and Extensions`: the Machine row.
3. `docs/adr/0003-daemon-json-rpc-unix-socket.md`: `rupd`'s socket, which the bridge relays to.

**MC1 the machine list is herdr-core's.** Given herdr-core lists `roundup-ci-control`, when roundup reads machines, then `machine.list`'s answer appears as it is, with `roundup-ci-control` among it, and roundup stores no machine row (planned test: `mc1_machine_list_is_herdr_cores`, asserting the reply equals herdr-core's list against a fake herdr-core and that the Daemon's data holds no machine table).

**MC2 adding a machine is `machine.add`.** Given an ssh name, when the user adds a machine, then roundup calls `machine.add` with that name and shows no Add-machine dialog (planned tests: `mc2_add_calls_machine_add` for the call; `mc2_no_add_machine_dialog` for the absent dialog, asserting by role that no such dialog opens). Where the user adds one, a `rup` command or a Door tool, is the implementation's call within MC3.

**MC3 a machine shows as a chip or status on an Agent, nowhere else.** Given machines listed, when the App renders, then a machine appears only as a chip or a status on an Agent: no machine sidebar, no Rail level, no dispatch panel (planned test: `mc3_machine_only_on_agent`, asserting by role that no sidebar, Rail level or panel names a machine; P16's Observer).

**MC4 an unreachable machine layer fails loud.** Given herdr-core is missing, refuses the version (`unsupported_generation`), or does not answer, when roundup reads machines, then a coded error is returned, no alert fires and work on this Mac continues (planned tests: `mc4_missing_refused_silent_return_coded_error` for the three causes; `mc4_no_alert_and_local_work_continues`, asserting no alert and a local Agent still starts).

Policy: the Mac dials in with one ssh bridge per machine; a queue on the machine holds reports while the Mac sleeps. boxd's API is never called; machines arrive as ssh names. Observer: `loop/rules.sh vocab` exits 0.
