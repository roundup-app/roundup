//! R16's allocation prerequisite (#1327), not an RSS observation or baseline.
#![cfg(target_arch = "x86_64")]
use std::alloc::System;
use std::mem::size_of;

use contracts::EventData;
use stats_alloc::{INSTRUMENTED_SYSTEM, Region, StatsAlloc};
use tokio::sync::broadcast;

#[global_allocator]
static ALLOCATOR: &StatsAlloc<System> = &INSTRUMENTED_SYSTEM;

// Keep the allocation observer alone in its integration-test binary so parallel tests
// cannot contribute allocations to its measurement.
#[test]
fn r16_idle_event_backlogs_fit_the_historical_allocation() {
    assert!(
        size_of::<EventData>() <= 96,
        "EventData exceeds the historical 96 bytes"
    );
    assert!(size_of::<Option<EventData>>() <= 96);

    let region = Region::new(ALLOCATOR);
    let channels: [_; 10] = std::array::from_fn(|_| broadcast::channel::<EventData>(1024));
    let allocated = region.change().bytes_allocated;
    // The historical trace has ten 122,880-byte slot buffers. Allow 4 KiB total
    // for channel metadata, not the current ten 204,800-byte slot buffers.
    assert!(
        allocated <= 10 * 122_880 + 4096,
        "ten idle backlogs allocated {allocated} bytes"
    );
    eprintln!(
        "EventData={} Option<EventData>={} ten idle backlogs={allocated} bytes",
        size_of::<EventData>(),
        size_of::<Option<EventData>>()
    );

    for (sender, mut receiver) in channels {
        for id in 0..1024 {
            sender
                .send(EventData::TodoDeleted(contracts::todo::TodoId { id }))
                .unwrap();
        }
        for id in 0..1024 {
            assert!(
                matches!(receiver.try_recv().unwrap(), EventData::TodoDeleted(todo) if todo.id == id)
            );
        }
        for id in 0..1025 {
            sender
                .send(EventData::TodoDeleted(contracts::todo::TodoId { id }))
                .unwrap();
        }
        assert!(matches!(
            receiver.try_recv(),
            Err(broadcast::error::TryRecvError::Lagged(1))
        ));
        assert!(
            matches!(receiver.try_recv().unwrap(), EventData::TodoDeleted(todo) if todo.id == 1)
        );
    }
}
