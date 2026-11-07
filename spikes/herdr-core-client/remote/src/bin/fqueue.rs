//! fqueue daemon: the machine-side queue for `rup signal` and `rup mcp`. boxd's ssh gateway does
//! not realise `ssh -R` (see REPORT Q11), so the Mac dials in instead:
//!   hooks  --(unix ~/rupq.sock)-->  fqueue  <--(ssh host socat - UNIX-CONNECT:~/rupq-relay.sock)--  Mac bridge
//! * A line without "method" is a report `{"id":"agent:seq",...}`: appended to the spool and
//!   fsynced, then acked `{"ok":true,"id":..}` at once (accepted = durable). It stays in the spool
//!   until the Mac sends `{"ack":"agent:seq"}`; every connect of the relay replays the unacked ones in order.
//! * A line with "method" is a live call (MCP, or `direct` reports): sent to the Mac as
//!   `{"key":K,"rpc":{...}}`, the answer `{"key":K,"reply":{...}}` goes back. No relay: `{"error":"away"}`.
use std::collections::{HashMap, VecDeque};
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::PathBuf;
use std::sync::mpsc::{Sender, channel};
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[derive(Default)]
struct State {
    pending: VecDeque<(String, String)>,
    relay: Option<(u64, UnixStream)>,
    generation: u64,
    waiters: HashMap<String, Sender<String>>,
    keys: u64,
}

fn home() -> PathBuf {
    PathBuf::from(std::env::var_os("HOME").unwrap())
}

fn persist(st: &State, dir: &PathBuf) {
    let tmp = dir.join("spool.tmp");
    let mut f = std::fs::File::create(&tmp).unwrap();
    for (_, l) in &st.pending {
        writeln!(f, "{l}").unwrap();
    }
    f.sync_all().unwrap();
    std::fs::rename(tmp, dir.join("spool")).unwrap();
}

fn main() {
    let dir = home().join(".rupq");
    std::fs::create_dir_all(&dir).unwrap();
    let mut st = State::default();
    for l in std::fs::read_to_string(dir.join("spool")).unwrap_or_default().lines() {
        let v: serde_json::Value = serde_json::from_str(l).unwrap_or_default();
        st.pending.push_back((v["id"].as_str().unwrap_or("").to_owned(), l.to_owned()));
    }
    let st = Arc::new(Mutex::new(st));
    let (sock, relay_sock) = (home().join("rupq.sock"), home().join("rupq-relay.sock"));
    let _ = std::fs::remove_file(&sock);
    let _ = std::fs::remove_file(&relay_sock);
    let hooks = UnixListener::bind(&sock).unwrap();
    let relays = UnixListener::bind(&relay_sock).unwrap();

    // Relay side: the Mac's bridge connects here through ssh.
    let (st2, dir2) = (st.clone(), dir.clone());
    std::thread::spawn(move || {
        for conn in relays.incoming().flatten() {
            let mut s = st2.lock().unwrap();
            s.generation += 1;
            let gen_id = s.generation;
            let mut w = conn.try_clone().unwrap();
            for (_, l) in &s.pending {
                if writeln!(w, "{l}").is_err() {
                    break;
                }
            }
            s.relay = Some((gen_id, w));
            drop(s);
            let (st3, dir3) = (st2.clone(), dir2.clone());
            std::thread::spawn(move || {
                for line in BufReader::new(conn).lines().map_while(Result::ok) {
                    let v: serde_json::Value = serde_json::from_str(&line).unwrap_or_default();
                    let mut s = st3.lock().unwrap();
                    if let Some(id) = v["ack"].as_str() {
                        s.pending.retain(|(i, _)| i != id);
                        persist(&s, &dir3);
                    } else if let Some(key) = v["key"].as_str()
                        && let Some(w) = s.waiters.remove(key)
                    {
                        let _ = w.send(v["reply"].to_string());
                    }
                }
                let mut s = st3.lock().unwrap();
                if s.relay.as_ref().is_some_and(|(g, _)| *g == gen_id) {
                    s.relay = None;
                }
            });
        }
    });

    // Hook side.
    for conn in hooks.incoming().flatten() {
        let (st, dir) = (st.clone(), dir.clone());
        std::thread::spawn(move || {
            let mut w = conn.try_clone().unwrap();
            for line in BufReader::new(conn).lines().map_while(Result::ok) {
                let v: serde_json::Value = serde_json::from_str(&line).unwrap_or_default();
                if v.get("method").is_none() {
                    let id = v["id"].as_str().unwrap_or("?").to_owned();
                    let mut s = st.lock().unwrap();
                    s.pending.push_back((id.clone(), line.clone()));
                    // Durable before the ack.
                    let mut f = std::fs::OpenOptions::new().create(true).append(true).open(dir.join("spool")).unwrap();
                    writeln!(f, "{line}").unwrap();
                    f.sync_all().expect("fsync spool: fail loud");
                    if let Some((_, r)) = s.relay.as_mut()
                        && writeln!(r, "{line}").is_err()
                    {
                        s.relay = None;
                    }
                    drop(s);
                    let _ = writeln!(w, r#"{{"ok":true,"id":"{id}"}}"#);
                    continue;
                }
                let (tx, rx) = channel();
                let key = {
                    let mut s = st.lock().unwrap();
                    s.keys += 1;
                    let key = format!("c{}", s.keys);
                    let Some((_, r)) = s.relay.as_mut() else {
                        let _ = writeln!(w, r#"{{"error":"away"}}"#);
                        continue;
                    };
                    if writeln!(r, r#"{{"key":"{key}","rpc":{line}}}"#).is_err() {
                        s.relay = None;
                        let _ = writeln!(w, r#"{{"error":"away"}}"#);
                        continue;
                    }
                    s.waiters.insert(key.clone(), tx);
                    key
                };
                match rx.recv_timeout(Duration::from_secs(5)) {
                    Ok(reply) => {
                        let _ = writeln!(w, "{reply}");
                    }
                    Err(_) => {
                        st.lock().unwrap().waiters.remove(&key);
                        let _ = writeln!(w, r#"{{"error":"timeout"}}"#);
                    }
                }
            }
        });
    }
}
