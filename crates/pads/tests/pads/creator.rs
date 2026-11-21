use super::*;

#[tokio::test]
async fn lh19_a_pad_keeps_its_creator() {
    let rig = Rig::new();
    let a = agent("a");
    rig.ok(&a, "pad.create", json!({"name": "notes", "text": "hi"}))
        .await;
    rig.store_row("older");

    let read = rig.ok(&a, "pad.read", json!({"name": "notes"})).await;
    assert_eq!(
        read["creator"],
        json!({"kind": "agent", "id": "a", "parent": null})
    );
    // Another Actor's edit and a read of the list leave the creator alone.
    rig.ok(
        &agent("b"),
        "pad.write",
        json!({"name": "notes", "text": "more"}),
    )
    .await;
    let listed = rig.ok(&a, "pad.list", json!({})).await;
    let by = |name: &str| {
        listed
            .as_array()
            .unwrap()
            .iter()
            .find(|pad| pad["name"] == name)
            .unwrap()
            .clone()
    };
    assert_eq!(by("notes")["creator"]["id"], "a");
    // A Pad from before the creator was kept reads as the user's.
    assert_eq!(by("older")["creator"]["kind"], "user");
}
