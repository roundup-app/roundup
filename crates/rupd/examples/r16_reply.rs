//! Attribution only: excludes scheduling, socket I/O, and Rail database/presentation work.
use std::hint::black_box;
use std::time::Instant;

use contracts::agent::RailNode;
use serde_json::{Value, json};

fn measure<T>(name: &str, mut operation: impl FnMut() -> T) {
    for _ in 0..100 {
        operation();
    }
    let mut samples = Vec::new();
    for _ in 0..3300 {
        let start = Instant::now();
        let output = black_box(operation());
        samples.push(start.elapsed().as_secs_f64() * 1e6);
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
        .map(|i| {
            serde_json::from_value(json!({
        "id": format!("workstream-{i}"), "kind": "workstream", "name": format!("Workstream {i}"),
        "parent": null, "order": i, "status": null, "attempt": null,
        "status_revision": null, "terminal_id": null, "worktree": null,
        "can_resume": false, "channel": null, "work": null, "stray": [],
        "model": null, "effort": null
    })).unwrap()
        })
        .collect();
    let result = rpc::reply(&nodes).unwrap();
    let frame = json!({"jsonrpc": "2.0", "id": 1, "result": result});
    let bytes = serde_json::to_vec(&frame).unwrap();
    measure("rpc_reply", || {
        black_box(rpc::reply(black_box(&nodes)).unwrap())
    });
    measure("daemon_envelope_json_macro", || {
        black_box(json!({"jsonrpc": "2.0", "id": 1, "result": black_box(&result)}))
    });
    // Clone the input outside the timed envelope comparison below.
    let mut inputs: Vec<Value> = (0..3400).map(|_| result.clone()).collect();
    measure("daemon_envelope_move", || {
        let mut envelope = serde_json::Map::new();
        envelope.insert("jsonrpc".into(), Value::String("2.0".into()));
        envelope.insert("id".into(), Value::from(1));
        envelope.insert("result".into(), inputs.pop().unwrap());
        black_box(Value::Object(envelope))
    });
    measure("daemon_frame_display", || black_box(format!("{frame}\n")));
    measure("daemon_frame_to_vec", || {
        let mut bytes = serde_json::to_vec(black_box(&frame)).unwrap();
        bytes.push(b'\n');
        black_box(bytes)
    });
    measure("client_parse", || {
        black_box(serde_json::from_slice::<Value>(black_box(&bytes)).unwrap())
    });
    measure("client_result_clone", || {
        black_box(black_box(&frame)["result"].clone())
    });
}
