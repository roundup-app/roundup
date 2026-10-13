# L105 capture observers

#1228 delivered the shared TypeScript capture helper. #1261 owns the new Python U430 observer from #1225, which does not yet use it; #1205 is blocked on that desktop prerequisite. #1250 deletes the abandoned `issue-653/` and `u148-149/` folders; edits and additions there remain forbidden. Narrow-window captures stay with #1236 while tests on main still write them. `critic/` and `journey/README.md` are unchanged.

| Observer | Result |
| --- | --- |
| `captures.test.ts` | Three tests pass: exact id selection, no filesystem writes, no test-owned artifact path. |
| `loop/rules.test.sh` | Cleanup deletion passes; an edit or new legacy capture fails. |
| `loop/workflows.test.py` | 27 tests pass. |
| `git merge-tree --write-tree --name-only --no-messages f2aa32e8 bbdde88c` | Exit 0; no conflicts. Merge tree `68e05db6ef0cf927be4d86f3fc9f6776392eae25`. |
| `just check` after integrating main `f2aa32e8` | Exit 0: 1,451 Rust tests, 2,216 desktop tests, lint, type checks, contracts and message proofs pass. |
| `just check` after integrating main `92232cc9` | Exit 0: 1,451 Rust tests and 2,222 desktop tests; all remaining checks pass. |
| `loop/captures.test.sh` on clean main `f2aa32e8` | Both L105 assertions pass: status stays empty and #1194 has no uncited artifact conflict. Exit 100 is preserved from the unrelated M12 model-launch assertion. |
| Observer script in isolated Git fixtures | Clean check exits 0; failed check preserves exit 7; a dirty checkout exits 1. ShellCheck passes. |

Run the complete observers with `loop/captures.test.sh <clean-main-checkout> 1194`. It asserts cleanliness before and after `just check`, then rejects any merge conflict under `artifacts/` outside the replayed PR's cited ids. It preserves a failing check's exit code.

## Repeated capture

Two `just capture U401` runs exited 1 on desktop timeouts. Their six-file PNG manifests match and neither run changed tracked files. The second run timed out before regenerating `kinds-163px-light-4x.png`; the matching manifest therefore does not prove that all six PNGs were regenerated identically. PNG determinism is not an L105 acceptance condition.

## Check failures

| Command | Exit | Result |
| --- | --- | --- |
| `just check` on clean main `f46726bc` | 100 | U104 snapshot exceeded its 10-second exit bound; status remained empty. |
| First `just check` on the capture branch | 100 | Same U104 timeout; status remained empty. |
| First `just capture U401` | 1 | U20, U196 and U379 timeouts. |
| Second `just capture U401` | 1 | U134, U20, U196, U379 and U401 timeouts. |
| `just check-web` on clean main `f46726bc` | 1 | U142 startup, U359 startup and U36 editor failure; status remained empty. |
| Clean-main observer on `f2aa32e8` | 100 | M12 `m12_a_listed_model_starts_the_child_on_it` failed; both L105 assertions passed. |
| Five desktop retry files with one worker | 1 | U134's border observer timed out; the other 92 tests passed. |

These runs overlapped. U104 subsequently passed in 4.1 seconds after the full browser runs finished; U20, U196 and U379 then passed all 35 tests with one worker. No assertion or timeout was changed.

The final post-merge `just check` passed without changing tests, assertions or timeouts.

The final integration includes main `92232cc9`. Its new U430 Python observer bypasses the capture helper and is covered by prerequisite #1261. This loop PR does not close #1205.
