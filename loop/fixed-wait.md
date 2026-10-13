# L109 fixed-wait lint

`just check-rust` and `just check-web` run `loop/fixed-wait.sh` with
pinned Rust and TypeScript Tree-sitter grammars. The web recipe also runs
`loop/fixed-wait.sh test`. CI uses the same recipes, including the Rust lane;
its full checkout makes the implementation base available. The launcher creates
an isolated Python environment under ignored `target/` on first use.

The implementation base is `5b45b72c7f882557b2bf5dc0c9b50c1edff50a26`.

The lint follows local functions and imported helpers transitively from test
files (`.ts`, `.tsx`, `.mts`, `.cts`), Rust test attributes and TypeScript test callbacks. Rust macro token
bodies get a second position-preserving parse. Changed source that the grammar
cannot parse fails visibly. Diagnostics identify file, line, expression and
`awaited state missing`.

State-conditioned loops may use poll intervals. Promise delays, blocking sleeps
and `waitForTimeout` calls do not establish state. Throwing/rejecting timer
callbacks are hang guards when their diagnostic names what they await. Timeout
budgets, product timer callbacks, and timer subjects with explicitly advanced
fake clocks remain permitted. No assertion, timeout, retry or pty limit changes.

`fixed-wait-baseline.json` stores the immutable `base_sha` and active wait ids.
A wait must match its original file, line, column, expression and dependency fingerprint exactly. Line
shifts also require retiring that exemption and repairing the wait; they cannot
move it silently. No new exemption can be added. Committed retirement is
monotone. After removing waits, run `loop/fixed-wait.sh --retire` and commit the
baseline change. This command removes entries only; new waits still fail.

`fixed-wait-inventory.json` exports every forbidden wait found at the base for
Care's #1516 integration. `loop/fixed-wait.sh --inventory` exports the current
inventory in the same format: `format: 1`, `base_sha`, and `waits`, each with
`id`, repository-relative `file`, one-based `line`/`column`, full `expression`,
containing function `test` (or `<test module>`), and `awaited_state: missing`, and `context`, a SHA-256 of referenced value bindings
and test-reachable helper call sites. An id is the SHA-256 of its file, parser
location, expression and context. New helper callers or changed duration constants
cannot reuse a baseline exemption. The lint verifies the full base export. The file and
expression provide source/reproduction evidence; helper rows identify the
helper containing the wait. #1516 owns runner identity enrichment, ranking,
deferred findings and publication. This PR delivers only that lint prerequisite.
