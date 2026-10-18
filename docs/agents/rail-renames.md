# Consuming Rail renames

A2741a exposes `EventData::RailRenamed { id, name }` on the existing Bus:

```text
rail.rename ────────┐
                   ├─ Rail write commits → rail.renamed {id, name} → Bus
first prompt (A9) ─┘
```

`id` is the target's exact machine id, never the caller or a display name. For a
Workstream it is also the Door id, whether that Door runs or is stopped. `name`
is the value actually committed, including a first-prompt sibling suffix. Consume
that value rather than rereading the Rail: two pending events can name `sad-2`
and `sad-3` while the Rail already says `sad-3`.

Both producers publish after a successful changed-name write, while still holding
the same Rail mutation lock. Its acquisition order serializes concurrent writes
and their publications. Failed calls and unchanged names publish no rename.
Creation, movement, reordering and Status changes publish none. Existing
`rail.changed` emissions remain, including successful same-name RPC renames.
Naming and Reach checks are unchanged.

## Daemon composition for #2704

Subscribe on the production Bus before accepting mutations, using
`bus.subscribe_after(None)?`. In the Daemon consumer, match each event:

```rust,ignore
let mut changes = bus.subscribe_after(None)?;
while let Some(event) = changes.next().await {
    if let contracts::EventData::RailRenamed { id, name } = event.data {
        // B2704a consumes this destination and committed name here.
        // Deliver outside Agents; do not reread the current Rail name.
    }
}
```

This call captures the current saved-event head and follows later events. A
consumer resuming from a known Event number can use
`bus.subscribe_after(Some(seq))?`; `bus.saved_after(seq)?` provides a finite replay.
The saved Event number supplies the deduplication cursor when composing replay
and live consumption. No producer callback, Agents edit or custom delivery queue
is needed for #2704. This PR implements no Message or Context prose, and does not
complete B2704a or E2704a. Message laws M1–M10 are unaffected.

## Retention and failure limits

The live Bus ring retains 1024 events across all event kinds. A raw
`bus.subscribe()` receiver must handle `Lagged`; it does not replay. The production
Bus uses the existing saved-event log, retaining the last `rpc::EVENT_WINDOW`
(10 000) events. `subscribe_after` recovers live lag from that log, provided the
needed events remain. Starting replay before the retained window is
`EVENTS_EXPIRED`; an attached subscription that falls beyond the window cannot
recover events already pruned. With `Bus::new()` there is no saved replay.

A failed log append is reported by the existing Bus and still publishes an unsaved
live event (`seq: None`); replay cannot recover it. The Rail write and event log
are separate writes, so this seam promises no crash recovery or atomic commit
across a Daemon restart. Consumers must respect these existing Bus limits rather
than infer unlimited retention or durable delivery from this producer seam.
