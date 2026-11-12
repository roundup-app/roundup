//! A12a: a Terminal the core kept across the Daemon is attached again from the core's own record,
//! with no launch; a terminal the core lost is not found, so its Agent stays `done` (A8).
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]

use std::collections::BTreeMap;
use std::time::Duration;

use contracts::terminal::{ReadParams, SpawnParams};
use rpc::Bus;
use terminal::Terminals;

fn read(id: &str) -> ReadParams {
    ReadParams {
        id: id.into(),
        after: Some(0),
        reader: None,
        max: None,
    }
}

#[tokio::test]
async fn a12a_reattach_attaches_the_core_terminal_again() {
    let dir = tempfile::tempdir().unwrap();
    let terminals = Terminals::open(dir.path(), Bus::new()).unwrap();
    let first = terminals
        .spawn(SpawnParams {
            cwd: dir.path().to_string_lossy().into_owned(),
            command: Some(vec!["cat".into()]),
            env: BTreeMap::new(),
            unset: Vec::new(),
            cols: 80,
            rows: 24,
        })
        .await
        .unwrap();
    let (core_id, adopted) = terminals.core_record(&first.id).unwrap().unwrap();
    let again = terminals.reattach(&core_id, adopted, None).await.unwrap();
    assert_ne!(again.id, first.id);
    terminals.write(&again.id, b"after-reattach\n").await.unwrap();
    let seen = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if terminals
                .read(&read(&again.id))
                .unwrap()
                .text
                .contains("after-reattach")
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await;
    assert!(seen.is_ok(), "the reattached Terminal echoes its input");
}

#[tokio::test]
async fn a12a_reattach_of_a_terminal_the_core_lost_is_not_found() {
    let dir = tempfile::tempdir().unwrap();
    let terminals = Terminals::open(dir.path(), Bus::new()).unwrap();
    let first = terminals
        .spawn(SpawnParams {
            cwd: dir.path().to_string_lossy().into_owned(),
            command: Some(vec!["cat".into()]),
            env: BTreeMap::new(),
            unset: Vec::new(),
            cols: 80,
            rows: 24,
        })
        .await
        .unwrap();
    let (_, adopted) = terminals.core_record(&first.id).unwrap().unwrap();
    assert!(
        terminals
            .reattach("no-such-terminal", adopted, None)
            .await
            .is_err()
    );
}
