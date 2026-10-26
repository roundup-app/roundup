# Raw saved storage (U4251b/c)

The existing sidecar adds two requests. Both use the effective `CLAUDE_CONFIG_DIR`,
make no Model call and return an explicit `error` with recovery on failure.

| Request | Result |
| --- | --- |
| `snapshot {sessionId, revision?}` | SDK-resolved `path`, opaque `revision`, base64 `records` |
| `destination {sessionId, dir}` | Exclusively reserved empty SDK `path`, initial `revision` |

`snapshot` returns every newline-terminated byte, including invalid JSON, and omits
an unterminated tail. It does not establish eligibility: the existing selected-source
validator must still check complete-record JSON, foreign identity, ownership and
publication policy. The revision includes device, inode, size, nanosecond mtime and
ctime. Supplying a revision refuses a stale source. Lookup is global by identity;
duplicates refuse, including when the recorded cwd moved. A snapshot is bounded at
512 MiB, matching the existing retained-record bound. Lookup is repeated after the
read and both the open file and the currently resolved file must retain the revision.

`destination` requires an absolute Project directory and a fresh UUID. It uses the
SDK's own canonicalization and local path builder, including truncated long-path
hashing. It refuses identities already present in any bucket and creates with `wx`
and mode 0600. The caller owns filling the file and ownership-safe cleanup; it must
not overwrite a destination replaced since that reservation. A filled file is readable
by SDK identity. This primitive leaves the existing copy holders and all callers in
place; #4251 owns migration and complete journey acceptance.

## Version-pinned extension

`patches/@anthropic-ai__claude-agent-sdk@0.3.309.patch` adds only
`roundupResolveSession` and `roundupCreateDestination` to the installed SDK.
It reuses the SDK's `M9e` directory authority, `ht` storage root and `fl(Cv(dir))`
path builder. No directory-discovery or path-encoding algorithm is copied into
roundup. A root-access check prevents the SDK's empty-on-error enumeration from
hiding a storage-access failure. Individual source failures propagate too.

On each SDK update, rebind these private helpers against that exact release and run
`node --test crates/agents/sidecar/storage.test.mjs` after a clean `pnpm install`.
Never accept a patch merely because its context applies: the tests must still prove
raw framing, duplicates, replaced inode and destination read-back in hashed storage.
Remove the extension when the upstream public API supplies these guarantees. A
missing extension reports that the pinned sidecar needs reinstalling.

## Reuse

Read the installed SDK declarations and implementation first. Public
`getSessionMessages` filters the conversation chain; `importSessionToStore` parses
and skips invalid complete records and includes valid unterminated JSON; the resolver
selects the first duplicate. Public `forkSession` parses/rewrites records, so it cannot
retain raw framing. Select the pinned Agent SDK with the small extension above.
The SDK remains maintained: [v0.3.310, released 2026-10-23](https://github.com/anthropics/claude-agent-sdk-typescript/releases/tag/v0.3.310).

Also considered the maintained [Anthropic TypeScript SDK v1.3.0, released
2026-10-23](https://github.com/anthropics/anthropic-sdk-typescript/releases/tag/sdk-v1.3.0).
Its [public client](https://github.com/anthropics/anthropic-sdk-typescript#usage)
provides remote API requests, with no Claude Code local saved-storage authority,
identity resolver or local destination capability. Node's installed filesystem API
supplies exact handle reads, exclusive creation and inode metadata, but lacks the
vendor's storage identity and hashed-path rules; use it only after SDK resolution.
