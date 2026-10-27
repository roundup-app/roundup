# S3806 cheap guards

The runner owns selection. Run every available prescribed class guard with:

```sh
pnpm --filter desktop exec vitest run --project webkit-guards --retry=0
```

S3806b remains incomplete until `src/ui/s3806b_actions.test.tsx` merges. Parent
#3850 must verify all three guards before completion. The Switcher U2572 suite
is an existing regression observer, not the S3806b guard.

## Baseline observation

At main `c9c69c69f6ff685dc81cd579b806abb45306a64e`, the three-file invocation in
#4440 unconditionally enters `warmChrome` and `globalAppServer`. A Linux
`strace -f -e trace=execve,bind,listen` observation recorded a real headless
Chrome launch with a fresh `chrome-page-*` profile and App-server listening.
It logged `Chrome first start: 11984 ms`. Passing jsdom assertions do not prove
a browser-free invocation.

Keep #3828's timing and proof requirements: report setup separately from file
times, retain original failures, and make no aggregate CI saving claim from a
local measurement. Do not change real-Claude, Rust or U26 failure observers.

## Configuration ownership

`vite.config.ts` uses Vitest 5 inline projects. `webkit-guards` includes exactly
the three prescribed paths; `app` includes the existing test glob, excludes
those paths plus Vitest's default exclusions, and owns the unchanged
`warmChrome.ts` / `globalAppServer.ts` hooks. Both inherit jsdom, domStubs,
Solid transforms, CSS and module resolution. Keep includes on the projects:
Vitest concatenates inherited include arrays, which would broaden the cheap
selection. Root global setup would run even for the cheap project.

## Implementation observation

Tested configuration: `edebf5ba6815b94caffcc6c8e23192e9f42f3d26`.

```sh
strace -f -e trace=execve,bind,listen -o /tmp/guards.trace \
  pnpm --filter desktop exec vitest run --project webkit-guards --retry=0
pnpm --filter desktop exec vitest list --filesOnly --project webkit-guards
```

Exit 0: 143 tests (137 S3806a-file tests, six S3806c rows), two files. Trace:
zero browser/Daemon executables, zero `bind` and zero `listen` calls, including
workers. Thus no App server started in-process either. The only successful
executables were pnpm/shell utilities and Node (runner and two test workers).
Selection listed exactly the two available prescribed files. A full
`vitest list --filesOnly` matched all 502 source test files exactly once.

The diagnostic run used a temporary Vitest reporter calling
`TestModule.diagnostic()` in `onTestModuleEnd`; no instrumentation or test was
added to production. All values below are milliseconds, rounded; setup and
imports are separate from file test execution. Total wall time was 23.91 s.
There were no retries (`--retry=0`) or changed timeouts.

| File | Environment setup | Worker prepare | setupFiles | Import/collection | Test execution |
| --- | ---: | ---: | ---: | ---: | ---: |
| S3806a interruption | 2964 | 16 | 760 | 12102 | 7700 |
| S3806c scale | 2836 | 9 | 854 | 11095 | 1958 |

An earlier corrected-selection trace also passed 143 tests with zero browser,
Daemon or listener starts (50.48 s under concurrent lint/browser load). The
first development configuration inherited the broad root include; its trace
caught unintended browser-test execution and it was interrupted and corrected.
These local wall times are not equivalent complete base/head CI measurements
or a claim of aggregate savings for #3828.

Regression commands (all `--retry=0`, exit 0):

```sh
pnpm --filter desktop exec vitest run src/testing/u26_chromePage.test.ts \
  src/testing/u26_chromePage_pipe.test.ts src/testing/u26_harness.test.tsx \
  src/switcher/u2572_actions.test.tsx src/testing/shardSequencer.test.ts --retry=0
pnpm --filter desktop exec vitest run src/header/u2232_flat_tabs.test.ts --retry=0
```

The first passed 78 tests / five files, including all six U26 Chrome-page
startup/pipe failure observers, and logged real Chrome warmup (14130 ms).
The second passed three browser tests loading the existing App harness with
isolated headless Chrome/fresh profiles and shared App-server setup (warmup
7340 ms). No browser helper, real-Claude scheme, Rust test, smoke, timeout,
retry, production seam or class guard was changed or removed. S3806b, full
caller/rendered/native acceptance and the parent's final three-guard run
remain on #3850; this prerequisite requires no capture or Mac request.
