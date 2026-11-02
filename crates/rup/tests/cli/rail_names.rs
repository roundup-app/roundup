//! I2706a: CLI user labels and machine identities.
use super::*;

#[tokio::test]
async fn i2706a_help_explains_rail_names_and_machine_ids() {
    let dir = tempfile::tempdir().unwrap();
    for args in [
        vec!["help"],
        vec!["help", "agent"],
        vec!["help", "rail"],
        vec!["help", "workstream"],
    ] {
        let result = on(&dir.path().join("absent.sock")).rup(&args).await;
        assert_eq!(code(&result), 0);
        assert!(
            out(&result).contains("Rail name")
                && out(&result).contains("IDs remain command arguments"),
            "{}",
            out(&result)
        );
        assert!(out(&result).contains("ROUNDUP_AGENT"));
    }
}

#[tokio::test]
async fn i2706a_plain_output_uses_current_rail_names() {
    let fx = common::NamedRail::start().await;
    let run = on(&fx.served.socket()).acting_as(Some(&fx.door));
    let spare = fx.spawn("Spare").await;
    let discarded = run.rup(&["agent", "discard", &spare]).await;
    assert_eq!(code(&discarded), 0, "{}", err(&discarded));
    assert_eq!(out(&discarded), "discarded Worktree of Agent Spare\n");
    for renamed in [false, true] {
        if renamed {
            fx.rename().await;
        }
        let (door, child) = if renamed {
            ("Planning", "Author")
        } else {
            ("Research", "Writer")
        };
        let moved = run
            .rup(&["rail", "move", &fx.child, "--parent", &fx.door, "0"])
            .await;
        assert_eq!(code(&moved), 0, "{}", err(&moved));
        assert_eq!(out(&moved), format!("moved {child} to {door}\n"));
        for args in [
            vec!["rail", "tree"],
            vec!["agent", "context"],
            vec!["agent", "digest"],
        ] {
            let caller = if args == ["agent", "context"] {
                &fx.child
            } else {
                &fx.door
            };
            let shown = on(&fx.served.socket())
                .acting_as(Some(caller))
                .rup(&args)
                .await;
            assert_eq!(code(&shown), 0, "{}", err(&shown));
            assert!(out(&shown).ends_with('\n'));
            let items: Vec<Value> = out(&shown)
                .lines()
                .map(|line| serde_json::from_str(line).unwrap())
                .collect();
            match args.as_slice() {
                ["rail", "tree"] => {
                    let node = items.iter().find(|node| node["id"] == fx.child).unwrap();
                    assert_eq!(node["name"], child);
                    assert_eq!(node["parent_name"], door);
                }
                ["agent", "context"] => {
                    assert_eq!(items[0]["self"]["id"], fx.child);
                    assert_eq!(items[0]["self"]["name"], child);
                    assert_eq!(items[0]["parent"]["name"], door);
                    assert_eq!(items[0]["ask"]["name"], door);
                }
                ["agent", "digest"] => assert!(
                    items[0]["children"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .any(|entry| entry["name"] == child)
                ),
                _ => unreachable!(),
            }
        }
    }
    let tree = fx.user.request("rail.tree", ()).await.unwrap();
    let path = tree
        .as_array()
        .unwrap()
        .iter()
        .find(|node| node["id"] == fx.child)
        .unwrap()["worktree"]["path"]
        .as_str()
        .unwrap();
    let discarded = run.rup(&["agent", "discard", &fx.child]).await;
    assert_eq!(code(&discarded), 0, "{}", err(&discarded));
    assert_eq!(out(&discarded), "discarded Worktree of Agent Author\n");
    assert!(!Path::new(path).exists());
}

#[tokio::test]
async fn i2706a_json_keeps_machine_results() {
    let fx = common::NamedRail::start().await;
    let run = on(&fx.served.socket()).acting_as(Some(&fx.door));
    for renamed in [false, true] {
        if renamed {
            fx.rename().await;
        }
        for (args, method, params) in [
            (vec!["rail", "tree", "--json"], "rail.tree", Value::Null),
            (
                vec!["agent", "context", "--json"],
                "agent.context",
                json!({"id":fx.door}),
            ),
            (
                vec!["agent", "digest", "--json"],
                "agent.digest",
                json!({"id":fx.door}),
            ),
        ] {
            let actual = run.rup(&args).await;
            assert_eq!(code(&actual), 0, "{}", err(&actual));
            let mut expected = fx.user.request(method, params).await.unwrap();
            let mut actual = serde_json::from_str::<Value>(&out(&actual)).unwrap();
            // These are separate live reads: hooks may publish Status between them.
            strip_status(&mut expected);
            strip_status(&mut actual);
            assert_eq!(actual, expected);
        }
        let moved = run
            .rup(&[
                "rail", "move", &fx.child, "--parent", &fx.door, "0", "--json",
            ])
            .await;
        assert_eq!(code(&moved), 0, "{}", err(&moved));
        assert_eq!(out(&moved), "null\n");
    }
    let discarded = run.rup(&["agent", "discard", &fx.child, "--json"]).await;
    assert_eq!(code(&discarded), 0, "{}", err(&discarded));
    assert_eq!(out(&discarded), "null\n");
}

fn strip_status(value: &mut Value) {
    match value {
        Value::Object(object) => {
            object.remove("status");
            object.remove("status_revision");
            for value in object.values_mut() {
                strip_status(value);
            }
        }
        Value::Array(items) => items.iter_mut().for_each(strip_status),
        _ => {}
    }
}

