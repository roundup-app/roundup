//! R16: isolate line acquisition from parsing, Daemon rendering and socket scheduling.
use std::hint::black_box;
use std::time::Instant;

use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, BufReader};

fn report(name: &str, mut samples: Vec<f64>) {
    samples.sort_by(f64::total_cmp);
    println!(
        "{name}: median_us={} p95_us={}",
        (samples[1649] + samples[1650]) / 2.0,
        samples[3134]
    );
}

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let rows: Vec<Value> = (0..40).map(|i| json!({
        "id": format!("workstream-{i}"), "kind": "workstream", "name": format!("Workstream {i}"),
        "parent": null, "order": i, "status": null, "attempt": null,
        "status_revision": null, "terminal_id": null, "worktree": null,
        "can_resume": false, "channel": null, "work": null, "stray": [],
        "model": null, "effort": null
    })).collect();
    let frame = format!("{}\n", json!({"jsonrpc": "2.0", "id": 1, "result": rows}));
    println!("frame_bytes_with_newline={}", frame.len());
    let input = frame.repeat(3400);
    let mut lines = BufReader::new(input.as_bytes()).lines();
    let mut samples = Vec::with_capacity(3300);
    for i in 0..3400 {
        let start = Instant::now();
        let line = black_box(lines.next_line().await.unwrap().unwrap());
        let elapsed = start.elapsed().as_secs_f64() * 1e6;
        assert_eq!(line, frame.trim_end());
        if i >= 100 {
            samples.push(elapsed);
        }
        drop(line);
    }
    report("lines", samples);
    let mut reader = BufReader::new(input.as_bytes());
    let mut line = String::new();
    let mut samples = Vec::with_capacity(3300);
    for i in 0..3400 {
        line.clear();
        let start = Instant::now();
        black_box(reader.read_line(&mut line).await.unwrap());
        let elapsed = start.elapsed().as_secs_f64() * 1e6;
        assert_eq!(line, frame);
        if i >= 100 {
            samples.push(elapsed);
        }
    }
    report("read_line_reuse", samples);
    println!("retained_capacity={}", line.capacity());
}
