//! PS9 Agents keep their Kind.

use contracts::{Kind, Status};

use crate::common::{Fixture, status_of};

fn reported(kind: Kind, label: &str) -> Status {
    Status {
        kind,
        label: label.into(),
        since: 1,
        finished: "0".into(),
    }
}

async fn terminal_of(f: &Fixture, id: &str) -> String {
    f.tree()
        .await
        .into_iter()
        .find(|node| node.id == id)
        .and_then(|node| node.terminal_id)
        .expect("a running Agent has a Terminal")
}

#[tokio::test]
async fn ps9_a_report_in_a_hooked_agents_terminal_never_changes_its_kind() {
    let f = Fixture::running("sleep 30");
    let node = f.spawn(None, None).await.unwrap();
    let before = status_of(&f.tree().await, &node.id).clone();

    for kind in [Kind::NeedsYou, Kind::Error, Kind::Done, Kind::Idle] {
        f.agents
            .observe_program_status(&terminal_of(&f, &node.id).await, reported(kind, "report"));
    }

    assert_eq!(status_of(&f.tree().await, &node.id), &before);
}

#[tokio::test]
async fn ps9_an_agent_without_signals_takes_its_terminals_status() {
    let f = Fixture::running("sleep 30");
    let node = f.spawn(None, None).await.unwrap();
    f.agents.drop_hooks_for_test(&node.id);

    f.agents.observe_program_status(
        &terminal_of(&f, &node.id).await,
        reported(Kind::NeedsYou, "pick one"),
    );

    let tree = f.tree().await;
    let status = status_of(&tree, &node.id);
    assert_eq!(
        (status.kind, status.label.as_str()),
        (Kind::NeedsYou, "pick one")
    );
}
