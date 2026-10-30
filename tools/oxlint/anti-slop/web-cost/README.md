# Web test cost inventory

T3779c preparation for [#3828](https://github.com/roundup-app/roundup/issues/3828).
This inventories static runtime consumers of the two existing real-Daemon fixture
roots. It does not enforce T3779a/b, create assertion/timeout exceptions, select a
smoke, or cut tests. Those parts of the Issue remain open.

```text
Vitest related selection → Vite import paths → Vitest static test names
```

Run from a checkout with `pnpm install`:

```sh
node tools/oxlint/anti-slop/web-cost/inventory.mjs > /tmp/current-consumers.json
node --test tools/oxlint/anti-slop/web-cost/inventory.test.mjs
```

`--source <directory>` inventories an exported `apps/desktop/src` tree. The output
records the tool revision, source revision for the default checkout, dirty flags
and a hash of every inspected source module. An external tree's source revision
is null; record its export commit separately, as `base-consumers.json` does.

The tool loads no App config, executes no test modules or hooks, and starts no
Chromium or Daemon. It closes its own Vite instance. Vitest owns dependency
resolution, TS/TSX transforms, type-only erasure, aliases and static discovery;
`vite-plugin-solid` supplies the installed Solid transform. A missing local runtime
dependency fails the inventory rather than silently removing a consumer.

Each consumer has one example path to a fixture root. The set includes literal
dynamic imports and transitive fixture imports, and excludes helpers, metadata
and comment-only matches. Static test names are source registrations, including
skipped/conditional cases and parameterized templates; they are not executed test
counts. Computed runtime imports and registrations created by imported functions
need source inspection. An import path alone does not prove a Daemon launches in
every test in the file. Inspect each body and hook before choosing its disposition.

To reproduce the measured source inventory without changing a checkout:

```sh
audit_base=$(mktemp -d)
git archive 472370359f5b6b06fa69bbec14ebfc95a792c4ea | tar -x -C "$audit_base"
ln -s "$PWD/node_modules" "$audit_base/node_modules"
ln -s "$PWD/apps/desktop/node_modules" "$audit_base/apps/desktop/node_modules"
node tools/oxlint/anti-slop/web-cost/inventory.mjs --source "$audit_base/apps/desktop/src" > /tmp/base-consumers.json
```

The source archive contains its package/TypeScript configuration too; dependencies
are the installed ones, whose manifests and lockfile match this CI commit.

## Source reconciliation

`base-consumers.json` inventories the exact archive of CI commit
`472370359f5b6b06fa69bbec14ebfc95a792c4ea`: 34 consumer files, with 158 static
registrations. This archived inventory deliberately retains tests later cut by T3779c; no lint reads it as a current-test allowlist. Run the inventory command above for the current checkout. `current-consumers.json` inventories the implementation's unchanged
App source: 30 consumer files, with 151 static registrations.

On current source, `rg -l 'real_daemon|realDaemon|startDaemon' apps/desktop/src`
returns 34 files. Its four non-consumers are the two fixture modules,
`testing/shardDurations.json` and a comment in `switcher/u529_switcher.test.tsx`.
The specification's 39 matches refer to its older source revision. The four
consumer files present in the measured archive but absent on current main were
removed by other merged work; this PR claims no reduction for them.

## CI observations

Source: successful [check run 40151611415](https://github.com/roundup-app/roundup/actions/runs/40151611415),
SHA `472370359f5b6b06fa69bbec14ebfc95a792c4ea`. Fetch each raw web job log with
`--allow-escape-sequences`; `gh run view --log` did not preserve the complete
machine reports in this observation.

```sh
for job in 121044197456 121044197464 121044197487 121044197501 121044197509 121044197512 121044197524; do
  gh api --allow-escape-sequences "repos/roundup-app/roundup/actions/jobs/$job/logs"
done > /tmp/base-web.log
python3 loop/web-durations.py < /tmp/base-web.log > /tmp/base-durations.json
```

`base-durations.json` is that command's unedited output. All 473 `.test.ts`/`.test.tsx`
paths in `git ls-tree -r --name-only <SHA> apps/desktop/src` appear in the seven JSON
reports. However, 13 files have only `skipped` assertion results and equal start/end
timestamps. The existing duration script assigns each a 1-second fallback: those
values are **missing execution evidence**, not measured time.

The raw sum is 6,597 s; excluding those 13 placeholders leaves 6,584 rounded file
seconds for 460 files with executed assertions. The 34 Daemon consumer paths have
33 executed files totaling 1,738 rounded file seconds and one missing observation
(`todos/u461_rendered.test.ts`). A complete measured group total is therefore
unavailable. These are elapsed file times, including file hooks, not shard wall
time, individual test-body time, or claimed savings. The gutter file reports 548 s
here; 456 s and the 4,424 s suite figure are older shard-planning values.

Vitest printed the following shard summaries separately. They do not isolate hook
setup or first-attempt/retry cost. The JSON assertion results also lack retry
counts. No attempt split is inferred and no retry is added. A cut still needs
measurements on its actual base/head, coverage of skipped originals where needed,
and the required setup/retry accounting. This older run alone cannot justify a
cut of a file subsequently changed on main.

| Job | Vitest wall seconds | Reported phases |
| --- | ---: | --- |
| web 1 / 121044197464 | 560.48 | tests 100% |
| web 2 / 121044197524 | 339.91 | tests 87%, environment 6%, import 5%, transform 1% |
| web 3 / 121044197509 | 378.85 | tests 84%, environment 8%, import 6%, transform 2% |
| web 4 / 121044197456 | 428.75 | tests 91%, environment 5%, import 4%, transform 1% |
| web 5 / 121044197512 | 482.05 | tests 87%, import 6%, environment 6%, transform 1% |
| web 6 / 121044197487 | 432.71 | tests 87%, environment 7%, import 5%, transform 1% |
| web 7 / 121044197501 | 303.38 | tests 88%, environment 6%, import 5%, transform 1% |

### Original Daemon consumer observations

Paths are relative to `apps/desktop/src`. "Same source" compares the entire file
against the implementation's source snapshot, not its helper dependencies. Timing
still belongs exclusively to the older CI SHA. No row is a cut disposition.

| Original consumer | CI file seconds | Current source |
| --- | ---: | --- |
| `ask/dv5_real_daemon.test.tsx` | 16 | same source |
| `ask/dv5_rendered.test.ts` | 44 | same source |
| `bubbles/u511a_browser.test.ts` | 53 | same source |
| `changes/u2540_rendered.test.ts` | 151 | same source |
| `changes/u2540b_notes.test.tsx` | 15 | same source |
| `header/u184_close.test.tsx` | 11 | same source |
| `orders/q2_surfaces.test.tsx` | 10 | same source |
| `pads/u3732_real_daemon_agent_owner.test.tsx` | 27 | same source |
| `reactions/nr9_rendered.test.ts` | 37 | same source |
| `shelf/u460_real_daemon.test.tsx` | 15 | same source |
| `terminal/u3016_browser.test.ts` | 27 | same source |
| `terminal/u59_real_daemon.test.ts` | 61 | same source |
| `testing/a33_blocked_real_daemon.test.tsx` | 9 | same source |
| `testing/n5_real_daemon.test.ts` | 36 | same source |
| `testing/u144_real_daemon.test.tsx` | 150 | same source |
| `testing/u149_real_daemon.test.tsx` | 6 | same source |
| `testing/u166_door_permission.test.tsx` | 49 | same source |
| `testing/u176_agent_names.test.tsx` | 149 | changed on main |
| `testing/u177_restarted_door.test.tsx` | 10 | same source |
| `testing/u178_workstream_todos.test.tsx` | 177 | changed on main |
| `testing/u194_real_daemon.test.tsx` | 38 | same source |
| `testing/u198_real_daemon.test.ts` | 1 | same source |
| `testing/u2875d_real_import.test.tsx` | 22 | same source |
| `testing/u3078i_real_daemon.test.tsx` | 16 | same source |
| `testing/u346_pad_confirm.test.tsx` | 80 | changed on main |
| `testing/u351_kinds_real_daemon.test.tsx` | 77 | removed on main |
| `testing/u356_blocked_real_daemon.test.tsx` | 100 | removed on main |
| `testing/u364_real_daemon.test.ts` | 52 | removed on main |
| `testing/u375_captures.test.ts` | 13 | removed on main |
| `testing/u375_real_daemon.test.tsx` | 33 | same source |
| `testing/u463_real_daemon.test.ts` | 183 | changed on main |
| `testing/x14_output_relay.test.ts` | 4 | same source |
| `todos/u3720_real_daemon_owner.test.tsx` | 66 | same source |
| `todos/u461_rendered.test.ts` | missing (all skipped) | same source |

### Files with no executed assertions

These 13 entries in `base-durations.json` must not be used as observed 1-second
costs. The Python launchers' skipped tests provide no Python execution evidence.

- `src/drawer/u3010b_rendered.test.ts`
- `src/header/u449_rendered.test.ts`
- `src/header/u497_rendered.test.ts`
- `src/orders/u3078i_rendered.test.ts`
- `src/settings/u3799_rendered.test.ts`
- `src/testing/u2875d_rendered.test.ts`
- `src/todos/u3010c_rendered.test.ts`
- `src/todos/u3741_rendered.test.ts`
- `src/todos/u3760_rendered.test.ts`
- `src/todos/u3774_rendered.test.ts`
- `src/todos/u3776_rendered.test.ts`
- `src/todos/u461_rendered.test.ts`
- `src/ui/u3295_capture.test.ts`
