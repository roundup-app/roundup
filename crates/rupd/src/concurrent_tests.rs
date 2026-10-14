use super::*;
use std::time::Duration;
use tokio::sync::Semaphore;

struct Held {
    entered: mpsc::UnboundedSender<String>,
    release: Arc<Semaphore>,
}

#[async_trait::async_trait]
impl Module for Held {
    fn namespaces(&self) -> &'static [&'static str] {
        &["agent"]
    }
    async fn call(&self, ctx: &Ctx, method: &str, _: Value) -> Result<Value, RpcError> {
        self.entered.send(method.into()).unwrap();
        let permit = self.release.acquire().await.unwrap();
        permit.forget();
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
    daemon.register(Arc::new(Held {
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
    let mut bytes =
        serde_json::to_vec(&json!({"jsonrpc":"2.0", "id":id, "method":method})).unwrap();
    bytes.push(b'\n');
    write.write_all(&bytes).await.unwrap();
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
async fn d9_a_held_call_does_not_hold_the_next_reply() {
    let (_dir, stream, mut entries, release) = fixture().await;
    let (read, mut write) = stream.into_split();
    let mut read = BufReader::new(read).lines();
    send(&mut write, json!("held"), "agent.stop").await;
    assert_eq!(entries.recv().await.unwrap(), "agent.stop");
    send(&mut write, json!(2), "rail.tree").await;
    let tree = reply(&mut read).await;
    assert_eq!(tree["id"], 2);
    assert_eq!(tree["result"], json!([]));
    release.add_permits(1);
    let held = reply(&mut read).await;
    assert_eq!(held["id"], "held");
    assert_eq!(held["result"]["method"], "agent.stop");
}

#[tokio::test]
async fn d9_half_close_keeps_ordinary_calls_alive() {
    let (_dir, stream, mut entries, release) = fixture().await;
    let (read, mut write) = stream.into_split();
    let mut read = BufReader::new(read).lines();
    send(&mut write, json!(1), "agent.stop").await;
    entries.recv().await.unwrap();
    write.shutdown().await.unwrap();
    release.add_permits(1);
    assert_eq!(reply(&mut read).await["result"]["method"], "agent.stop");
}
