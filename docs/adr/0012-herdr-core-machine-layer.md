# herdr-core is the machine layer

Status: Accepted

## Decision

herdr-core is roundup's one machine layer, and the one terminal host on every machine, this Mac included. `rupd` and the Doors stay on this Mac. The Mac dials in with one ssh bridge per machine, because boxd's ssh refuses `ssh -R`: a queue on the machine holds reports until the bridge drains it, so while the Mac sleeps remote Agents keep running and their reports wait for wake. boxd supplies machines as ssh names; roundup never calls boxd's API. roundup keeps no machine table: it reads `machine.list` and adds through `machine.add`.

## Considered

- Herdr's GUI: not adopted. Adopting it rebuilds Doors, Todos, Pads and the attention rules as trusted mods on a 0.1 beta API. Its plain-file idea is taken under rule 4 of the multi-machine plan (P16).
- Rex: not now. No licence found, remote needs a forward that dies with ssh, and auth is "planned".
- tmux: fails rule 2 (P15). It blocks OSC 7501, the Agent's status.
- `rupd` and the Doors on an always-on machine: the owner rejected it.

## Why

Spike `spikes/herdr-core-client/REPORT.md` (PR #6705):

- `ssh -R` fails on boxd (russh 0.64.1): a Unix-socket `-R` fails with `remote port forwarding failed for listen path`, and a TCP `-R` reports success while no listener exists. Dialling in works: a live JSON-RPC call took p50 35 ms, p95 53 ms (one ssh round trip); a queued report is acked after fsync in 0.34 ms p50; with the bridge dead a live call fails at once with `{"error":"away"}`.
- herdr-core 0.1.18 speaks JSON-RPC 2.0 over `ssh <host> herdr-core connect` (protocol generation 1; `hello` returns generation, version and methods; generation 2 fails with `unsupported_generation`). Connect plus hello took 0.39 s and an RPC 32 ms. Errors carry `code`, `kind` and `hint`.
- It is open source, reached through the user's own ssh, and passes OSC 7501 and the hooks and MCP channel through unchanged, so it meets P15.

## Notes

Not doing: a machine sidebar or Rail level; a dispatch panel; Rex or tmux adapters; calls to boxd's API; moving `rupd` off this Mac. Acceptance: [MC1–MC4](../../scenarios/machines.md). After the official install `herdr-core` is not on the non-interactive ssh PATH; a machine's setup must put it there.
