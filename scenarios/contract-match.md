# The App and the Daemon check they share one contract (A38, S11)

Module: `crates/contracts`, `crates/rupd`, `crates/desktop`, `contracts/generated/` and `apps/desktop`. Ids: A38, S11. From the user's report (#1178, 2026-10-12): `method not found: models.list` and `method not found: agent.spawnPrompt` after `just app` built `rupd` once and Vite then served a newer webview.

Contract change (the Contract recipe of `.agents/builder.md`). `GLOSSARY.md` gains **Contract fingerprint** (a hash of every method name with its params and result types, in `crates/contracts`; the same value is written into `contracts/generated/` and reported by the Daemon) in the implementing PR. Laws M1 to M10 are not touched. The comparison lives in the webview because it is the part that moves without a rebuild: the App's Rust side and its `rupd` are built together and cannot differ.

**A38 the Daemon reports its contract.** `daemon.ping` returns `{pong: true, contract: {fingerprint, methods}}`, where `methods` is the sorted list of every method name the Daemon serves and `fingerprint` is computed from `crates/contracts` by one function. `contracts/generated/` gains a `contract.ts` holding the same two values, regenerated from `crates/contracts` (never hand-edited, `just contracts-fresh`). Every caller of `daemon.ping` that matches its result changes in the same PR (the Builder greps `crates/` and `apps/` first and lists them). Given a Daemon, then:
- **Reported.** The ping's `fingerprint` equals the one in `contracts/generated/contract.ts`, and its `methods` equal that file's. Asserted in `a38_ping_reports_the_generated_contract`.
- **Changes with the contract.** Adding a method to a copy of the list, or changing a params type, changes the fingerprint; reordering the list does not. Asserted in `a38_fingerprint_follows_the_methods_and_types`.
- **Cold start.** Computing it is not on the start path beyond one hash of a list already in memory; rule 7's 300 ms holds (`just perf`).

**S11 the App says when the Daemon is not the one it was built with.** Uses `daemon.ping` (A38) through the App seam's method pass-through; no new App seam command and no Token. Where it lives: one notice in the open Project's window, shown once per connect. Given a Project whose webview holds `contract.ts` and whose Daemon reports its own, then:
- **Same.** Equal fingerprints show nothing, and the Project opens as today. Asserted in `s11_equal_contracts_show_no_notice`.
- **Older.** When the webview's `methods` hold a name the Daemon's do not (and not the reverse), the notice reads that the Daemon is older than the App, and that quitting and running `just app` again rebuilds it. It shows at connect, before any call is made, and once only. Asserted in `s11_an_older_daemon_is_named_before_any_call`.
- **Newer.** When the Daemon's `methods` hold a name the webview's do not (and not the reverse), the notice says the Daemon is newer than the App and gives the same remedy. Asserted in `s11_a_newer_daemon_is_named`.
- **Different.** When each holds a name the other lacks, or the names match and only the fingerprint differs, the notice says the App and the Daemon differ and gives the same remedy. Asserted in `s11_a_mixed_difference_says_they_differ`.
- **Late error.** A `METHOD_NOT_FOUND` that reaches the user (any call) reads `<method>: the App and the Daemon differ`, naming the method and giving the same remedy, instead of the bare `method not found: <method>`. Asserted in `s11_method_not_found_names_the_method_and_the_difference`.
- **No ping answer in the old shape.** A Daemon whose ping carries no `contract` (built before A38) is treated as older. Asserted in `s11_a_daemon_without_a_contract_is_older`.
- **Observer.** Vitest on the webview with a fake App seam, and the Chromium harness (`.agents/data/harness.md`) for the notice's place at D2, D5 and D6 at the scenario's viewport; the text uses Tokens only (rule 8).

Not in this scenario: restarting the Daemon when `main` moves (it stops every running Agent).
