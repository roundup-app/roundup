# Bound the return note of dropped Messages

Module: `crates/messages`. Ids: RN1, RN2. Acceptance for #5965. Ownership: `crates/messages/src/delivery.rs` and tests in `crates/messages`. It extends DCL4's return note (`scenarios/door-closed-loop.md`, **DCL4**) with B1's body limit and bound (`scenarios/messages.md`, **B1 send**); it adds no RPC, contract type or domain term. Implementation follows the merge of #5963, which adds the return note.

## Checks on main

1. Body limit of 8192 bytes and the bound of 32 pending Messages: `scenarios/messages.md`, **B1 send**.
2. Digest caps, which a return note does not count against: `scenarios/messages.md`, **B22 caps** (d).
3. The return note for a killed Subagent's pending Messages, listing the original IDs and `never reached <Agent>: <cause>`: `scenarios/door-closed-loop.md`, **DCL4**.

## Scenarios

**RN1 A return note lists at most 32 IDs.** Given one Agent that sent more than 32 Messages to a Subagent that is killed with them pending (the bound of B1 does not stop a sender that reached 40 over time, because earlier ones were already stored), when the Daemon closes them under DCL4, then every one of them is `dropped` with the cause and stays readable by its sender through `message.get`, and the sender gets one return note whose body lists the first 32 IDs in ascending order, then one line `[+n more: #<first> to #<last>]` naming the count `n` of the others and the lowest and highest of their IDs, then `never reached <Agent>: <cause>`. A sender with 32 or fewer gets the note DCL4 describes, unchanged and without that line. Repeat reconciliation or restart creates no second note. Test: `rn1_a_return_note_lists_32_ids_and_counts_the_rest` in `crates/messages` (40 pending: 32 IDs listed, `+8 more`, 40 `dropped`, one note, a second reconcile adds none).

**RN2 A return note never exceeds the oversized-body limit.** Given a killed Subagent whose cause text is longer than 8192 bytes, or IDs that with the cause push the body past 8192 bytes, when its pending Messages are closed, then the return note is still created (never refused with `INVALID_PARAMS`), its body is at most 8192 bytes, the cause is cut at a character boundary at or before byte 512 and ends `[cut]` when longer, the ID list and `[+n more …]` line of RN1 are kept whole, and no Message is left `pending`. Test: `rn2_a_return_note_with_a_long_cause_stays_within_8192_bytes` in `crates/messages` (a 20 000-byte cause with 40 pending: note at most 8192 bytes, ends with the cut cause, 40 `dropped`).

Policy: RN1 and RN2 change neither DCL4's accounting nor B22's caps; a return note is not a pushed digest and does not count against B1's 32.
