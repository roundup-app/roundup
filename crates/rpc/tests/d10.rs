//! D10: an Event the log refuses reaches no subscriber, so every Event a subscriber sees is numbered.

use std::sync::Arc;

use contracts::{Actor, Event, EventData};
use rpc::{Bus, EventLog, RpcError, code};

struct Refusing;

impl EventLog for Refusing {
    fn append(&self, _event: &Event) -> Result<u64, RpcError> {
        Err(RpcError::new(code::INTERNAL, "disk full"))
    }

    fn read(&self, _after: u64, _limit: usize) -> Result<Vec<Event>, RpcError> {
        Ok(Vec::new())
    }

    fn bounds(&self) -> Result<(u64, u64), RpcError> {
        Ok((1, 0))
    }
}

#[test]
fn d10_an_event_the_log_refuses_reaches_no_subscriber() {
    let bus = Bus::with_log(Arc::new(Refusing));
    let mut receiver = bus.subscribe();
    bus.emit(Actor::user(), EventData::RailChanged);
    assert!(receiver.try_recv().is_err());
}
