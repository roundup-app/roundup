use super::*;

#[tokio::test]
async fn dv1_publication_identity() {
    let mut projects = Vec::new();
    let mut all = Vec::new();
    for _ in 0..2 {
        let p = common::Served::start("#!/bin/sh\nexit 0\n", &[]).await;
        let c = rpc::Client::connect(&p.socket()).await.unwrap();
        let home = call(&c, "rail.createWorkstream", json!({"name":"Maker"})).await["id"].clone();
        call(
            &c,
            "daemon.identify",
            json!({"actor":{"kind":"agent","id":home,"parent":null}}),
        )
        .await;
        pad(&c, "notes", "revision one").await;
        std::fs::write(p.dir.path().join("result.txt"), "retained file").unwrap();
        let mut records = Vec::new();
        for (key, target) in [
            ("pad", pad_target(&c, "notes", 1).await),
            ("file", json!({"kind":"file","path":"result.txt"})),
            (
                "external",
                json!({"kind":"external","url":"https://example.com/pr/1"}),
            ),
        ] {
            let request = json!({"key":key,"title":"Result","target":target});
            let r = call(&c, "deliverable.publish", request.clone()).await;
            assert_eq!(r["maker"]["id"], home);
            assert_eq!(r["maker_name"], "Maker");
            assert_eq!(r["home"], home);
            assert_eq!(r["title"], "Result");
            assert_eq!(r["target"]["kind"], key);
            if key == "file" {
                assert_eq!(r["target"]["length"], 13);
                assert_eq!(
                    r["target"]["sha256"],
                    "c18472670a3f225d4bb83d2fd240712de2239e05650fa8723597cb7a0f6e2592"
                );
            }
            assert_eq!(call(&c, "deliverable.publish", request).await, r);
            assert!(
                !records
                    .iter()
                    .any(|previous: &Value| previous["id"] == r["id"])
            );
            records.push(r);
        }
        assert_eq!(list_all(&c).await, json!(records));
        all.push(records);
        projects.push(p);
    }
    assert_ne!(all[0][0]["project"], all[1][0]["project"]);
    let c = rpc::Client::connect(&projects[0].socket()).await.unwrap();
    for r in &all[1] {
        for method in ["deliverable.get", "deliverable.resolve"] {
            refused(&c, method, identity(r)).await;
            refused(
                &c,
                method,
                json!({"project":all[0][0]["project"],"id":r["id"]}),
            )
            .await;
        }
    }
}

#[tokio::test]
async fn dv1_publication_authority() {
    let a = common::Served::start("#!/bin/sh\nexit 0\n", &[]).await;
    let c = rpc::Client::connect(&a.socket()).await.unwrap();
    std::fs::write(a.dir.path().join("result.txt"), "F1").unwrap();
    let file =
        json!({"key":"file-1","title":"Result","target":{"kind":"file","path":"result.txt"}});
    let p = call(&c, "deliverable.publish", file.clone()).await;
    std::fs::write(a.dir.path().join("result.txt"), "F2").unwrap();
    let r = call(&c, "deliverable.resolve", identity(&p)).await;
    assert_eq!(std::fs::read(r["path"].as_str().unwrap()).unwrap(), b"F1");
    assert_eq!(call(&c, "deliverable.publish", file).await, p);
    let outside = tempfile::tempdir().unwrap();
    std::fs::write(outside.path().join("secret"), "protected").unwrap();
    std::os::unix::fs::symlink(outside.path(), a.dir.path().join("escape")).unwrap();
    std::os::unix::fs::symlink(
        a.dir.path().join(".roundup"),
        a.dir.path().join("internal-escape"),
    )
    .unwrap();
    std::os::unix::fs::symlink(
        a.dir.path().join(".roundup/project.db"),
        a.dir.path().join("internal-file"),
    )
    .unwrap();
    std::fs::write(a.dir.path().join("unreadable"), "protected").unwrap();
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(
        a.dir.path().join("unreadable"),
        std::fs::Permissions::from_mode(0o0),
    )
    .unwrap();
    for path in [
        "../secret",
        "escape/secret",
        "internal-escape/project.db",
        "internal-file",
        "unreadable",
        "escape",
        ".roundup/project.db",
        "/etc/passwd",
    ] {
        assert!(
            c.request(
                "deliverable.publish",
                json!({"key":path,"title":"forbidden","target":{"kind":"file","path":path}})
            )
            .await
            .is_err(),
            "{path}"
        );
    }
    refused(&c,"deliverable.publish",json!({"key":"spoof","title":"spoof","maker":{"kind":"agent","id":"other"},"target":{"kind":"external","url":"https://example.com"}})).await;
    assert_eq!(list_all(&c).await.as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn dv1_only_explicit_publication() {
    let a = common::Served::start("#!/bin/sh\nexit 0\n", &[]).await;
    let c = rpc::Client::connect(&a.socket()).await.unwrap();
    std::fs::write(a.dir.path().join("scratch.md"), "scratch").unwrap();
    pad(&c, "scratch", "unpublished").await;
    call(
        &c,
        "pad.write",
        json!({"name":"scratch","text":"still unpublished"}),
    )
    .await;
    let t = call(&c, "todo.create", json!({"title":"scratch"})).await;
    call(&c, "todo.complete", json!({"id":t["id"]})).await;
    let terminal=call(&c,"terminal.spawn",json!({"cwd":a.dir.path(),"command":["/bin/sh","-c","printf 'unpublished result'"],"env":{},"cols":80,"rows":24})).await;
    tokio::time::timeout(std::time::Duration::from_secs(10), async {
        loop {
            let output = call(&c, "terminal.read", json!({"id":terminal["id"],"after":0})).await;
            if output["text"]
                .as_str()
                .unwrap()
                .contains("unpublished result")
            {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }
    })
    .await
    .expect("Terminal emitted its unregistered output");
    assert_eq!(list_all(&c).await, json!([]));
    call(
        &c,
        "deliverable.publish",
        json!({"key":"deliberate","title":"Result","target":pad_target(&c,"scratch",2).await}),
    )
    .await;
    assert_eq!(list_all(&c).await.as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn dv1_public_cli_mcp() {
    use rmcp::ServiceExt;
    use std::process::Stdio;
    use tokio::process::Command;
    let p = daemon::start(&[]);
    let home = p
        .client()
        .await
        .request("rail.createWorkstream", json!({"name":"Reader"}))
        .await
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let output = Command::new(env!("CARGO_BIN_EXE_rup"))
        .args([
            "--json",
            "--agent",
            &home,
            "deliverable",
            "publish",
            "cli",
            "Result",
            "--target",
            r#"{"kind":"external","url":"https://example.com/pr/42"}"#,
        ])
        .env("RUPD_SOCKET", p.socket())
        .env_remove("ROUNDUP_AGENT")
        .output()
        .await
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let published: Value = serde_json::from_slice(&output.stdout).unwrap();
    let mut command = Command::new(env!("CARGO_BIN_EXE_rup"));
    command
        .args(["mcp", &home])
        .env("RUPD_SOCKET", p.socket())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    let mut child = command.spawn().unwrap();
    let transport = (child.stdout.take().unwrap(), child.stdin.take().unwrap());
    let client = ().serve(transport).await.unwrap();
    let tools = client.list_all_tools().await.unwrap();
    for name in [
        "deliverable_publish",
        "deliverable_list",
        "deliverable_get",
        "deliverable_resolve",
        "deliverable_move",
        "deliverable_remove",
    ] {
        assert!(tools.iter().any(|t| t.name == name));
    }
    // The public reader must preserve the Project/id pair received from the CLI writer.
    let request = rmcp::model::CallToolRequestParams::new("deliverable_resolve")
        .with_arguments(identity(&published).as_object().unwrap().clone());
    let result = client.call_tool(request).await.unwrap();
    assert!(!result.is_error.unwrap_or(false));
    let value: Value = serde_json::from_str(&result.content[0].as_text().unwrap().text).unwrap();
    assert_eq!(
        value,
        json!({"kind":"external","url":"https://example.com/pr/42","availability":"not-checked"})
    );
    client.cancel().await.unwrap();
    child.kill().await.unwrap();
    child.wait().await.unwrap();
}

#[tokio::test]
async fn dv1_stale_pad_source_cannot_publish_replacement() {
    let p = daemon::start(&[]);
    let c = p.client().await;
    pad(&c, "notes", "original").await;
    let target = pad_target(&c, "notes", 1).await;
    call(
        &c,
        "deliverable.publish",
        json!({"key":"original","title":"Original","target":target}),
    )
    .await;
    call(&c, "pad.delete", json!({"name":"notes"})).await;
    pad(&c, "notes", "replacement").await;
    refused(
        &c,
        "deliverable.publish",
        json!({"key":"stale-input","title":"Original","target":target}),
    )
    .await;
    assert_eq!(list_all(&c).await.as_array().unwrap().len(), 1);
}
