//! A3308: a supervisor answers Auto through the public MCP and schema-derived CLI.
#[path = "common/served.rs"]
mod common;

use std::process::Stdio;
use std::time::Duration;

use rmcp::ServiceExt;
use rmcp::model::CallToolRequestParams;
use serde_json::{Value, json};

struct Auto {
    served: common::Served,
    user: rpc::Client,
    door: Value,
    owner: Value,
    todo: Value,
    change: Value,
}

impl Auto {
    async fn start() -> Self {
        let served = common::Served::start("#!/bin/sh\nwhile read line; do :; done\n", &[]).await;
        let user = rpc::Client::connect(&served.socket()).await.unwrap();
        let door = user
            .request("rail.createWorkstream", json!({"name":"Ship"}))
            .await
            .unwrap()["id"]
            .clone();
        user.request("rail.startDoor", json!({"id":door}))
            .await
            .unwrap();
        let child = user
            .request(
                "agent.spawn",
                json!({"cwd":served.dir.path(),"parent":door}),
            )
            .await
            .unwrap();
        let owner = json!({"kind":"agent","id":child["id"],"parent":null});
        let todo = user
            .request(
                "todo.create",
                json!({"title":"Ship the fix","estimate_minutes":45}),
            )
            .await
            .unwrap();
        user.request("todo.move", json!({"id":todo["id"],"home":door}))
            .await
            .unwrap();
        user.request("workstream.setAuto", json!({"id":door,"auto":true}))
            .await
            .unwrap();
        let messages = user
            .request("message.list", json!({"to":door}))
            .await
            .unwrap();
        assert!(
            messages.as_array().unwrap().iter().any(|message| {
                message["body"].as_str().unwrap().contains("Ship the fix")
                    && message["body"].as_str().unwrap().starts_with("[auto ")
            }),
            "{messages}"
        );
        let history = user
            .request("todo.getHistory", json!({"id":todo["id"]}))
            .await
            .unwrap();
        let change = history["changes"].as_array().unwrap().last().unwrap()["seq"].clone();
        Self {
            served,
            user,
            door,
            owner,
            todo,
            change,
        }
    }

    fn command(&self) -> tokio::process::Command {
        let mut command = tokio::process::Command::new(env!("CARGO_BIN_EXE_rup"));
        command
            .env("RUPD_SOCKET", self.served.socket())
            .env("ROUNDUP_AGENT", self.door.as_str().unwrap())
            .kill_on_drop(true);
        command
    }

    async fn assigned_by_supervisor(&self) {
        let todo = self
            .user
            .request("todo.get", json!({"id":self.todo["id"]}))
            .await
            .unwrap();
        assert_eq!(todo["owner"], self.owner);
        let history = self
            .user
            .request("todo.getHistory", json!({"id":self.todo["id"]}))
            .await
            .unwrap();
        let changes = history["changes"].as_array().unwrap();
        let change = changes.last().unwrap();
        assert_eq!(
            change["actor"],
            json!({"kind":"agent","id":self.door,"parent":null})
        );
        assert_eq!(change["before"]["owner"], Value::Null);
        assert_eq!(change["after"]["owner"], self.owner);
    }
}

#[tokio::test]
async fn a3308_authenticated_supervisor_assigns_over_public_mcp() {
    let auto = Auto::start().await;
    let mut child = auto
        .command()
        .args(["mcp", auto.door.as_str().unwrap()])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let transport = (child.stdout.take().unwrap(), child.stdin.take().unwrap());
    let client = tokio::time::timeout(Duration::from_secs(20), ().serve(transport))
        .await
        .unwrap()
        .unwrap();
    let request = CallToolRequestParams::new("todo_assign").with_arguments(
        json!({"id":auto.todo["id"],"owner":auto.owner,"expected_change":auto.change})
            .as_object()
            .unwrap()
            .clone(),
    );
    let result = client.call_tool(request).await.unwrap();
    assert_ne!(result.is_error, Some(true), "{result:?}");
    auto.assigned_by_supervisor().await;
    client.cancel().await.unwrap();
    child.wait().await.unwrap();
}

#[tokio::test]
async fn a3308_schema_derived_cli_assigns_as_the_supervisor() {
    let auto = Auto::start().await;
    let output = auto
        .command()
        .args([
            "todo",
            "assign",
            &auto.todo["id"].to_string(),
            "--owner",
            &auto.owner.to_string(),
            "--expected-change",
            &auto.change.to_string(),
            "--json",
        ])
        .output()
        .await
        .unwrap();
    assert!(output.status.success(), "{output:?}");
    let assigned: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(assigned["owner"], auto.owner);
    auto.assigned_by_supervisor().await;
}
