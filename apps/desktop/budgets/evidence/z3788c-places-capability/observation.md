# Z3788c Bubble places capability decision

Retain `apps/desktop/src/bubbles/places.ts`'s `placesStorage` under Z3788c's conditional storage alternative. Direct `makePersisted` 4.4.0 adoption cannot preserve the acknowledged Bubble name when a synchronous session-storage write fails: it changes its signal before `setItem` throws. The existing `Bubbles.rename` calls `placesStorage.write` first and updates its committed signal only on success. Retrying a rejected name must remain an explicit draft action.

This is the separate places case left open by #4273. Together with that merged shared-storage decision and #4287's observer replacement, it completes the Z3788c inventory decisions. #3853 remains open for Z3788a's Terminal addons/compatibility/memory/bytes and Z3788d's valid rendered measurements. No listener or observer replacement is waived.

## Reproduce

The probe runs the current `placesStorage` excerpt alongside the pinned candidate, with synchronous Storage-capability fixtures. It exercises the library's real setter and deserializer, not a replacement persistence implementation. `places-excerpt.ts.txt` is copied verbatim from `places.ts`, starting at `const placesSchema` and ending before `The Terminals`, with its Valibot import added and trailing blank lines removed. `environment.json` records the base and full source hashes; `result.json` records the excerpt hash. The only copied caller operation is `Bubbles.rename`'s success-before-commit conditional.

From the repository root:

```sh
evidence="$PWD/apps/desktop/budgets/evidence/z3788c-places-capability"
probe_dir=$(mktemp -d)
cp "$evidence/probe-lock.json" "$probe_dir/package-lock.json"
node --input-type=module - "$probe_dir" <<'JS'
import fs from 'node:fs';
const dir = process.argv[2];
const lock = JSON.parse(fs.readFileSync(`${dir}/package-lock.json`, 'utf8'));
fs.writeFileSync(`${dir}/package.json`, JSON.stringify({ private: true, type: 'module', dependencies: lock.packages[''].dependencies }));
JS
npm ci --prefix "$probe_dir" --ignore-scripts
cp "$evidence/probe.mjs.txt" "$probe_dir/probe.mjs"
cp "$evidence/places-excerpt.ts.txt" "$probe_dir/places.ts"
node --experimental-strip-types --conditions=browser "$probe_dir/probe.mjs"
```

Use Node 22.23.3 as recorded. The last command exits **1**, with complete stdout in `result.json`; this is an unsupported-capability result, not an acceptance pass. No App dependency, user storage or native process is used. Remove only the temporary directory created above after inspecting it. A second isolated `npm ci` reproduces stdout exactly (`reproduction.json`); omitting the browser export condition exits 2.

| Observed condition | Exit |
| --- | ---: |
| All probed capabilities supported | 0 |
| Failed write changes the candidate signal before acknowledgment | 1 |
| Built-in removal clears the candidate's last readable places | 1 |
| Invalid changed record retains stale candidate places instead of the existing empty fallback | 1 |
| Missing dependencies, unsupported TypeScript import or wrong export condition | 2 |

## Results and limits

| Probe | Existing owner | Candidate 4.4.0 |
| --- | --- | --- |
| Valid saved record | Exact Unicode, whitespace, name and restore rectangle | Same value |
| Missing key, invalid JSON, schema-invalid record | Empty map | Empty initial map; invalid parsing exceptions are swallowed in production |
| Synchronous unreadable read | Empty fallback | Throws `read refused`; there is no successful candidate initialization |
| Successful write | Commits and persists the new places | Same value and serialized storage bytes |
| Synchronous failed write | Returns `quota`; caller retains the acknowledged name and failed draft | Throws `quota`, disk remains old, but its signal already contains `rejected name` |
| Daemon exit | Removes the key while keeping the caller's last readable screen geometry | `set(undefined)` removes the key and clears its signal |
| Invalid storage refresh after a valid value | Reread returns the existing empty fallback | The sync subscriber catches deserialization failure and keeps its prior places |

The failed-write ordering is the adoption blocker. Keeping another committed signal and reconstructing successful-write coordination, removal-only behavior and reread fallback around `makePersisted` would preserve the persistence machinery this row asks to replace. Resetting the persisted setter on failure would itself attempt another write. The removal and refresh rows record additional integration differences, not missing browser-platform capabilities: direct `sessionStorage.removeItem` can retain memory, and a custom deserializer could return the fallback. Neither alone proves an unsupported library. Likewise, readable errors are synchronous here; the earlier shared-storage async acknowledgment and Tauri IPC findings are not used to reject this case.

No nullable `Place` is accepted by the schema; clearing one name removes only its `name` property in a non-null map. `null` and `undefined` both remove the candidate key and clear its signal, as explicitly probed. They are explicitly the candidate's removal operations, not a claimed nullable-caller regression. Existing invalid/unreadable places reads intentionally return an empty map; this report does not claim they expose shared-storage recovery errors.

`storageSync` is documented for localStorage and has no owner-disposal hook in the pinned source. The probe supplies its subscriber directly to inspect deserialization behavior without installing a global listener. No production listener is added or replaced in this slice.

## Reuse

Checked installed browser sessionStorage and `@tauri-apps/plugin-store` 2.5.0 before adoption. Keep sessionStorage in its existing places owner: it already supplies synchronous operations, per-window storage and removal when the Daemon ends. Installed Tauri Store is a maintained alternative ([source](https://github.com/tauri-apps/plugins-workspace/tree/v2/plugins/store), [documentation](https://v2.tauri.app/plugin/store/), [release metadata](https://registry.npmjs.org/@tauri-apps/plugin-store), 2.5.0 published 2026-09-26); its asynchronous file store surviving App restarts changes the required lifetime and is not a direct replacement.

The requested maintained candidate is `@solid-primitives/storage` 4.4.0 ([source](https://github.com/solidjs-community/solid-primitives/tree/main/packages/storage/src), [documentation](https://primitives.solidjs.community/package/storage/), [release metadata](https://registry.npmjs.org/@solid-primitives/storage), published 2026-07-11). Solid 1.9.17 satisfies its peer range. Reject direct adoption for the reproduced failed-write ordering, not preference or lack of maintenance. `packages.json` records freshly fetched npm metadata, integrity and the actual installed source hashes; `probe-lock.json` pins the isolated dependencies. The documentation badge is older than the probed release; pinned package source determines this finding.

No custom implementation is deleted: the scenario explicitly permits retention of an unsupported storage case. No pass-through adapter, generic persistence helper, runtime package, contract or source change is introduced.

## Regression and gates

All **166 tests pass** across the five selected unchanged files (Vitest reports seven suites). `regression.json` preserves each test identity and result. They exercise Bubble reload, selection, name commit/failure, resize persistence, last readable screen lifetime, failed-draft ownership and shared-storage recovery. No test file is edited or redundant test added.

```sh
pnpm --filter desktop exec vitest run src/bubbles/u469_tabs.test.tsx src/bubbles/u511a_rename.test.tsx src/bubbles/p3557c_failure_lifetime.test.tsx src/bubbles/u2236_resize.test.tsx src/state/u2773_storage.test.ts
```

In particular, `u3021c_bubbles_confirmation_settles_only_submitted_edit_failed` checks the old acknowledged name, retained drafts and exactly one attempted write after refusal. `u469_daemon_exit_keeps_one_read_only_bubble_and_clears_saved_places` checks removal while keeping the last visible screen. These existing behavioral proofs justify the capability requirements without adding duplicate tests. `merge-loss`, vocabulary and whitespace checks pass.

P11 applies to the retained name/draft owner. Input, focus, action identity, clipboard ownership, keys, schemas and lifetimes are unchanged. This evidence-only diff changes no rendered path, Token or motion; no moved visual Check or new capture is claimed. It claims no Terminal-addon bytes/memory or native timing pass. The user reports what they meet on the Mac; no user-only observation or product question is pending.
