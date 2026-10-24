//! D11: a subscription replays from the log, then streams live, with no gap and no repeat.

use std::sync::Mutex;

use contracts::{Actor, Event, EventData};
use rpc::{Bus, EventLog, RpcError, Subscription};

#[derive(Default)]
struct Memory(Mutex<Vec<Event>>);

impl EventLog for Memory {
    fn append(&self, event: &Event) -> Result<u64, RpcError> {
        let mut saved = self.0.lock().unwrap();
        let seq = saved.len() as u64 + 1;
        saved.push(Event {
            seq: Some(seq),
            ..event.clone()
        });
        Ok(seq)
    }

    fn read(&self, after: u64, limit: usize) -> Result<Vec<Event>, RpcError> {
        let saved = self.0.lock().unwrap();
        Ok(saved
            .iter()
            .skip(after as usize)
            .take(limit)
            .cloned()
            .collect())
    }

    fn bounds(&self) -> Result<(u64, u64), RpcError> {
        Ok((1, self.0.lock().unwrap().len() as u64))
    }
}

fn bus() -> Bus {
    Bus::with_log(std::sync::Arc::new(Memory::default()))
}

fn emit(bus: &Bus, count: usize) {
    for _ in 0..count {
        bus.emit(Actor::user(), EventData::RailChanged);
    }
}

async fn take(sub: &mut Subscription, count: usize) -> Vec<u64> {
    let mut seen = Vec::new();
    for _ in 0..count {
        let event = tokio::time::timeout(std::time::Duration::from_secs(5), sub.next())
            .await
            .expect("the Event arrives")
            .unwrap();
        seen.extend(event.seq);
    }
    seen
}

#[tokio::test]
async fn d11_replay_then_live_has_no_gap_and_no_repeat() {
    let bus = bus();
    emit(&bus, 20);
    let mut sub = bus.subscribe_after(Some(12)).unwrap();
    // Saved while the replay is parked: it is in the ring and must not be sent twice.
    emit(&bus, 3);
    let first = take(&mut sub, 11).await;
    emit(&bus, 2);
    let rest = take(&mut sub, 2).await;
    assert_eq!([first, rest].concat(), (13..=25).collect::<Vec<_>>());
}

#[tokio::test]
async fn d11_subscribe_without_after_streams_only_new_events() {
    let bus = bus();
    emit(&bus, 5);
    let mut sub = bus.subscribe_after(None).unwrap();
    emit(&bus, 2);
    assert_eq!(take(&mut sub, 2).await, [6, 7]);
}

#[tokio::test]
async fn d11_a_slow_subscriber_catches_up_from_the_log() {
    let bus = bus();
    let mut sub = bus.subscribe_after(None).unwrap();
    // More than the 1024-Event ring holds, none read.
    emit(&bus, 3000);
    assert_eq!(take(&mut sub, 3000).await, (1..=3000).collect::<Vec<_>>());
    emit(&bus, 1);
    assert_eq!(take(&mut sub, 1).await, [3001]);
}
