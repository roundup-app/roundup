# T4451a / T4451b timing evidence

The inventory is PR #4449's 79 lowered declarations in 49 files, at
`faffea3da74f03389504e95a0fa53599fea15d4e` (merge `dccaff385e4fda91af0ddade7a64fdbaabc9cea1`).
`evidence-4451.jsonl` preserves every original declaration and its previous maximum,
current runtime matches, skips, retries, and file disposition. Parameterized titles
expand to their runtime cases. An empty results array is missing evidence, not a pass.

## Complete seven-shard CI extraction

Run: [40781133074](https://github.com/roundup-app/roundup/actions/runs/40781133074),
at SHA `1d224d7e0e3374e3f6fc1a3325f6cfb27c3f7ab8`, attempt 1, all seven web jobs successful.
This is historical evidence for that SHA, not a measurement of this PR's head.

Use raw job logs: `gh run view --log` omits six oversized JSON report lines in
this run, despite the jobs succeeding. The raw job API retains all seven.

```sh
set -euo pipefail
run=40781133074
for job in $(gh run view "$run" --json jobs --jq '.jobs[] | select(.name | startswith("web ")) | .databaseId'); do
  gh api --allow-escape-sequences "repos/roundup-app/roundup/actions/jobs/$job/logs"
done > /tmp/complete-web.log
python3 loop/web-durations.py < /tmp/complete-web.log > /tmp/durations.json
```

Both download and extractor exited **0**. Extractor SHA-256: `6b7bba52bd6bd87be2448ce9040dc0e5283f4279d296a55f97942cf10fef9ff3`.
Log SHA-256: `756c93a77dd75933b8375cda45153b83e16e0b2d993c57888b39bc1d246a5ca9` (job order web 4, 7, 6, 2, 1, 5, 3).
The exact extractor output is `ci-40781133074.json` (511 entries), also copied to
`apps/desktop/src/testing/shardDurations.json`. Seven JSON reports cover 511 files.
The extractor prefers reporter whole-file seconds, including hooks, to JSON spans.
Its `1` placeholders for entirely skipped modules are **unmeasured**, not a
one-second timing bound. No skipped result is used to justify a timeout.

Retry counts come from the run's `e14-web{1..7}-1` artifacts, `e14/web*/web.json`.
Affected modules have no retries in this run; passing results are first attempts.
JSON per-test duration includes beforeEach/afterEach; it is not isolated callback
time. Installed Vitest 5.0.3 `dist/chunks/run.BTlFXlnv.js`, `runTest`, starts its
duration clock before hooks and stops after hooks and retries. Thus the 63304 ms
reported for `a3564a_attention_opens_the_requesting_terminal`, with retries 0,
does not establish that its callback exceeded its effective 60000 ms timeout:
the real-Daemon setup runs in beforeEach with its own separate hook deadline.
The existing 60000 ms callback cap succeeded; no exception is inferred from this
total. Whole-file totals likewise do not establish a callback timeout requirement.

The three previously slow files remeasure at **27 s** (u2232), **20 s** (u501),
and **57 s** (n5). Their individual tests passed at the declared caps. No exact-test
exception is granted from this historical run. The inherited 15000 ms default,
retry policy and opt-in rollout remain unchanged.

## Coverage and cap decisions

Every row uses the run URL and SHA above, also repeated in each JSONL record.
Seconds describe the executed portion only when skips exist; **—** is unmeasured.
A pending row does not complete T4451a/b. Deleted and replaced observers are
accounted for below rather than silently removed from the inventory.

| Repository-relative file | File seconds | Passed / skipped | Decision |
| --- | ---: | ---: | --- |
| `apps/desktop/src/ask/dv5_real_daemon.test.tsx` | 11 | 8 / 0 | preserve effective caps ≤60000 ms |
| `apps/desktop/src/ask/dv5_rendered.test.ts` | 44 | 2 / 2 | unmeasured affected observers; retain caps pending requested observation |
| `apps/desktop/src/ask/u505_ask_rows.test.tsx` | 28 | 7 / 0 | preserve effective caps ≤60000 ms |
| `apps/desktop/src/bubbles/u2224_rendered.test.ts` | 12 | 1 / 0 | preserve effective caps ≤60000 ms |
| `apps/desktop/src/bubbles/u2236_browser.test.ts` | 10 | 2 / 0 | preserve effective caps ≤60000 ms |
| `apps/desktop/src/bubbles/u2307a_browser.test.ts` | 15 | 3 / 0 | preserve effective caps ≤60000 ms |
| `apps/desktop/src/bubbles/u2307c_browser.test.ts` | 5 | 1 / 0 | preserve effective caps ≤60000 ms |
| `apps/desktop/src/bubbles/u469_bar.test.ts` | 38 | 7 / 0 | preserve effective caps ≤60000 ms |
| `apps/desktop/src/changes/u2540b_notes.test.tsx` | 25 | 28 / 0 | preserve effective caps ≤60000 ms |
| `apps/desktop/src/header/u2232_flat_tabs.test.ts` | 27 | 3 / 0 | preserve effective caps ≤60000 ms |
| `apps/desktop/src/header/u475_browser.test.ts` | 35 | 3 / 1 | unmeasured affected observers; retain caps pending requested observation |
| `apps/desktop/src/importer/u2875d_import_panel.test.tsx` | 8 | 20 / 3 | unmeasured affected observers; retain caps pending requested observation |
| `apps/desktop/src/inbox/u3770_browser.test.ts` | 7 | 1 / 0 | preserve effective caps ≤60000 ms |
| `apps/desktop/src/ink/u501_browser.test.ts` | 20 | 2 / 0 | preserve effective caps ≤60000 ms |
| `apps/desktop/src/keys/u533_browser.test.ts` | 4 | 1 / 0 | preserve effective caps ≤60000 ms |
| `apps/desktop/src/orders/q2_surfaces.test.tsx` | 4 | 2 / 0 | preserve effective caps ≤60000 ms |
| `apps/desktop/src/orders/u3078i_rendered.test.ts` | — | 0 / 1 | unmeasured affected observers; retain caps pending requested observation |
| `apps/desktop/src/pads/u3732_drag_browser.test.ts` | 4 | 1 / 0 | preserve effective caps ≤60000 ms |
| `apps/desktop/src/pads/u3732_real_daemon_agent_owner.test.tsx` | 42 | 2 / 0 | preserve effective caps ≤60000 ms |
| `apps/desktop/src/rail/menu/u2694_menu.test.tsx` | 23 | 31 / 0 | preserve effective caps ≤60000 ms |
| `apps/desktop/src/reactions/nr9_rendered.test.ts` | 184 | 5 / 1 | unmeasured affected observers; retain caps pending requested observation |
| `apps/desktop/src/settings/u3799_app_settings.test.tsx` | 46 | 16 / 1 | unmeasured affected observers; retain caps pending requested observation |
| `apps/desktop/src/settings/u3799_rendered.test.ts` | — | 0 / 13 | unmeasured affected observers; retain caps pending requested observation |
| `apps/desktop/src/shelf/u371_reserved_checks_light.test.ts` | 11 | 1 / 0 | preserve effective caps ≤60000 ms |
| `apps/desktop/src/switcher/u2572_browser.test.ts` | 8 | 1 / 0 | preserve effective caps ≤60000 ms |
| `apps/desktop/src/terminal/u102_emulator.test.ts` | 23 | 13 / 0 | preserve effective caps ≤60000 ms |
| `apps/desktop/src/terminal/u3016_browser.test.ts` | — | 0 / 0 | deleted; see disposition |
| `apps/desktop/src/terminal/u3517_browser.test.ts` | 14 | 3 / 22 | unmeasured affected observers; retain caps pending requested observation |
| `apps/desktop/src/terminal/u3780_browser.test.ts` | — | 0 / 0 | deleted; see disposition |
| `apps/desktop/src/terminal/u467_browser.test.ts` | 26 | 2 / 0 | preserve effective caps ≤60000 ms |
| `apps/desktop/src/testing/a33_blocked_real_daemon.test.tsx` | 4 | 1 / 0 | preserve effective caps ≤60000 ms |
| `apps/desktop/src/testing/n5_real_daemon.test.ts` | 57 | 3 / 0 | preserve effective caps ≤60000 ms |
| `apps/desktop/src/testing/u177_restarted_door.test.tsx` | 12 | 1 / 0 | preserve effective caps ≤60000 ms |
| `apps/desktop/src/testing/u194_real_daemon.test.tsx` | 63 | 1 / 0 | preserve effective caps ≤60000 ms |
| `apps/desktop/src/testing/u198_real_daemon.test.ts` | 39 | 1 / 0 | preserve effective caps ≤60000 ms |
| `apps/desktop/src/testing/u2875d_real_import.test.tsx` | 9 | 1 / 0 | preserve effective caps ≤60000 ms |
| `apps/desktop/src/testing/u3078i_real_daemon.test.tsx` | 18 | 3 / 0 | preserve effective caps ≤60000 ms |
| `apps/desktop/src/testing/u375_real_daemon.test.tsx` | 32 | 2 / 0 | preserve effective caps ≤60000 ms |
| `apps/desktop/src/testing/x14_output_relay.test.ts` | 4 | 6 / 0 | preserve effective caps ≤60000 ms |
| `apps/desktop/src/timeline/u3768_rendered.test.ts` | — | 0 / 0 | deleted; see disposition |
| `apps/desktop/src/toasts/p3557c_capture.test.ts` | 6 | 1 / 0 | preserve effective caps ≤60000 ms |
| `apps/desktop/src/todos/u3741_rendered.test.ts` | — | 0 / 1 | unmeasured affected observers; retain caps pending requested observation |
| `apps/desktop/src/todos/u3760_rendered.test.ts` | — | 0 / 2 | unmeasured affected observers; retain caps pending requested observation |
| `apps/desktop/src/todos/u3774_rendered.test.ts` | — | 0 / 1 | unmeasured affected observers; retain caps pending requested observation |
| `apps/desktop/src/todos/u3776_rendered.test.ts` | — | 0 / 1 | unmeasured affected observers; retain caps pending requested observation |
| `apps/desktop/src/todos/u461_rendered.test.ts` | 30 | 1 / 9 | unmeasured affected observers; retain caps pending requested observation |
| `apps/desktop/src/ui/u3295_capture.test.ts` | — | 0 / 1 | unmeasured affected observers; retain caps pending requested observation |
| `apps/desktop/src/ui/u483_browser.test.ts` | 32 | 3 / 0 | preserve effective caps ≤60000 ms |
| `apps/desktop/src/ui/u499_browser.test.ts` | 14 | 2 / 0 | preserve effective caps ≤60000 ms |

## Observer replacements and retirements

- `src/terminal/u3517_browser.test.ts`: 6cb0c1977 split u3517f_rendered_terminal_reference into u3517f_rendered_terminal_reference_agent, _door and _shell in this file; all three runtime cases are accounted for.
- `src/terminal/u3016_browser.test.ts`: Deleted in 49d7d940c; U3016f retirement is reserved in scenarios/native-questions.md; U4454a/b (scenarios/remove-time-timeline.md) remove the view.
- `src/timeline/u3768_rendered.test.ts`: Deleted in 49d7d940c; U3768a–h explicitly retired by scenarios/remove-time-timeline.md U4454b (the old scenario file is deleted).
- `src/terminal/u3780_browser.test.ts`: Deleted in a6b3f83de; U4453a/b removes NoteQueue (scenarios/ui-navigation-always.md); surviving absence observer src/terminal/u4453a_terminal_only.test.tsx.
- `src/orders/q2_surfaces.test.tsx`: Order editor observers replaced in fa1dc1582 and 1e71ebcb4 by u4453b_retired_order_drafts_keep_exact_copy_and_identity and u4453b_retired_order_draft_copy_failure_and_selected_discard in this file (scenarios/ui-navigation-always.md, U4453b).
- `src/orders/u3078i_rendered.test.ts`: p3557c_rendered_order_and_progress_failure_lifetime replaced in fa1dc1582 and 2e87e4dd1 by u3078i_rendered_open_inspect_resume in this file; skipped here, unmeasured. Current declaration 240000 ms is not justified by this run.

## Remaining evidence

The historical run does not measure opt-in capture observers. Those must execute
with their capture flags at their effective caps before #4451 closes, including
expanded parameterized cases and replacement observers. Successful ordinary
web checks alone do not satisfy that requirement. Tests whose current declarations
exceed 60000 ms still require T4451b's exact-title measurement and justification,
or a measured correction back to 60000 ms. No file-wide exception is authorized.

Validation: reuse `node --test tools/oxlint/anti-slop/web-timeout/timeout.test.mjs`
(`t3779a_timeout_boundary`); no documentation-mirroring test is added.

## Requested observation attempt and repair prerequisite

[Build run 40783012875](https://github.com/roundup-app/roundup/actions/runs/40783012875)
started the 46 retained files with the existing capture flags, App/test source
`e9c92247cebb9b6a42dc2e830592556e6aa4fec0`, and unchanged caps/retries.
`capture-40783012875.json` records the exact command, environment flags,
reporter-only config, source SHA, emitted failures and log identity.
`capture-40783012875.log.gz` preserves the diagnostic output; read it with
`gzip -dc tools/oxlint/anti-slop/web-timeout/capture-40783012875.log.gz`.

Nine tests failed across Header, Inbox, Progress, Ask, Import and Settings. The
invocation was interrupted to stay within the Builder budget: Vitest exit **130**,
app-data wrapper exit **1**, no final JSON or lifecycle report. It ran alongside
lint work, so resource contention must be separated from incorrect observer
targets in a focused reproduction. Printed durations include retries where
marked; they are not first-attempt callback measurements. This incomplete log
is **not** timing-bound evidence and is not fed into the committed shard map.
It changes no cap decision and grants no exception.

[Repair prerequisite #4712](https://github.com/roundup-app/roundup/issues/4712)
blocks #4451. It preserves the existing scenario clauses/assertions and repairs
the requested paths before collecting successful complete timing evidence.
The files and observers not completed here remain unmeasured.

Local verification: `pnpm install --frozen-lockfile`, `just ready` (exit 0), all
81 existing `t3779a_timeout_boundary` fixtures (exit 0), and
`python3 loop/app-data.py pnpm --filter desktop exec vitest related --run src/testing/shardDurations.json`
(three shard-sequencer tests, exit 0). The 49-file / 79-declaration ledger and exact
extractor-output/shard-map equality were checked without adding a duplicate test.
