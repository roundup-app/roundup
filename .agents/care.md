# Daily Care

Read L107 in `scenarios/loop-rules.md` and `.agents/data/work.md`. Use the fixed ranking input supplied by the workflow. Its `complete_input` file holds every full observation, location, source link and assertion body; read the evidence id there before proposing a repair. Rank every `findings` id exactly once, highest observed cost first. Include deferred and open-PR exclusions; keep observed counts, elapsed durations, duplicated lines and fix frequency separate from estimated repair cost. Empty categories are valid. Inspect the raw observations and assertion bodies before proposing repairs.

Compare affected files and repair outcome with every open and seven-day closed `repair_candidates` body and its owner comments. A later owner comment overrides the body. An existing owner gets `disposition: match` and a proposal holding its integer `match` and an `evidence` comment with the new evidence links. Leave user-closed Issues closed. The publisher refreshes the complete candidate search and open PR file lists before any write.

Return `entries` in rank order. Each entry has `id`, `cost`, `explanation`, `module` and `disposition` (`new`, `match`, `excluded`, `deferred`). For `new`, `proposal` holds `title`, `body`, `files`, and `removes_tests` (empty unless cutting tests). Propose at most three new Issues and only the remaining UTC date allowance. Use a module directory, such as `loop` or `crates/agents`; never the whole repository. Exclude files changed by open PRs. Defer a finding when it lacks a reproducible single-module repair.

Each new body has Found, Expected, Observer, exact `Scope: <module>/`, `Preserve: <invariant behaviour>`, and the canonical Work fields. Include its evidence id, every source link, affected `path:line`, and the exact reproduction command from input. Priority is 60, or 2 for an evidenced test failure on main in the window. Use Mode: specify if the requested acceptance is not yet on main. Never propose relaxing an enforced gate or changing product behaviour as code care.

For each test cut, `removes_tests` names `file`, `name` and either the input's explicit retirement evidence in the body, or `replacement_file`, `replacement_name`, `clauses` and `proof`. Inspect the replacement assertion body and explain how it still proves every same then-clause. A matching prefix, unknown helper, unresolved scenario or passing total proves nothing. Keep the only proof of an active clause.

Return `ask` empty except for a choice spending money or setting product direction. Such a choice names its user-visible consequence and recommended choice and has a matched/new Work Issue owner for L79. Engineering decisions stay in the loop.

You propose a structured plan; only the script publishes validated Issues/comments. Read, Glob and Grep are your only tools. Never edit code, push, invoke Builders, merge, publish directly, or call another model.
