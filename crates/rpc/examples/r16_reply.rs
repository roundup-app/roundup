//! R16 attribution only: no Daemon envelope/rendering, socket scheduling, or Rail database work.
use std::hint::black_box;
use std::time::Instant;

use contracts::agent::RailNode;
use serde_json::{Value, json};

fn measure<T>(name: &str, mut operation: impl FnMut() -> T) {
    for _ in 0..100 {
        black_box(operation());
    }
    let mut samples = Vec::with_capacity(3300);
    for _ in 0..3300 {
        let start = Instant::now();
        let output = black_box(operation());
        samples.push(start.elapsed().as_secs_f64() * 1e6);
        // Destruction is not reply conversion, parsing, or extraction.
        drop(output);
    }
    samples.sort_by(f64::total_cmp);
    println!(
        "{name}: median_us={} p95_us={}",
        (samples[1649] + samples[1650]) / 2.0,
        samples[3134]
    );
}

fn main() {
    let nodes: Vec<RailNode> = (0..40)
        .map(|i| serde_json::from_value(json!({
            "id": format!("workstream-{i}"), "kind": "workstream", "name": format!("Workstream {i}"),
            "parent": null, "order": i, "status": null, "attempt": null,
            "status_revision": null, "terminal_id": null, "worktree": null,
            "can_resume": false, "channel": null, "work": null, "stray": [],
            "model": null, "effort": null
        })).unwrap())
        .collect();
    let result = rpc::reply(&nodes).unwrap();
    let frame = json!({"jsonrpc": "2.0", "id": 1, "result": result});
    let bytes = serde_json::to_vec(&frame).unwrap();
    println!(
        "frame_bytes={} row_fields={}",
        bytes.len(),
        frame["result"][0].as_object().unwrap().len()
    );
    measure("rpc_reply", || rpc::reply(black_box(&nodes)).unwrap());
    measure("client_parse", || {
        serde_json::from_slice::<Value>(black_box(&bytes)).unwrap()
    });
    measure("client_result_clone", || {
        black_box(&frame)["result"].clone()
    });
    // Prepare owned frames outside the extraction clock; keep envelope destruction outside too.
    let mut inputs: Vec<Value> = (0..3400).map(|_| frame.clone()).collect();
    measure("client_result_move", || {
        let mut frame = inputs.pop().unwrap();
        let result = frame["result"].take();
        (frame, result)
    });
}
