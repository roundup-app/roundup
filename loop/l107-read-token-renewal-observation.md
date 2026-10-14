# L107 read-token renewal observation

Refs #1566.

[PR #1568](https://github.com/saadshahd/roundup/pull/1568) merged as
`9a51d2b671f79c6daa4a0e97b8eed08e46ae0473` on 2026-10-13 at 23:26:02 UTC.

Expired App read token → one renewal → repeat the read; a second 401 fails.

On main `d5ada596`, these tests passed on 2026-10-14:

| Test | Assertion |
|---|---|
| `test_l107_expired_read_token_renews_and_returns_data` | An expired token returns 401; a fresh read-only App token returns the requested data. |
| `test_l107_second_401_fails_without_workflow_token_fallback` | Two 401 responses raise; the reads use only the expired and fresh App tokens. |
| `test_l107_later_read_uses_shared_renewed_token` | A later read uses the shared renewed token without another exchange. |
| `test_l107_explicit_get_uses_the_read_token` | Explicit API GET requests use the read-token path. |

Commands: `python3 loop/builder.test.py -k l107` and
`python3 loop/orders.test.py -k l107`. The complete Builder, Orders, Retro,
Care and workflow test files also passed, with Care's pinned parser dependencies
installed from `loop/care-requirements.txt`.
`pnpm install` and `just check` exited 0: 1,647 Rust tests passed;
2,863 desktop tests passed and 11 were skipped. After merging main
`636b7059`, `just check` again exited 0 with the same counts.

After merging main `cbe0d777`, `pnpm install`, both targeted L107 commands,
and `just check` exited 0 on 2026-10-14. All four targeted tests passed;
the full check passed 1,647 Rust tests and 2,871 desktop tests (11 skipped).

## Pending live observer

[Care run 38484263076](https://github.com/saadshahd/roundup/actions/runs/38484263076)
failed collection at 2026-10-14 03:28:05 UTC with `unknown fix change evidence`
for run 38355118668 / PR #1408. Care was skipped. This did not demonstrate
full acceptance. Prerequisite #1692 is closed; PR #1694 merged its repair
on main `29f31e2b`.

On that main commit, both targeted commands above again passed all four tests.
[Care run 38567881720](https://github.com/saadshahd/roundup/actions/runs/38567881720)
was dispatched on main on 2026-10-14 and initially queued.

The new run failed `collect` at 2026-10-14 13:00:14 UTC with
`library parser cannot inventory artifacts/ux/U346/observe.sh`; `care` was
skipped. `bash -n artifacts/ux/U346/observe.sh` exits 0 on this checkout.
Scoped prerequisite [#1732](https://github.com/saadshahd/roundup/issues/1732)
owns retaining complete shell evidence when the library parser rejects valid
Bash. #1566 is blocked on it.

Keep #1566 open until a main run shows `collect` succeeded and `care`
started. This record uses `Refs #1566`; it does not complete live acceptance.

On this observation branch, `pnpm install` and `just check` exited 0 on
2026-10-14. Rust: 1,704 passed, two skipped; proofs printed
`ALL PROOFS CHECK`; web checks passed. The diff contains only this record.

After merging main `f8886e87`, `just check` again exited 0 on
2026-10-14. The diff against that main contains only this observation record.

## Main observation after the prerequisites

Both prerequisites, #1692 and #1732, are closed as completed. Their repairs
merged in #1694 and #1733. On main
`6252dc745a833d5994fb57de8edfa43ef9e8a3ae`, the two targeted commands above
pass all four renewal and routing tests.

The last earlier Care run, [38581560612](https://github.com/saadshahd/roundup/actions/runs/38581560612),
failed its initial `read-token` exchange with HTTP 401 at
2026-10-14 14:35:30 UTC; collection and Care did not run.

A fresh read-only App token exchange succeeds in this Builder run.
The default credential cannot dispatch workflows (HTTP 403). A separately
minted App token with `contents: read` and `actions: write` successfully
dispatched [Care run 38651294780](https://github.com/saadshahd/roundup/actions/runs/38651294780)
on main `6252dc745a833d5994fb57de8edfa43ef9e8a3ae`. This dispatch credential
does not change the collector's read-only token or its renewal path.

The run passed its initial App read-token exchange and reached
`Collect complete main evidence`. Full acceptance remains pending until
it completes `collect` and starts `care`. Inspect this run before dispatching another; record its
terminal failure or successful observer here and on #1566. No user decision
or native Mac observation is needed.

On this observation branch, `pnpm install` and `just check` exited 0:
1,807 Rust tests passed (five skipped), message proofs printed
`ALL PROOFS CHECK`, and 2,785 web tests passed (19 skipped). The diff
contains only this existing observation record. The live run still reports
`Collect complete main evidence` in progress; this is an unfinished draft
for continuation, with no `Stopped:` question.

Main advanced to `8b1c0602` during validation. The completed checks above
apply to the branch based on `6252dc74`. Continuation must merge current
main and rerun `just check` before making the draft ready.
