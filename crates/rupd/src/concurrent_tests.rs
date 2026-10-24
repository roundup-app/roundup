use super::*;
use std::time::Duration;
use tokio::sync::Semaphore;

struct Lifetime(mpsc::UnboundedSender<String>, String);
impl Drop for Lifetime {
    fn drop(&mut self) {
        let _ = self.0.send(format!("dropped:{}", self.1));
    }
}

struct Parked {
    entered: mpsc::UnboundedSender<String>,
    release: Arc<Semaphore>,
}

#[async_trait::async_trait]
impl Module for Parked {
    fn namespaces(&self) -> &'static [&'static str] {
        &["agent"]
    }
    async fn call(&self, ctx: &Ctx, method: &str, _: Value) -> Result<Value, RpcError> {
        self.entered.send(method.into()).unwrap();
        let _lifetime = Lifetime(self.entered.clone(), method.to_owned());
        if method != "agent.setOrder" {
            let permit = self.release.acquire().await.unwrap();
            permit.forget();
        }
        ctx.touch(contracts::Verb::Wrote, "agent:fixture")?;
        ctx.emit(contracts::EventData::RailChanged);
        Ok(json!({"actor": ctx.actor.id, "method": method}))
    }
}

async fn fixture() -> (
    tempfile::TempDir,
    UnixStream,
    mpsc::UnboundedReceiver<String>,
    Arc<Semaphore>,
) {
    let dir = tempfile::tempdir().unwrap();
    let mut daemon = Daemon::open(dir.path()).unwrap();
    let (entered, entries) = mpsc::unbounded_channel();
    let release = Arc::new(Semaphore::new(0));
    daemon.register(Arc::new(Parked {
        entered,
        release: release.clone(),
    }));
    let socket = dir.path().join("test.sock");
    tokio::spawn(serve(
        UnixListener::bind(&socket).unwrap(),
        Arc::new(daemon),
    ));
    let stream = UnixStream::connect(socket).await.unwrap();
    (dir, stream, entries, release)
}

async fn send(write: &mut tokio::net::unix::OwnedWriteHalf, id: Value, method: &str) {
    // Stop's router exclusion needs its target even when the recording Module holds it.
    let params = if method == "agent.stop" {
        json!({"id":"fixture"})
    } else {
        Value::Null
    };
    let mut bytes =
        serde_json::to_vec(&json!({"jsonrpc":"2.0", "id":id, "method":method, "params":params}))
            .unwrap();
    bytes.push(b'\n');
    write.write_all(&bytes).await.unwrap();
}

async fn entry(entries: &mut mpsc::UnboundedReceiver<String>) -> String {
    tokio::time::timeout(Duration::from_secs(1), entries.recv())
        .await
        .expect("recording Module did not acknowledge entry")
        .unwrap()
}

async fn reply(read: &mut tokio::io::Lines<BufReader<tokio::net::unix::OwnedReadHalf>>) -> Value {
    let line = tokio::time::timeout(Duration::from_secs(1), read.next_line())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    serde_json::from_str(&line).unwrap()
}

#[tokio::test]
async fn d9_a_parked_call_does_not_hold_the_next_reply() {
    let (_dir, stream, mut entries, release) = fixture().await;
    let (read, mut write) = stream.into_split();
    let mut read = BufReader::new(read).lines();
    send(&mut write, json!("parked"), "agent.stop").await;
    assert_eq!(entry(&mut entries).await, "agent.stop");
    send(&mut write, json!(2), "rail.tree").await;
    let tree = reply(&mut read).await;
    assert_eq!(tree, json!({"jsonrpc":"2.0", "id":2, "result":[]}));
    release.add_permits(1);
    let parked = reply(&mut read).await;
    assert_eq!(
        parked,
        json!({"jsonrpc":"2.0", "id":"parked", "result":{"actor":"you", "method":"agent.stop"}})
    );
}

#[tokio::test]
async fn d9_half_close_keeps_ordinary_calls_alive() {
    let (_dir, stream, mut entries, release) = fixture().await;
    let (read, mut write) = stream.into_split();
    let mut read = BufReader::new(read).lines();
    send(&mut write, json!(1), "agent.stop").await;
    entry(&mut entries).await;
    write.shutdown().await.unwrap();
    assert!(
        tokio::time::timeout(Duration::from_secs(1), entries.recv())
            .await
            .is_err(),
        "ordinary call remains alive after EOF"
    );
    release.add_permits(1);
    assert_eq!(reply(&mut read).await["result"]["method"], "agent.stop");
}

async fn frame(write: &mut tokio::net::unix::OwnedWriteHalf, value: Value) {
    let mut bytes = serde_json::to_vec(&value).unwrap();
    bytes.push(b'\n');
    write.write_all(&bytes).await.unwrap();
}

#[tokio::test]
async fn d9_replies_events_and_notifications_keep_their_envelopes() {
    let (_dir, stream, mut entries, release) = fixture().await;
    let (read, mut write) = stream.into_split();
    let mut read = BufReader::new(read).lines();
    send(&mut write, json!(0), "events.subscribe").await;
    assert_eq!(reply(&mut read).await["id"], 0);
    send(&mut write, json!("parked"), "agent.stop").await;
    entry(&mut entries).await;
    frame(
        &mut write,
        json!({"jsonrpc":"2.0", "method":"agent.setOrder"}),
    )
    .await;
    send(&mut write, json!(2), "rail.tree").await;
    let mut tree = None;
    let mut events = 0;
    while tree.is_none() || events == 0 {
        let value = reply(&mut read).await;
        assert_eq!(value["jsonrpc"], "2.0");
        if value["method"] == "event" {
            assert!(value.get("id").is_none());
            events += 1;
        } else {
            assert_eq!(value["id"], 2);
            assert_eq!(value["result"], json!([]));
            tree = Some(value);
        }
    }
    release.add_permits(1);
    let mut parked = None;
    while parked.is_none() || events < 2 {
        let value = reply(&mut read).await;
        if value["method"] == "event" {
            events += 1;
        } else {
            assert_eq!(value["id"], "parked");
            assert_eq!(value["result"]["method"], "agent.stop");
            parked = Some(value);
        }
    }
    write.shutdown().await.unwrap();
    assert_eq!(
        tokio::time::timeout(Duration::from_secs(1), read.next_line())
            .await
            .unwrap()
            .unwrap(),
        None
    );
}

#[tokio::test]
async fn d9_connection_state_changes_precede_later_requests() {
    let (_dir, stream, mut entries, release) = fixture().await;
    let (read, mut write) = stream.into_split();
    let mut read = BufReader::new(read).lines();
    frame(&mut write, json!({"method":"daemon.identify", "params":{"actor":{"kind":"user","id":"first","parent":null}}})).await;
    frame(&mut write, json!({"method":"events.subscribe"})).await;
    send(&mut write, json!(1), "agent.stop").await;
    assert_eq!(entry(&mut entries).await, "agent.stop");
    frame(&mut write, json!({"method":"daemon.identify", "params":{"actor":{"kind":"user","id":"second","parent":null}}})).await;
    frame(
        &mut write,
        json!({"method":"daemon.identify", "params":{"actor":{"kind":"invalid","id":"bad"}}}),
    )
    .await;
    send(&mut write, json!(2), "agent.setOrder").await;
    let mut second_reply = false;
    let mut second_event = false;
    while !second_reply || !second_event {
        let value = reply(&mut read).await;
        if value["method"] == "event" {
            assert_eq!(value["params"]["actor"]["id"], "second");
            second_event = true;
        } else {
            assert_eq!(value["id"], 2);
            assert_eq!(value["result"]["actor"], "second");
            second_reply = true;
        }
    }
    release.add_permits(1);
    let mut first_reply = false;
    let mut first_event = false;
    while !first_reply || !first_event {
        let value = reply(&mut read).await;
        if value["method"] == "event" {
            assert_eq!(value["params"]["actor"]["id"], "first");
            first_event = true;
        } else {
            assert_eq!(value["id"], 1);
            assert_eq!(value["result"]["actor"], "first");
            first_reply = true;
        }
    }
    frame(
        &mut write,
        json!({"id":3, "method":"provenance.history", "params":{"item":"agent:fixture"}}),
    )
    .await;
    let history = reply(&mut read).await;
    assert_eq!(history["result"][0]["actor"]["id"], "second");
    assert_eq!(history["result"][1]["actor"]["id"], "first");
}
