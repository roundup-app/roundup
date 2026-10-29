//! X11, X12: a Terminal with an owner is a bubble's, and `terminal.close` forgets it.

use contracts::EventData;
use rpc::code;

use crate::common::{open, sh, until_exit};

fn changes(events: &mut tokio::sync::broadcast::Receiver<contracts::Event>) -> usize {
    std::iter::from_fn(|| events.try_recv().ok())
        .filter(|event| matches!(event.data, EventData::TerminalChanged))
        .count()
}

#[tokio::test]
async fn x12_close_kills_and_forgets_an_owned_terminal() {
    let dir = tempfile::tempdir().unwrap();
    let (terminals, bus) = open(&dir);
    let mut events = bus.subscribe();
    let spawned = terminals
        .spawn_owned(sh(dir.path(), "sleep 30"), "w")
        .await
        .unwrap();
    assert_eq!(changes(&mut events), 1);

    terminals.close(&spawned.id).await.unwrap();

    assert!(terminals.list().await.is_empty());
    assert_eq!(changes(&mut events), 1);
    assert_eq!(
        terminals.close(&spawned.id).await.unwrap_err().code,
        code::NOT_FOUND
    );
    assert_eq!(
        terminals.write(&spawned.id, b"x").await.unwrap_err().code,
        code::NOT_FOUND
    );
}

#[tokio::test]
async fn x12_close_on_an_ownerless_terminal_is_refused_and_leaves_it() {
    let dir = tempfile::tempdir().unwrap();
    let (terminals, _bus) = open(&dir);
    let mut spawned = terminals.spawn(sh(dir.path(), "sleep 30")).await.unwrap();

    let err = terminals.close(&spawned.id).await.unwrap_err();

    assert_eq!(err.code, code::INVALID_PARAMS);
    assert!(terminals.list().await[0].running);
    assert!(spawned.events.try_recv().is_err());
    terminals.kill(&spawned.id).await.unwrap();
    let (_, code) = until_exit(&mut spawned).await;
    assert_eq!(code, None);
}

#[tokio::test]
async fn x11_the_ninth_forgets_the_oldest_exited_and_conflicts_when_all_run() {
    let dir = tempfile::tempdir().unwrap();
    let (terminals, _bus) = open(&dir);
    let mut first = terminals
        .spawn_owned(sh(dir.path(), "exit 0"), "a")
        .await
        .unwrap();
    until_exit(&mut first).await;
    for _ in 1..8 {
        terminals
            .spawn_owned(sh(dir.path(), "sleep 30"), "a")
            .await
            .unwrap();
    }

    terminals
        .spawn_owned(sh(dir.path(), "sleep 30"), "a")
        .await
        .unwrap();

    assert!(terminals.list().await.iter().all(|t| t.id != first.id));
    let err = terminals
        .spawn_owned(sh(dir.path(), "sleep 30"), "a")
        .await
        .err()
        .expect("a ninth running Terminal is refused");
    assert_eq!(err.code, code::CONFLICT);
    assert_eq!(terminals.list().await.len(), 8);
    terminals.close_owned_by("a").await.unwrap();
}
