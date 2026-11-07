//! fake-rupd SOCK LOG [dedup] [drop-ack-every=N]: a stand-in for rupd's Unix socket. Each line is
//! JSON. `{"method":"ping"}` gets a JSON-RPC pong. Anything else with an `id` is a report: it is
//! logged as `ms id applied|duplicate` and acked with `{"ok":true,"id":..}`. With `dedup`, a
//! report whose id was seen is acked but not applied. With `drop-ack-every=N`, every Nth new
//! report is applied and the connection is closed without an ack (a lost ack).
use std::collections::HashSet;
use std::io::Write;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixListener;

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let sock = &args[0];
    let _ = std::fs::remove_file(sock);
    let log = Arc::new(Mutex::new(std::fs::OpenOptions::new().create(true).append(true).open(&args[1]).unwrap()));
    let dedup = args.iter().any(|a| a == "dedup");
    let drop_every: u64 = args.iter().find_map(|a| a.strip_prefix("drop-ack-every=")).and_then(|n| n.parse().ok()).unwrap_or(0);
    let seen = Arc::new(Mutex::new((HashSet::<String>::new(), 0u64)));
    let listener = UnixListener::bind(sock).unwrap();
    eprintln!("fake-rupd listening on {sock} dedup={dedup} drop_every={drop_every}");
    loop {
        let (stream, _) = listener.accept().await.unwrap();
        let (log, seen) = (log.clone(), seen.clone());
        tokio::spawn(async move {
            let (r, mut w) = stream.into_split();
            let mut lines = BufReader::new(r).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let v: serde_json::Value = serde_json::from_str(&line).unwrap_or_default();
                if v["method"] == "ping" {
                    let _ = w.write_all(format!("{{\"jsonrpc\":\"2.0\",\"id\":{},\"result\":\"pong\"}}\n", v["id"]).as_bytes()).await;
                    continue;
                }
                let id = v["id"].as_str().unwrap_or("?").to_owned();
                let (applied, lose_ack) = {
                    let mut s = seen.lock().unwrap();
                    let fresh = s.0.insert(id.clone());
                    let applied = fresh || !dedup;
                    let mut lose = false;
                    if fresh {
                        s.1 += 1;
                        lose = drop_every > 0 && s.1 % drop_every == 0;
                    }
                    (applied, lose)
                };
                let ms = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis();
                writeln!(log.lock().unwrap(), "{ms} {id} {}", if applied { "applied" } else { "duplicate" }).unwrap();
                if lose_ack {
                    return; // applied, but the ack never leaves
                }
                let _ = w.write_all(format!("{{\"ok\":true,\"id\":\"{id}\"}}\n").as_bytes()).await;
            }
        });
    }
}
