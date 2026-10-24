# Split b6_prompt_identity by concept

Module: `crates/rupd`. Source: #3209. Ids: T3209. Rule: `.claude/sound/placement/file-stays-under-a-size-cap.md`.

**T3209 no test file of the rupd prompt-identity tests exceeds 1000 lines.** Given `crates/rupd/tests/b6_prompt_identity.rs` holds 7362 lines, when its tests move into files under `crates/rupd/tests/`, one per concept (the behaviour a group of tests proves), then:

- Every resulting file, and every setup module they share, is under 1000 lines, shown by `wc -l` on the files in the PR (policy).
- Each test file is named for what it holds, for example prompt identity and effects, Order steering, Door writes and interrupts, `cleanup_completion`, lean specialists. (#3563 retired the Takeover races, held resizes, held renames, held stops and held Door calls.) No `part1`/`part2` name, no `utils`/`helpers` file for overflow, no re-export stub at the old path, no raised cap and no skipped hook (policy).
- Setup (fixtures, launchers, fake-Claude scripts) used by one concept lives in that concept's file; setup used by several lives in a module named for what it sets up, beside `rupd_harness` (policy).
- Moves only: no test body, helper body or public item changes except the path of a `mod` declaration or an `use`. Each commit is one move a reviewer can follow with `git diff --color-moved` (policy).
- Every test that passed before passes after with the same name, including the `b6_`, `b37_`, `b38_`, `u467_`, `u468_`, `a2693a_`, `dv1_`, `dv4_` and `u2773c_` names and the `cleanup_completion::` module prefix. The set of test names before and after, from `cargo nextest list -p rupd`, is equal apart from the binary id (test: the existing tests themselves; observer: that list diff).
- Every caller of the old test target is updated in the same PR as the move that invalidates it: `.config/nextest.toml` (its `binary(b6_prompt_identity)` and `binary_id(=rupd::b6_prompt_identity)` filters and lanes, so each moved test runs in the lane its seconds justify), `loop/launch-sites.json`, and the file and test paths cited in `scenarios/messages.md` (B6 test-cost observer, B37, B38 checks), `scenarios/test-cost.md`, `docs/evidence.md` and `docs/evidence-relocation.md` (policy).
- A file that no longer fits in a single PR lands over several PRs, each leaving the tree green and naming `Refs #3209`; only the last carries `Closes #3209`, once `wc -l` shows every resulting file under 1000 (policy).

Observer: `wc -l` on the resulting files and `cargo nextest run -p rupd` passing; this specification adds no test that rereads the file sizes (policy).
