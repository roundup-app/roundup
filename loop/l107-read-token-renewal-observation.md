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

## Pending live observer

[Care run 38484263076](https://github.com/saadshahd/roundup/actions/runs/38484263076)
started on the merged repair's main commit at 23:26:34 UTC.
Its read-token step succeeded at 23:28:13 UTC and collection began then.
At 2026-10-14 01:47:25 UTC, the Actions jobs API still reported `collect`
in progress; `care` had not started. Running beyond the initial token's lifetime
alone does not prove a successful renewal or completed collection.

Keep #1566 open. Completion requires the jobs API to show `collect` succeeded
and `care` started. Record that result here; if collection fails, inspect its
logs and repair the demonstrated failure before claiming acceptance.
