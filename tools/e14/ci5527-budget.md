# CI5527 web budget observation

Work order: [#5666](https://github.com/roundup-app/roundup/issues/5666).
Scenarios: CI5527b, CI5527c (`scenarios/ci-web-budget.md`).

Implementation [#5904](https://github.com/roundup-app/roundup/pull/5904), continuing
[#5871](https://github.com/roundup-app/roundup/pull/5871), merged at
2026-11-03T15:44:14Z as `5e17263fe6109206a6545740e2e03f48c70b20e2`.
This report observes that implementation; it changes no test selection, runner,
shard count, concurrency, retry, timeout or budget.

## Guard observation (CI5527c)

On checkout `ada406b500d9fa415e7777d201ad6f6130f9f946`, run:

```sh
python3 tools/e14/observe.test.py CI5527 -v
```

All five fixture tests pass. They cover both full and affected selections,
below/at/above 720 seconds, already-failed commands, setup/report work crossing
the boundary, six unordered file durations, ties, fewer than five files, and
missing/malformed evidence. The production command and monotonic clock seams
are exercised without sleeping or rerunning tests.

Controlled failing invocation:

```sh
python3 - <<'PY'
import importlib.util
from pathlib import Path
import sys
spec = importlib.util.spec_from_file_location('fixtures', Path('tools/e14/observe.test.py'))
fixtures = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixtures)
files = [('z', 12), ('e', 50), ('a', 80), ('c', 50), ('b', 70), ('d', 30)]
modules = [dict(id=name, state='passed', duration_ms=duration,
                tests=[dict(id=name, status='passed', retries=0, repeats=0,
                            start=1500, end=1500, real=False)]) for name, duration in files]
code, diagnostic = fixtures.CI5527().invoke(720.001, modules=modules, base='')
print(diagnostic, end='')
print(f'Controlled production guard exit: {code}')
sys.exit(code)
PY
```

After the full-selection fixture metadata, the final diagnostic is:

```text
web2: 720.001 seconds exceeds 720-second budget; slowest files:
  a: 80 ms
  b: 70 ms
  c: 50 ms
  e: 50 ms
  d: 30 ms
Controlled production guard exit: 1
```

Shell exit: **1**. Supplied fixture times are guard evidence only, never a
CI5527b performance observation.
