//! U468 backend observer; the App's selection and Toast observer belongs to #1497.
#[path = "e2e/daemon.rs"]
#[allow(dead_code)]
mod daemon;

use base64::{Engine, engine::general_purpose::STANDARD};
use serde_json::{Value, json};
use std::time::Duration;

const BOUND: Duration = Duration::from_secs(30);

async fn screen(client: &rpc::Client, terminal: &Value) -> String {
    let screen = client
        .request("terminal.screen", json!({"id":terminal}))
        .await
        .unwrap();
    screen["lines"]
        .as_array()
        .unwrap()
        .iter()
        .map(|line| line.as_str().unwrap())
        .collect::<Vec<_>>()
        .join("\n")
}

async fn write(client: &rpc::Client, terminal: &Value, bytes: &[u8]) {
    client
        .request(
            "terminal.write",
            json!({"id":terminal,"data":STANDARD.encode(bytes)}),
        )
        .await
        .unwrap();
}

async fn until_screen(
    client: &rpc::Client,
    terminal: &Value,
    pick: impl Fn(&str) -> bool,
) -> String {
    let mut last = String::new();
    tokio::time::timeout(BOUND, async {
        loop {
            last = screen(client, terminal).await;
            if pick(&last) {
                return last.clone();
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    })
    .await
    .unwrap_or_else(|_| panic!("Terminal did not reach the expected form state:\n{last}"))
}

#[tokio::test]
#[ignore = "native observer: send Return to the printed isolated Terminal when Accept is focused; see docs/evidence.md"]
async fn u468_real_claude_returns_the_terminal_answer_to_the_waiting_tool() {
    // The pnpm .bin shell keeps a wrapper PID. Run the pinned native executable
    // itself: the callback authenticates the primary program, never descendants.
    let vendor = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../node_modules/@anthropic-ai/claude-code/bin/claude.exe");
    let project = daemon::start_real(
        "u468_terminal_question",
        &[
            ("ROUNDUP_CLAUDE_BIN", vendor.to_str().unwrap()),
            ("TERM", "xterm-256color"),
        ],
    );
    let client = project.client().await;
    let child = client
        .request(
            "agent.spawn",
            json!({"cwd":project.dir.path(),"prompt":"U468 ask the user"}),
        )
        .await
        .unwrap();
    let terminal = &child["terminal_id"];
    client
        .request(
            "terminal.resize",
            json!({"id":terminal,"cols":120,"rows":40}),
        )
        .await
        .unwrap();
    until_screen(&client, terminal, |text| {
        text.contains("Cats or dogs?") && text.contains("Accept")
    })
    .await;
    write(&client, terminal, b"dogs").await;
    until_screen(&client, terminal, |text| text.contains("Answer: dogs")).await;
    write(&client, terminal, b"\x1b[B").await;
    until_screen(&client, terminal, |text| {
        text.lines()
            .any(|line| line.contains('❯') && line.contains("Note:"))
    })
    .await;
    write(&client, terminal, b"\x1b[B").await;
    until_screen(&client, terminal, |text| {
        text.lines()
            .any(|line| line.contains('❯') && line.contains("Accept"))
    })
    .await;
    eprintln!(
        "Native confirmation: socket={}, terminal={terminal}; send Return with terminal.write",
        project.socket().display()
    );
    let result = project
        .model
        .as_ref()
        .unwrap()
        .tool_result("toolu_u468_question")
        .await;
    let answer: Value = serde_json::from_str(result["content"].as_str().unwrap()).unwrap();
    assert_eq!(answer, json!({"answer":"dogs","note":""}));
    until_screen(&client, terminal, |text| {
        text.contains("U468 child resumed with dogs.")
    })
    .await;
    assert_eq!(
        client.request("decision.list", ()).await.unwrap(),
        json!([])
    );
}

struct Fixture {
    project: daemon::Project,
    client: rpc::Client,
    child: Value,
}

impl Fixture {
    async fn start() -> Self {
        let vendor =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/e2e/u468_claude.py");
        let project = daemon::start(&[("ROUNDUP_CLAUDE_BIN", vendor.to_str().unwrap())]);
        let client = project.client().await;
        let child = client
            .request(
                "agent.spawn",
                json!({"cwd":project.dir.path(),"prompt":"U468 fixture"}),
            )
            .await
            .unwrap();
        client
            .request(
                "terminal.resize",
                json!({"id":child["terminal_id"],"cols":120,"rows":80}),
            )
            .await
            .unwrap();
        let fixture = Self {
            project,
            client,
            child,
        };
        fixture.form(None).await;
        fixture
    }

    fn terminal(&self) -> &Value {
        &self.child["terminal_id"]
    }

    async fn form(&self, previous: Option<&str>) -> String {
        let mut found = String::new();
        tokio::time::timeout(BOUND, async {
            loop {
                let decisions = self.client.request("decision.list", ()).await.unwrap();
                if let Some(id) = decisions
                    .as_array()
                    .unwrap()
                    .first()
                    .and_then(|d| d["id"].as_str())
                    && previous != Some(id)
                {
                    found = id.to_owned();
                    let expected = format!("FORM READY {id}");
                    if screen(&self.client, self.terminal())
                        .await
                        .contains(&expected)
                    {
                        return;
                    }
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap_or_else(|_| panic!("no original form, last id={found}"));
        found
    }

    async fn type_answer(&self, text: &str, call: u64) -> Value {
        write(&self.client, self.terminal(), text.as_bytes()).await;
        until_screen(&self.client, self.terminal(), |screen| {
            screen.contains(&format!("INPUT {text}"))
        })
        .await;
        write(&self.client, self.terminal(), b"\r").await;
        self.returned(call).await
    }

    async fn returned(&self, call: u64) -> Value {
        until_screen(&self.client, self.terminal(), |text| {
            text.contains(&format!("RESUMED {call}"))
        })
        .await;
        serde_json::from_str(
            &std::fs::read_to_string(
                self.project
                    .dir
                    .path()
                    .join(format!("returned-{call}.json")),
            )
            .unwrap(),
        )
        .unwrap()
    }

    async fn history(&self) -> Value {
        self.client
            .request("decision.answers", json!({"agent":self.child["id"]}))
            .await
            .unwrap()
    }

    async fn probe(&self, id: &str, text: &str, command: u8, marker: &str) -> String {
        std::fs::write(
            self.project.dir.path().join("native-response.json"),
            json!({"id":id,"text":text,"note":""}).to_string(),
        )
        .unwrap();
        write(&self.client, self.terminal(), &[command]).await;
        until_screen(&self.client, self.terminal(), |text| text.contains(marker)).await
    }
}

fn tool_answer(result: &Value) -> Value {
    assert_ne!(result["isError"], true, "{result}");
    serde_json::from_str(result["content"][0]["text"].as_str().unwrap()).unwrap()
}

#[tokio::test]
async fn u468_a_child_question_is_answered_in_its_terminal() {
    let run = Fixture::start().await;
    let id = run.form(None).await;
    let before = run.client.request("rail.tree", ()).await.unwrap();
    assert_eq!(before[0]["status"]["kind"], "needs-you");
    assert!(
        screen(&run.client, run.terminal())
            .await
            .contains("Cats or dogs?")
    );
    let result = run.type_answer("dogs", 1).await;
    assert_eq!(tool_answer(&result), json!({"answer":"dogs","note":""}));
    assert_eq!(
        run.client.request("decision.list", ()).await.unwrap(),
        json!([])
    );
    let history = run.history().await;
    assert_eq!(history[0]["decision"]["id"], id);
    assert_eq!(
        history[0]["answered_by"],
        json!({"kind":"user","id":"you","parent":null})
    );
    let after = run.client.request("rail.tree", ()).await.unwrap();
    assert_ne!(after[0]["status"]["kind"], "needs-you");
}

#[tokio::test]
async fn u468_consecutive_questions_keep_each_terminal_answer() {
    let run = Fixture::start().await;
    let first = run.form(None).await;
    assert_eq!(
        tool_answer(&run.type_answer("cats", 1).await),
        json!({"answer":"cats","note":""})
    );
    write(&run.client, run.terminal(), &[2]).await;
    let second = run.form(Some(&first)).await;
    let text = run.probe(&first, "dogs", 1, "PROBE").await;
    assert!(text.contains("409") || text.contains("403"), "{text}");
    assert_eq!(
        run.client.request("decision.list", ()).await.unwrap()[0]["id"],
        second
    );
    assert_eq!(
        tool_answer(&run.type_answer("neither, thanks", 2).await),
        json!({"answer":null,"note":"neither, thanks"})
    );
    let history = run.history().await;
    assert_eq!(history.as_array().unwrap().len(), 2);
    assert_eq!(history[0]["answer"], "cats");
    assert_eq!(history[1]["note"], "neither, thanks");
}

#[tokio::test]
async fn u468_replaced_question_cannot_take_a_late_native_answer() {
    let run = Fixture::start().await;
    let first = run.form(None).await;
    write(&run.client, run.terminal(), &[2]).await;
    let second = run.form(Some(&first)).await;
    let result = run.returned(1).await;
    assert_eq!(result["isError"], true, "{result}");
    let text = run.probe(&first, "dogs", 1, "PROBE").await;
    assert!(
        text.contains("original Terminal question is unavailable"),
        "{text}"
    );
    assert_eq!(
        run.client.request("decision.list", ()).await.unwrap()[0]["id"],
        second
    );
    assert_eq!(
        tool_answer(&run.type_answer("dogs", 2).await),
        json!({"answer":"dogs","note":""})
    );
    assert_eq!(run.history().await.as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn u468_a_tool_subprocess_cannot_report_a_user_answer() {
    let run = Fixture::start().await;
    let id = run.form(None).await;
    let text = run.probe(&id, "dogs", 4, "SUBPROCESS").await;
    assert!(text.contains("only the live primary program"), "{text}");
    assert_eq!(
        run.client.request("decision.list", ()).await.unwrap()[0]["id"],
        id
    );
    assert_eq!(
        tool_answer(&run.type_answer("cats", 1).await),
        json!({"answer":"cats","note":""})
    );
}

#[tokio::test]
async fn u468_dismissing_the_native_form_refuses_without_an_answer() {
    let run = Fixture::start().await;
    write(&run.client, run.terminal(), &[27]).await;
    let result = run.returned(1).await;
    assert_eq!(result["isError"], true, "{result}");
    assert_eq!(run.history().await, json!([]));
    assert_eq!(
        run.client.request("decision.list", ()).await.unwrap(),
        json!([])
    );
}

impl Fixture {
    async fn door(&self) -> Value {
        let workstream = self
            .client
            .request("rail.createWorkstream", json!({"name":"Supervisor"}))
            .await
            .unwrap();
        let door = self
            .client
            .request("rail.startDoor", json!({"id":workstream["id"]}))
            .await
            .unwrap();
        until_screen(&self.client, &door["terminal_id"], |text| {
            text.contains("READY")
        })
        .await;
        self.client
            .request(
                "rail.move",
                json!({"id":self.child["id"],"parent":door["id"],"index":0}),
            )
            .await
            .unwrap();
        door
    }

    async fn door_answer(&self, door: &Value, id: &str, answer: &str) -> Value {
        std::fs::write(
            self.project.dir.path().join("door-answer.json"),
            json!({"id":id,"answer":answer}).to_string(),
        )
        .unwrap();
        write(&self.client, &door["terminal_id"], &[5]).await;
        until_screen(&self.client, &door["terminal_id"], |text| {
            text.contains("RETURN door-answer")
        })
        .await;
        serde_json::from_str(
            &std::fs::read_to_string(self.project.dir.path().join("returned-door-answer.json"))
                .unwrap(),
        )
        .unwrap()
    }
}

#[tokio::test]
async fn u468_a_door_direct_answer_still_resumes_a_native_question() {
    let run = Fixture::start().await;
    let id = run.form(None).await;
    let door = run.door().await;
    let response = run.door_answer(&door, &id, "dogs").await;
    assert_ne!(response["isError"], true, "{response}");
    assert_eq!(
        tool_answer(&run.returned(1).await),
        json!({"answer":"dogs","note":""})
    );
    let history = run.history().await;
    assert_eq!(history[0]["answered_by"]["kind"], "agent");
    assert_eq!(history[0]["answered_by"]["id"], door["id"]);
}

#[tokio::test]
async fn u468_takeover_keeps_the_native_question_for_the_user() {
    let run = Fixture::start().await;
    let id = run.form(None).await;
    let door = run.door().await;
    run.client
        .request("takeover.begin", json!({"agent":run.child["id"]}))
        .await
        .unwrap();
    let response = run.door_answer(&door, &id, "dogs").await;
    assert_ne!(response["isError"], true, "{response}");
    assert!(response.to_string().contains("takeover"), "{response}");
    assert_eq!(
        run.client.request("decision.list", ()).await.unwrap()[0]["id"],
        id
    );
    assert_eq!(
        tool_answer(&run.type_answer("cats", 1).await),
        json!({"answer":"cats","note":""})
    );
    assert_eq!(run.history().await[0]["answered_by"]["kind"], "user");
}

#[tokio::test]
async fn u468_a_child_cannot_claim_user_to_answer_its_own_question() {
    let run = Fixture::start().await;
    let id = run.form(None).await;
    for (index, (method, params)) in [
        (
            "decision.answer",
            json!({"id":id,"answer":"dogs","proof":"0".repeat(64)}),
        ),
        (
            "terminal.write",
            json!({"id":run.terminal(),"data":STANDARD.encode(b"dogs\r")}),
        ),
    ]
    .into_iter()
    .enumerate()
    {
        std::fs::write(
            run.project.dir.path().join("peer-call.json"),
            json!([method, params]).to_string(),
        )
        .unwrap();
        write(&run.client, run.terminal(), &[6]).await;
        // Count a completed peer reply before sending the next probe.
        let text = until_screen(&run.client, run.terminal(), |text| {
            text.matches("PEER ").count() == index + 1
        })
        .await;
        assert!(
            text.lines()
                .rfind(|line| line.starts_with("PEER "))
                .unwrap()
                .contains("-32002"),
            "{text}"
        );
        assert_eq!(
            run.client.request("decision.list", ()).await.unwrap()[0]["id"],
            id
        );
    }
    assert_eq!(
        tool_answer(&run.type_answer("cats", 1).await),
        json!({"answer":"cats","note":""})
    );
    assert_eq!(run.history().await[0]["answered_by"]["kind"], "user");
}
