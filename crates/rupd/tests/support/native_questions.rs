use super::*;

/// One fake Agent of A3564c, with the files its own `claude` keeps.
struct Peer {
    id: String,
    terminal: Value,
    attempt: Value,
    dir: PathBuf,
    client: Client,
}

impl Peer {
    fn entries(&self) -> Vec<Value> {
        let text = std::fs::read_to_string(self.dir.join("received.jsonl")).unwrap_or_default();
        text.lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect()
    }

    fn typed(&self) -> usize {
        std::fs::metadata(self.dir.join("typed.bin")).map_or(0, |m| m.len() as usize)
    }

    /// Its transcript records `id` the way Claude Code does, then it signals.
    async fn record(&self, run: &Run, id: u32) {
        use std::io::Write;
        let transcript = self.dir.join("transcript.jsonl");
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&transcript)
            .unwrap();
        writeln!(
            file,
            "{}",
            json!({"type":"user","origin":{"kind":"peer","from":"uds:/rup/rupd","msg_id":format!("00000000-0000-4000-8000-{id:012x}")}})
        )
        .unwrap();
        run.user
            .request(
                "agent.signal",
                json!({"id":self.id,"attempt":self.attempt,"payload":{
                    "hook_event_name":"PostToolUse","tool_name":"Bash","transcript_path":transcript}}),
            )
            .await
            .unwrap();
    }
}

async fn peer(run: &Run, name: &str) -> Peer {
    let node = run
        .user
        .request("agent.spawn", json!({"name":name,"cwd":run.dir.path()}))
        .await
        .unwrap();
    let id = node["id"].as_str().unwrap().to_owned();
    let dir = run.dir.path().join(&id);
    until("the fake claude is ready", async || {
        let screen = run
            .user
            .request("terminal.read", json!({"id":node["terminal_id"],"after":0}))
            .await
            .unwrap();
        screen["text"]
            .as_str()
            .unwrap()
            .contains("READY")
            .then_some(())
    })
    .await;
    let client = Client::connect(&run.daemon.socket).await.unwrap();
    client
        .request("daemon.identify", json!({"actor":{"kind":"agent","id":id}}))
        .await
        .unwrap();
    Peer {
        id,
        terminal: node["terminal_id"].clone(),
        attempt: node["attempt"].clone(),
        dir,
        client,
    }
}

// A3564c: a question and its reply are ordinary Messages through each Agent's inbox.
#[tokio::test]
async fn a3564c_two_agents_exchange_a_question_and_reply_without_a_view() {
    let mut run = Run::open(1, false).await;
    std::fs::write(run.dir.path().join("per-agent"), "").unwrap();
    let asker = peer(&run, "asker").await;
    let answerer = peer(&run, "answerer").await;
    // The Daemon types each Agent's start-up context first; count from where that ends.
    let mut settled = (usize::MAX, usize::MAX);
    while settled != (asker.typed(), answerer.typed()) {
        settled = (asker.typed(), answerer.typed());
        tokio::time::sleep(Duration::from_millis(400)).await;
    }
    let _ = run.seen().await;

    let question = "Which branch holds the fix?";
    let sent = asker
        .client
        .request(
            "message.send",
            json!({"to":answerer.id,"kind":"question","body":question}),
        )
        .await
        .unwrap();
    let asked = u32::try_from(sent["id"].as_u64().unwrap()).unwrap();
    until("the question entry", async || {
        (!answerer.entries().is_empty()).then_some(())
    })
    .await;
    let content = answerer.entries()[0]["message"]["content"]
        .as_str()
        .unwrap()
        .to_owned();
    assert!(
        content.contains(&format!("[question, replyTo: {asked}] {question}\n")),
        "{content}"
    );
    assert!(content.contains("from-name=\"asker\""), "{content}");
    answerer.record(&run, asked).await;
    until("the question receipt", async || {
        (run.status(asked).await.0 == "delivered").then_some(())
    })
    .await;

    let reply = "The fix is on release-2.";
    let sent = answerer
        .client
        .request(
            "message.send",
            json!({"to":asker.id,"kind":"note","body":reply,"replyTo":asked}),
        )
        .await
        .unwrap();
    let replied = u32::try_from(sent["id"].as_u64().unwrap()).unwrap();
    until("the reply entry", async || {
        (!asker.entries().is_empty()).then_some(())
    })
    .await;
    let content = asker.entries()[0]["message"]["content"]
        .as_str()
        .unwrap()
        .to_owned();
    assert!(
        content.contains(&format!(
            "from-name=\"answerer\" from-mode=\"default\">\n{reply}\n"
        )),
        "{content}"
    );
    asker.record(&run, replied).await;
    until("the reply receipt", async || {
        (run.status(replied).await.0 == "delivered").then_some(())
    })
    .await;

    // Idle edges replay on both Agents: nothing is forwarded, passed up or sent to the user.
    for peer in [&asker, &answerer] {
        for _ in 0..3 {
            for event in ["PreToolUse", "Stop"] {
                run.user
                    .request(
                        "agent.signal",
                        json!({"id":peer.id,"attempt":peer.attempt,"payload":{"hook_event_name":event,"tool_name":"Bash"}}),
                    )
                    .await
                    .unwrap();
            }
        }
    }
    let all = run.user.request("message.list", json!({})).await.unwrap();
    let all = all.as_array().unwrap();
    assert_eq!(all.len(), 2, "{all:?}");
    assert_eq!(all[0]["id"], asked);
    assert_eq!(all[0]["from"]["id"], asker.id.as_str());
    assert_eq!(all[0]["to"], answerer.id.as_str());
    assert_eq!(all[0]["kind"], "question");
    assert_eq!(all[0]["body"], question);
    assert_eq!(all[1]["id"], replied);
    assert_eq!(all[1]["from"]["id"], answerer.id.as_str());
    assert_eq!(all[1]["to"], asker.id.as_str());
    assert_eq!(all[1]["replyTo"], asked);
    assert_eq!(all[1]["status"], "delivered");
    assert_eq!(asker.entries().len(), 1);
    assert_eq!(answerer.entries().len(), 1);
    assert_eq!(
        (asker.typed(), answerer.typed()),
        settled,
        "a Terminal was typed into"
    );
    assert_eq!(run.seen().await, [asked, replied]);
}

impl Peer {
    /// Claude Code shows its native prompt for `tool`: the `PermissionRequest` hook fires.
    async fn prompts(&self, run: &Run, tool: &str) {
        run.user
            .request(
                "agent.signal",
                json!({"id":self.id,"attempt":self.attempt,"payload":{
                    "hook_event_name":"PermissionRequest","tool_name":tool}}),
            )
            .await
            .unwrap();
    }

    async fn write(&self, client: &Client, bytes: &str) -> Result<Value, rpc::RpcError> {
        use base64::Engine;
        client
            .request(
                "terminal.write",
                json!({"id":self.terminal,"data":base64::engine::general_purpose::STANDARD.encode(bytes)}),
            )
            .await
    }
}

async fn waiting_peer(tool: &str) -> (Run, Peer, usize) {
    let run = Run::open(1, false).await;
    std::fs::write(run.dir.path().join("per-agent"), "").unwrap();
    let peer = peer(&run, "waiter").await;
    let mut settled = usize::MAX;
    while settled != peer.typed() {
        settled = peer.typed();
        tokio::time::sleep(Duration::from_millis(400)).await;
    }
    peer.prompts(&run, tool).await;
    until("the Agent needs the user", async || {
        let node = run.user.request("rail.tree", json!({})).await.unwrap();
        node.as_array()
            .unwrap()
            .iter()
            .any(|n| n["id"] == peer.id.as_str() && n["status"]["kind"] == "needs-you")
            .then_some(())
    })
    .await;
    (run, peer, settled)
}

// A3564a: the Agent that asks natively keeps its question in its own Terminal; roundup types
// nothing, and the user's typing reaches it.
#[tokio::test]
async fn a3564a_native_question_uses_only_the_requesting_terminal() {
    let (run, peer, typed) = waiting_peer("AskUserQuestion").await;
    assert_eq!(
        peer.typed(),
        typed,
        "roundup typed into the asking Terminal"
    );
    assert!(
        run.user
            .request("message.list", json!({}))
            .await
            .unwrap()
            .as_array()
            .unwrap()
            .is_empty(),
        "a question record or Message exists"
    );
    // The user answers with the vendor control; the answer reaches only that Terminal.
    peer.write(&run.user, "1").await.unwrap();
    until("the answer reaches the Terminal", async || {
        (peer.typed() > typed).then_some(())
    })
    .await;
    // The vendor continues: the next ordinary observation leaves needs-you with no record.
    run.user
        .request(
            "agent.signal",
            json!({"id":peer.id,"attempt":peer.attempt,"payload":{"hook_event_name":"PostToolUse","tool_name":"AskUserQuestion"}}),
        )
        .await
        .unwrap();
    until("the Agent works again", async || {
        let tree = run.user.request("rail.tree", json!({})).await.unwrap();
        tree.as_array()
            .unwrap()
            .iter()
            .any(|n| n["id"] == peer.id.as_str() && n["status"]["kind"] != "needs-you")
            .then_some(())
    })
    .await;
}

// A3564a: while a native prompt waits, an Agent's write is refused with zero bytes; the user's
// reaches the Terminal.
#[tokio::test]
async fn a3564a_native_prompt_accepts_only_user_input() {
    let (run, peer, typed) = waiting_peer("Bash").await;
    let refused = peer.write(&peer.client, "y\n").await.unwrap_err();
    assert_eq!(refused.code, rpc::code::FORBIDDEN, "{refused:?}");
    tokio::time::sleep(Duration::from_millis(600)).await;
    assert_eq!(peer.typed(), typed, "an Agent's bytes reached the prompt");
    peer.write(&run.user, "y").await.unwrap();
    until("the user's input reaches it", async || {
        (peer.typed() > typed).then_some(())
    })
    .await;
}
