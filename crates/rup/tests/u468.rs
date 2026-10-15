//! U468 backend observer; the App's selection and Toast observer belongs to #1497.
#[path = "e2e/daemon.rs"]
#[allow(dead_code)]
mod daemon;

use base64::{Engine, engine::general_purpose::STANDARD};
use serde_json::{Value, json};
use std::time::Duration;

const BOUND: Duration = Duration::from_secs(30);

async fn screen(client: &rpc::Client, terminal: &Value) -> String {
    client
        .request("terminal.read", json!({"id":terminal,"after":0}))
        .await
        .unwrap()["text"]
        .as_str()
        .unwrap()
        .to_owned()
}

#[tokio::test]
async fn u468_real_claude_returns_the_terminal_answer_to_the_waiting_tool() {
    let project = daemon::start_real("u468_terminal_question", &[]);
    let client = project.client().await;
    let child = client
        .request(
            "agent.spawn",
            json!({"cwd":project.dir.path(),"prompt":"U468 ask the user"}),
        )
        .await
        .unwrap();
    let terminal = &child["terminal_id"];
    tokio::time::timeout(BOUND, async {
        loop {
            let text = screen(&client, terminal).await;
            if text.contains("Cats or dogs?") && text.contains("Submit") {
                break;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    })
    .await
    .unwrap_or_else(|_| panic!("no native question form"));
    client
        .request(
            "terminal.write",
            json!({"id":terminal,"data":STANDARD.encode(b"\x1b[B\r")}),
        )
        .await
        .unwrap();
    let result = project
        .model
        .as_ref()
        .unwrap()
        .tool_result("toolu_u468_question")
        .await;
    assert!(result.to_string().contains("dogs"), "{result}");
    assert_eq!(
        client.request("decision.list", ()).await.unwrap(),
        json!([])
    );
}
