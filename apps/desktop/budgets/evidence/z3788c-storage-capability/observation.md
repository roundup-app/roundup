# Z3788c storage capability decision

Keep `apps/desktop/src/state/storage.ts`'s `storedValue` and its callers under Z3788c's conditional storage alternative. The pinned candidate cannot supply the current restore-failure and acknowledged-write interface directly. Its raw initialization slot would require callers to deserialize and classify failures again; capturing errors in a custom serializer or storage wrapper would rebuild persistence around it. No such wrapper is introduced.

Observed on Linux, Node v22.23.3, base `e2dc4dfd8`, 2026-10-26. This decision covers only `storedValue`; `bubbles/places.ts`'s `placesStorage` still needs its own capability decision or adoption. #3853 stays open for that case, cutTitle, Terminal addons and virtualization observations. No listener/observer replacement is waived.

## Reproduce

From the repository root, use an isolated directory with the archived npm lock. No candidate is installed into the App:

```sh
evidence="$PWD/apps/desktop/budgets/evidence/z3788c-storage-capability"
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
node --conditions=browser "$probe_dir/probe.mjs"
```

The probe exits **1** for observed unsupported capabilities and **2** for missing dependencies or the wrong Solid export condition; **0** requires every probed capability to be supported. `result.json` is the complete stdout. `probe-lock.json` pins transitive dependencies; `packages.json` records primary npm metadata, publication times, tarball integrity and the probed source hashes. This uses Solid's browser export without its development condition; it claims neither browser rendering nor native durability. Remove only the temporary directory created above after inspection.

## Observations

| Input / boundary | Candidate 4.4.0 result | Current contract / decision |
| --- | --- | --- |
| Valid JSON containing exact whitespace, Unicode and newline | Restores exact text. | Supported; no reason to reject this case. |
| Missing key | Returns the initial in-memory value. | A missing value must remain distinguishable from invalid/unreadable. |
| `{broken`, then schema-invalid `{"text":4}`, with Valibot in `deserialize` | Both return the initial value, no exception and zero production warnings. Raw bytes remain in tuple slot 2. | `storedValue.restore` returns `failed/invalid`; `draftStorage` retains original bytes and exposes recovery. Classifying raw bytes separately duplicates the candidate's parsing, and side-channel error capture rebuilds its failure owner. Both unsupported rows exit 1. |
| Synchronous `getItem` throws | Construction throws `unreadable`. | This cause is available to a caller's catch; it is not a swallowed-read claim. The existing owner provides a recoverable result and retry. |
| Direct setters receive null and undefined | Both call `removeItem`. | Explicitly probed compatibility differences. These are not claimed as regressions in a current nullable caller; current callers retain their schemas and formats. |
| Synchronous write throws `quota` | Setter throws after updating its in-memory signal. | The error is observable, so this is not a swallowed-write claim. The original memory and acknowledged stored value remain separately owned by existing draft logic. |
| Async write rejects `save reply lost` | Setter returns the value, not a Promise; the storage Promise rejects independently. | `storedValue.write` awaits native set/save and returns the failure; `onRetained` runs only on success. Catching the adapter's independent Promise and manufacturing a retention result would rebuild this interface. Unsupported row exits 1. |
| `tauriStorage('work.json').getItem('probe')` with installed plugin-store 2.5.0 | First IPC call is `plugin:store\|get`, with `rid: 'work.json'`, no load. | Plugin-store's `Store` constructor accepts an existing resource id; the App uses official `load`, explicit save and reopen. This is an IPC-boundary probe, not a native test. Unsupported row exits 1. |

The `storedValue` decision applies atomically to its existing callers: `rail/persist/storage.ts`, `rail/importState.ts`, `resize/widths.ts`, `shelf/frame.ts`, `state/projects.ts`, `state/unseen.ts`, `settings/preferences.ts`, `terminal/fontSize.ts` and `state/storage.ts`'s `draftStorage`. They keep their existing keys, native versioned envelopes, schemas, serialized writes, expected-value conflict checks, acknowledged callbacks, recovery and revision-consumption rules. Credentials remain memory-only.

## Reuse

The installed platform/library already owns persistence: `@tauri-apps/plugin-store` 2.5.0, [official source](https://github.com/tauri-apps/plugins-workspace/tree/v2/plugins/store), [documentation](https://v2.tauri.app/plugin/store/) and [release metadata](https://registry.npmjs.org/@tauri-apps/plugin-store), published 2026-09-26. Retain it under the existing domain owner. Browser Storage remains the explicitly supplied harness capability; Bubble places retain their session scope pending their separate decision.

The alternative is `@solid-primitives/storage` 4.4.0, [source](https://github.com/solidjs-community/solid-primitives/tree/main/packages/storage/src), [documentation](https://primitives.solidjs.community/package/storage/) and [release metadata](https://registry.npmjs.org/@solid-primitives/storage), published 2026-07-11. The installed Solid 1.9.17 satisfies its peer range. Reject adoption for `storedValue` on the reproduced error/acknowledgment gaps above, not maintenance or preference. No custom implementation is deleted because the scenario expressly permits retaining this unsupported storage case. No pass-through adapter, runtime dependency, contract or product code is added.

## Existing regression observers

The unchanged five suites pass: **159 tests**, 55.32 seconds. Command:

```sh
pnpm --filter desktop exec vitest run src/state/u2773_storage.test.ts src/state/u3787f_storage.test.ts src/state/u4086_storage_recovery.test.tsx src/bubbles/u469_tabs.test.tsx src/bubbles/p3557c_failure_lifetime.test.tsx
```

`regression.json` preserves test identities and outcomes. U2773 covers exact draft/selection/recipient recovery, invalid/unreadable distinction, failed-write memory, external conflicts, revision consumption and credential policy. U3787f covers official plugin IPC, acknowledged save/reopen and migration; U4086 covers retained invalid bytes and per-record recovery. U469 and P3557c preserve Bubble reload/selection and failure ownership. No test file is edited or redundant test added. P11 applies; this evidence-only diff changes no rendered path, Token, layout, motion, input, focus or action identity, so no moved visual Check or new capture is claimed. Terminal-addon memory/byte and virtualization budgets remain unobserved here.
