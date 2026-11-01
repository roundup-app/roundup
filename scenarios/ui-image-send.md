# Retired: Daemon image saving (U419)

**U419 the Daemon saves an Attachment file.** Retired by C5461a (`scenarios/unused-contract-retirement.md`), following U467's retirement of the Thread composer, Attachments and feed (`scenarios/door-terminal.md`).

Retired-scenario note: `attachment.save`, its Daemon-owned Attachment file and all five Save clauses (bytes, sanitized names, unique paths, invalid/oversized-data refusal and seven-day startup expiry) retire together with their tests in `crates/rup/tests/attachment.rs`. Send, Failure, Feed and Kept were already retired by U467. No Message body gains an image path through this retired composer.

Pasted images still use U418's App command and native cache and reach a Terminal as a quoted file path (`scenarios/ui-terminal-paste.md`). C5461a removes the unused contract and wiring; this note does not claim that implementation has landed.
