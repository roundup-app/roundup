# RPC metadata from one declaration

Acceptance for #5459. This specification delivers no implementation. Scope is the
contract declaration and its consumers: `crates/contracts/**`, generated contracts,
`crates/rup/src/mcp/**`, `crates/rup/src/mcp.rs`, `crates/rup/tests/mcp/**`,
`crates/rup/tests/mcp.rs`, `crates/perf/**`, `docs/perf.md`,
`crates/rupd/src/describe_tests.rs` and `tools/contracts/**`.

**C5459a a new method supplies metadata once.** Given a harmless method using
existing parameter/result types and an existing owning module, when it is added,
then its only manually authored registration is one declaration plus its handler.
That declaration supplies an explicit MCP choice (all Agents, Door only, or no
tool with a non-blank reason), a perf disposition (existing measured metric names,
or a non-blank off-path reason), and a non-blank description, including methods
with no tool or a custom tool. Generate the method table, MCP offers and consumer
metadata from it; no additional method-name list, description match arm, perf
membership or test expectation needs editing (policy: inspect the isolated
addition diff). New types and handler behavior remain additional work, as C4 says
(Check 1).

Observer: extend `tools/contracts/test_addition.py`'s
`test_c4_one_declaration_reaches_every_surface` rather than add another process
probe. In its isolated checkout, declare a method with complete metadata, add its
handler and regenerate. In addition to its existing invocation, role and TS
assertions, assert that the new method's description and perf disposition reach
the production consumers without editing another registry. Removing the
declaration removes those entries too. This observer retains C4's existing name.

**C5459b missing metadata has one completeness observer.** Given the live
method declarations, when completeness is checked, then one test,
`c5459b_missing_metadata_names_the_field` in `crates/contracts`, checks the
required metadata and reports the method name and the field to fill. Its
in-memory fixture declares a method with each missing or whitespace-only field
in turn: MCP choice, no-tool reason when no tool is selected, perf disposition,
off-path reason when off-path is selected, and description. Each case fails with
its method and field named; filling that field passes. Include a method without
a description as the requested negative observer. Use the same production
metadata check for fixtures and live declarations; no Daemon, browser, process
or clock is needed. These assertions belong to that one table-driven test.
Compile-time enforced fields need no redundant runtime assertion (rule 10), but
the missing-description fixture must exercise and assert its diagnostic.

Policy: this amends M5's separate RPC membership lists, R25's hand-authored
`methods` arrays and off-path JSON registry, and I10's duplicate non-empty-summary
assertions (Checks 2–4). Their completeness proof moves to C5459b. Consumer
expectations derive from the declaration; neither consumers nor their tests
supply defaults that hide a missing field. Preserve independent App seam-command
coverage, actual MCP offers/role/schema/invocation proofs, Daemon list/describe
routing and schema-valid examples, and measured-budget validation. For each cut
assertion name the retained test proving its then-clause, or its replacement here.

**C5459c existing methods keep their metadata.** Given every method served by the
implementation's base on `origin/main`, when the declarations become the metadata
source, then each keeps its tool name, role set, input schema, parameter adaptation
and non-exposure reason; each keeps all measured-metric memberships or its off-path
reason, and its summary and full description. Policy: retain a before/after record
of these values for every base method and compare by method name, with no missing
base method or changed value. Derive the baseline from the base's production
sources, never from the migrated declaration. This finite migration record is
review evidence, not a second list a future method addition must update.

Checks 1–4 retain their independent behavioral proofs. Budget values,
measurements, regression thresholds, wire replies, permissions and Message laws
M1–M10 do not change (policy). `proofs/messages` and `docs/messages.md` remain in
agreement. Follow the Contract recipe for metadata interfaces and all callers;
regenerate `contracts/generated/`, never hand-edit it. RPC error codes are a
separate contract: Check 5 stays, including refusal/unknown classification and
code-to-copy coverage; adding a method using existing codes must need no App edit
(policy). Frozen loop machinery and workflows are outside this work.

## Checks retained from main

1. `scenarios/contracts-specta.md`, C4; `tools/contracts/test_addition.py`,
   `Addition.test_c4_one_declaration_reaches_every_surface`: addition, removal,
   dispatch, MCP role selection and generated TS callers.
2. `scenarios/mcp.md`, M5; `crates/rup/tests/mcp.rs`,
   `m5_every_app_action_has_a_tool_or_a_reason` and
   `m1_offers_one_tool_per_method_and_no_others`; `crates/rup/src/mcp/c4_policy.rs`,
   `c4_declarations_preserve_mcp_policy`: current coverage and actual MCP policy.
3. `scenarios/perf.md`, R25; `crates/perf/tests/process.rs`,
   `r25_every_method_has_a_perf_disposition` and
   `r25_missing_method_or_reason_fails_coverage`: current perf completeness.
   `crates/perf/tests/support/process.rs`, `coverage`: current registry reader.
4. `scenarios/cli.md`, I10; `crates/rupd/src/describe_tests.rs`,
   `i10_list_names_every_method_the_daemon_serves`,
   `i10_describe_gives_summary_params_result_and_example` and
   `i10_every_listed_method_describes_itself_with_a_valid_example`;
   `crates/contracts/src/describe.rs`, `extra_text`, `list` and `describe`:
   current descriptions and public description behavior.
5. `scenarios/failure-handling.md`, U3791b;
   `apps/desktop/src/app/u3791b_codes.test.ts`, `u3791b_every_rpc_code_has_copy`
   and `u3791b_thrown_outcome_preserves_uncertainty`: independent error-code proof.

Implementation observer: the C5459b negative fixture and repaired case above,
the extended C4 addition observer, the retained focused consumer tests and
`just check origin/main`. A negative fixture is an asserted failure inside a
passing test; do not leave a failing product declaration committed. No native Mac
observation is required. This specification claims none of those implementation
checks has passed.
