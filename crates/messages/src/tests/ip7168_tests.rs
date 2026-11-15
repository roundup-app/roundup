//! IP7168a, IP7168b: the push clock sleeps while nothing is pending, and a pending Message wakes it.

use std::time::Duration;

use rusqlite::Connection;
use tokio::sync::broadcast::{Receiver, error::TryRecvError};

use super::*;
use crate::inbox::tests::{pending, setup};

/// One tick of the push clock.
const TICK: Duration = Duration::from_millis(500);

/// Another connection's commits to the Project database since this one last asked.
fn data_version(reader: &Connection) -> i64 {
    reader
        .pragma_query_value(None, "data_version", |row| row.get(0))
        .unwrap()
}

/// Passes of the push clock since the last call.
fn passes(completed: &mut Receiver<&'static str>) -> usize {
    let mut seen = 0;
    loop {
        match completed.try_recv() {
            Ok("clock") => seen += 1,
            Ok(_) | Err(TryRecvError::Lagged(_)) => {}
            Err(_) => return seen,
        }
    }
}

#[tokio::test(start_paused = true)]
async fn ip7168a_an_idle_messages_runtime_commits_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let (messages, _, _) = setup(dir.path());
    let mut completed = messages.inner.completed.subscribe();
    let reader = Connection::open(dir.path().join("project.db")).unwrap();

    tokio::time::sleep(2 * TICK).await;
    passes(&mut completed);
    let before = data_version(&reader);

    tokio::time::sleep(20 * TICK).await;

    assert_eq!(data_version(&reader), before, "an idle clock committed");
    assert_eq!(passes(&mut completed), 0, "an idle clock ran a pass");
}

#[tokio::test(start_paused = true)]
async fn ip7168b_a_pending_message_wakes_the_parked_clock_and_the_clock_parks_again() {
    let dir = tempfile::tempdir().unwrap();
    let (messages, _, _) = setup(dir.path());
    let mut completed = messages.inner.completed.subscribe();

    tokio::time::sleep(2 * TICK).await;
    passes(&mut completed);

    let note = pending(&messages, &Actor::user(), "wake");
    tokio::time::sleep(TICK + TICK / 5).await;
    assert_eq!(passes(&mut completed), 1, "a send did not wake the clock");

    tokio::time::sleep(4 * TICK).await;
    assert!(
        passes(&mut completed) >= 3,
        "the clock stopped while a Message was pending"
    );

    assert!(lock(&messages.inner.store).drop_merged(note.id).unwrap());
    tokio::time::sleep(2 * TICK).await;
    passes(&mut completed);

    tokio::time::sleep(20 * TICK).await;
    assert_eq!(passes(&mut completed), 0, "the clock did not park again");
}
