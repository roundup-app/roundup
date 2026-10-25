use super::*;
use rpc::Module;
use std::sync::{Arc, atomic::{AtomicUsize, Ordering}};
use rmcp::model::{CallToolRequestParams, CallToolResult};
use serde_json::json;

#[tokio::test]
async fn c4_one_declaration_reaches_every_surface() {
    let dir = tempfile::tempdir().unwrap();
    let bus = rpc::Bus::new();
    let todos = Arc::new(todos::Todos::open(dir.path(), bus.clone()).unwrap());
    let ctx = Arc::new(rpc::Ctx {
        actor: Actor {kind: ActorKind::Agent, id: "fixture-agent".into(), parent: None}, bus,
        touches: Arc::new(provenance::Touches::in_memory().unwrap()),
    });
    let removed = std::env::var_os("C4_REMOVED").is_some();
    assert_eq!(contracts::methods::method_names().iter().filter(|name| **name == "todo.contractProbe").count(), usize::from(!removed));
    for list in [tools(false), door_tools()] {
        assert_eq!(list.iter().filter(|offer| offer.method == "todo.contractProbe").count(), usize::from(!removed));
    }
    let direct = todos.call(&ctx, "todo.contractProbe", json!({"id": 41})).await;
    if removed {
        assert_eq!(direct.unwrap_err().code, rpc::code::METHOD_NOT_FOUND);
    } else {
        assert_eq!(direct.unwrap(), json!({"id": 42}));
    }
    let socket = dir.path().join("mcp.sock");
    let listener = tokio::net::UnixListener::bind(&socket).unwrap();
    let calls = Arc::new(AtomicUsize::new(0));
    let seen = Arc::clone(&calls);
    let server = tokio::spawn(async move {
        use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
        loop {
            let (stream, _) = listener.accept().await.unwrap();
            let todos = Arc::clone(&todos);
            let ctx = Arc::clone(&ctx);
            let seen = Arc::clone(&seen);
            tokio::spawn(async move {
                let (read, mut write) = stream.into_split();
                let mut lines = BufReader::new(read).lines();
                while let Some(line) = lines.next_line().await.unwrap() {
                    let request: Value = serde_json::from_str(&line).unwrap();
                    let method = request["method"].as_str().unwrap();
                    let result = if method == "daemon.identify" { Value::Null } else {
                        seen.fetch_add(1, Ordering::SeqCst);
                        todos.call(&ctx, method, request["params"].clone()).await.unwrap()
                    };
                    let response = json!({"jsonrpc":"2.0", "id":request["id"], "result":result});
                    write.write_all(format!("{response}\n").as_bytes()).await.unwrap();
                }
            });
        }
    });
    let (client, transport) = tokio::io::duplex(65536);
    let (gone, _) = mpsc::channel(1);
    let shim = Shim {socket, actor: Actor {kind: ActorKind::Agent, id: "fixture-agent".into(), parent: None}, tools: tools(false), gone};
    let service = tokio::spawn(async move { shim.serve(transport).await.unwrap().waiting().await });
    let client = ().serve(client).await.unwrap();
    let outcome = client.call_tool(CallToolRequestParams::new("todo_contractProbe").with_arguments(JsonObject::from_iter([("id".into(), 51.into())]))).await;
    if removed {
        assert!(outcome.is_err());
        assert_eq!(calls.load(Ordering::SeqCst), 0);
    } else {
        let result: CallToolResult = outcome.unwrap();
        assert_eq!(result.content[0].as_text().unwrap().text, "{\"id\":52}");
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }
    client.cancel().await.unwrap();
    server.abort();
    service.abort();
}
