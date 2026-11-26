//! U7955a: every read the Changes view makes traces and reads an Agent with no Worktree through its
//! group (`scenarios/ui-changes-remote-main.md`).

use std::path::PathBuf;

use rpc::code;
use serde_json::{Value, json};

use crate::common::Fixture;
use crate::u7853a_group_read::{git, key, shared_checkout, write, wrote};

/// The Agent wrote `seed.txt` in the main checkout and `lin.rs` in a linked git worktree.
async fn writes() -> (Fixture, String, Vec<(Value, PathBuf)>, impl Sized) {
    let (f, id, project, origin) = shared_checkout().await;
    wrote(&f, &id, &write(&project, "seed.txt", "a\nchanged\n")).await;
    let linked = tempfile::tempdir().unwrap();
    let dir = std::fs::canonicalize(linked.path()).unwrap().join("wt");
    git(
        &project,
        &[
            "worktree",
            "add",
            "-q",
            "-b",
            "own/linked",
            &dir.display().to_string(),
        ],
    );
    wrote(&f, &id, &write(&dir, "lin.rs", "fn lin() {}\n")).await;
    let owned = f
        .call("agent.ownedChanges", json!({"id": id}))
        .await
        .unwrap();
    let groups = owned["groups"].as_array().unwrap();
    let sites = groups
        .iter()
        .map(|g| {
            let top = if g["branch"] == "main" {
                &project
            } else {
                &dir
            };
            (key(g), top.clone())
        })
        .collect();
    (f, id, sites, (origin, linked))
}

fn with_group(id: &str, group: &Value, extra: Value) -> Value {
    let mut params = json!({"id": id, "group": group});
    for (name, value) in extra.as_object().unwrap() {
        params[name] = value.clone();
    }
    params
}

/// What `method` answers for `group`, and that answer proving the checkout `top` was read.
async fn proves(f: &Fixture, id: &str, method: &str, group: &Value, top: &PathBuf) {
    let linked = top.ends_with("wt");
    let (file, language) = if linked {
        ("lin.rs", "rust")
    } else {
        ("seed.txt", "")
    };
    match method {
        "agent.callPaths" => {
            let r = f
                .call(method, with_group(id, group, json!({})))
                .await
                .unwrap();
            let rows = r["languages"].as_array().cloned().unwrap_or_default();
            assert_eq!(
                rows.iter().any(|row| row["language"] == language),
                linked,
                "{r}"
            );
        }
        "agent.repeatScan" => {
            f.call(method, with_group(id, group, json!({})))
                .await
                .unwrap();
        }
        "agent.readback" => {
            let r = f
                .call(method, with_group(id, group, json!({})))
                .await
                .unwrap();
            assert_eq!(r["state"], "notRead");
        }
        "agent.explain" => {
            let params =
                json!({"path": file, "side": "new", "start": 900, "end": 901, "form": "words"});
            let r = f.call(method, with_group(id, group, params)).await.unwrap();
            assert_eq!(r["kind"], "outOfDiff", "{r}");
        }
        _ => {
            // The model call comes after the checkout is read, and answers a state, not `no_worktree`.
            let r = f
                .call(method, with_group(id, group, json!({})))
                .await
                .unwrap();
            assert!(r.get("state").is_some(), "{r}");
        }
    }
}

async fn reads_the_checkout(method: &str) {
    let (f, id, sites, _keep) = writes().await;
    assert_eq!(sites.len(), 2);
    for (group, top) in &sites {
        proves(&f, &id, method, group, top).await;
    }
}

async fn refuses_a_group(method: &str) {
    let (f, id, sites, _keep) = writes().await;
    let repo = sites[0].0["repo"].clone();
    let params = if method == "agent.explain" {
        json!({"path": "seed.txt", "side": "new", "start": 1, "end": 1, "form": "words"})
    } else {
        json!({})
    };
    for group in [
        json!({"repo": repo, "branch": "nowhere"}),
        json!({"repo": "/tmp", "branch": "main"}),
    ] {
        let err = f
            .call(method, with_group(&id, &group, params.clone()))
            .await
            .unwrap_err();
        assert_eq!(err.code, code::INVALID_PARAMS);
        assert!(err.message.starts_with("unsafe_path: "), "{}", err.message);
    }
}

macro_rules! method {
    ($reads:ident, $refuses:ident, $name:literal) => {
        #[tokio::test]
        async fn $reads() {
            reads_the_checkout($name).await;
        }
        #[tokio::test]
        async fn $refuses() {
            refuses_a_group($name).await;
        }
    };
}

method!(
    u7955a_call_paths_reads_the_checkout_the_groups_writes_sit_in,
    u7955a_call_paths_refuses_a_group_the_writes_do_not_name,
    "agent.callPaths"
);
method!(
    u7955a_repeat_scan_reads_the_checkout_the_groups_writes_sit_in,
    u7955a_repeat_scan_refuses_a_group_the_writes_do_not_name,
    "agent.repeatScan"
);
method!(
    u7955a_readback_reads_the_checkout_the_groups_writes_sit_in,
    u7955a_readback_refuses_a_group_the_writes_do_not_name,
    "agent.readback"
);
method!(
    u7955a_readback_start_reads_the_checkout_the_groups_writes_sit_in,
    u7955a_readback_start_refuses_a_group_the_writes_do_not_name,
    "agent.readbackStart"
);
method!(
    u7955a_explain_reads_the_checkout_the_groups_writes_sit_in,
    u7955a_explain_refuses_a_group_the_writes_do_not_name,
    "agent.explain"
);
method!(
    u7955a_find_defects_reads_the_checkout_the_groups_writes_sit_in,
    u7955a_find_defects_refuses_a_group_the_writes_do_not_name,
    "agent.findDefects"
);

#[tokio::test]
async fn u7955a_tree_and_branch_read_as_before_and_without_a_group_an_agent_without_a_worktree_fails()
 {
    let (f, id, sites, _keep) = writes().await;
    for method in ["agent.callPaths", "agent.repeatScan", "agent.readback"] {
        let err = f.call(method, json!({"id": id})).await.unwrap_err();
        assert_eq!(err.code, code::NOT_FOUND, "{method}");
        assert!(err.message.starts_with("no_worktree"), "{}", err.message);
    }
    let err = f
        .call(
            "agent.callPaths",
            with_group(&id, &sites[0].0, json!({"to": "branch"})),
        )
        .await
        .unwrap_err();
    assert_eq!(err.code, code::INVALID_PARAMS);
    assert!(err.message.starts_with("group_target: "), "{}", err.message);
}
