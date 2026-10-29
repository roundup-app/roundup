`legacy.db` was written by the real `Checkpoints::save_marks` and `invalidate_after` at baseline `ae11e413f61fb23a68564ac3d68227b0da65f38e`, not assembled with SQL payloads. Migration 1's database holds two non-empty Marks, one invalidated, and their cards.

Reproduce in a clean detached baseline worktree, using this implementation's observer copied unchanged into `crates/checkpoints/src/observer.rs` and adding its test-only module declaration to the baseline's `marks.rs`:

```sh
CHECKPOINT_OBSERVER_INPUT=/absolute/implementation/crates/checkpoints/tests/fixtures/marks.json \
CHECKPOINT_LEGACY_OUTPUT=/tmp/checkpoint-legacy-fixture \
cargo test -p checkpoints n14_generate_legacy_fixture -- --ignored --nocapture
```

The checked-in `marks.json` is the input, matching the surviving fields of `marks()` in `src/marks_tests.rs`: Agent `door`, cwd/worktree `/project`, conversation `[0,255,10]`, two equal binary regular files with different executable state (including a newline/non-UTF8 path), an equal symlink target and an empty file. Cards have ids 1 and 2, times 123 and 456, titles `legacy title` and `invalidated title`, blocks `[{"kind":"text","text":"legacy block"}]` and `[]`. The legacy JSON retains the retired `iteration` field to prove old-Mark readability without conversion. The generator checkpoints WAL before closing. The compatibility test compares the original SQLite values and full readable Marks across save and reopen; it never converts legacy payloads.
