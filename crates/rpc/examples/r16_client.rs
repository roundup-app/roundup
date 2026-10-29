//! R16: complete pre-rendered replies isolate Client parsing/extraction and socket scheduling.
use std::io::{BufRead, Write};
use std::os::unix::net::UnixListener;
use std::time::Instant;

use rpc::Client;
use serde_json::{Value, json};

#[tokio::main]
async fn main() {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("rupd.sock");
    let listener = UnixListener::bind(&socket).unwrap();
    let rows: Vec<Value> = (0..40).map(|i| json!({
        "id": format!("workstream-{i}"), "kind": "workstream", "name": format!("Workstream {i}"),
        "parent": null, "order": i, "status": null, "attempt": null,
        "status_revision": null, "terminal_id": null, "worktree": null,
        "can_resume": false, "channel": null, "work": null, "stray": [],
        "model": null, "effort": null
    })).collect();
    let expected = json!(rows);
    let frames: Vec<String> = (1..=3400)
        .map(|id| {
            format!(
                "{}\n",
                json!({"jsonrpc": "2.0", "id": id, "result": expected})
            )
        })
        .collect();
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut lines = std::io::BufReader::new(stream.try_clone().unwrap()).lines();
        for frame in frames {
            lines.next().unwrap().unwrap();
            stream.write_all(frame.as_bytes()).unwrap();
        }
    });
    let client = Client::connect(&socket).await.unwrap();
    let mut samples = Vec::with_capacity(3300);
    for i in 0..3400 {
        let start = Instant::now();
        let result = client.request("rail.tree", Value::Null).await.unwrap();
        let elapsed = start.elapsed().as_secs_f64() * 1e6;
        assert_eq!(result, expected);
        if i >= 100 {
            samples.push(elapsed);
        }
    }
    server.join().unwrap();
    samples.sort_by(f64::total_cmp);
    println!(
        "client_reply: median_us={} p95_us={}",
        (samples[1649] + samples[1650]) / 2.0,
        samples[3134]
    );
}
