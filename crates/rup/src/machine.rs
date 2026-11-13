//! MC21, MC22, MC23: `rup` on a machine. `ROUNDUP_MACHINE` set marks it. A report is one line in the
//! Spool, fsynced, and the call returns; `rup relay` serves the Mac's bridge on `relay_socket`, replays
//! the Spool on each connect and deletes a line only on the bridge's `{"ack": id}`. A live call goes
//! through `live_socket`, which relays rupd's JSON-RPC lines framed as `{"c": n, "d": line}`; with no
//! bridge it fails at once as `away`. Nothing here opens a network port.

use std::collections::{HashMap, HashSet};
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use rustix::fs::{FlockOperation, flock};
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::mpsc;

/// What a live call returns when no bridge is up.
pub const AWAY: &str = r#"{"error":"away"}"#;

/// MC22: the tools whose call is spooled and returns `{queued, id}`.
pub const WAITS: [&str; 1] = ["message_send"];

/// MC22: the tools that need rupd's answer, so they fail with `away` when no bridge is up.
pub const FAIL_LOUD: [&str; 29] = [
    "message_get",
    "message_list",
    "todo_create",
    "todo_comments",
    "todo_get",
    "todo_list",
    "todo_update",
    "todo_complete",
    "todo_reopen",
    "todo_setBlockers",
    "pad_create",
    "pad_read",
    "pad_list",
    "pad_write",
    "pad_append",
    "pad_move",
    "pad_delete",
    "pad_appendSection",
    "terminal_screen",
    "terminal_read",
    "terminal_search",
    "terminal_spawn",
    "terminal_open",
    "terminal_close",
    "terminal_write",
    "terminal_resize",
    "terminal_kill",
    "route_set",
    "agent_digest",
];

/// Whether this `rup` runs on a machine, where the Mac may be away.
pub fn active() -> bool {
    std::env::var_os("ROUNDUP_MACHINE").is_some_and(|v| !v.is_empty())
}

/// Whether tool `name` is offered to a machine's Agent.
pub fn offers(name: &str) -> bool {
    WAITS.contains(&name) || FAIL_LOUD.contains(&name)
}

fn home_file(var: &str, name: &str) -> io::Result<PathBuf> {
    if let Some(path) = std::env::var_os(var) {
        return Ok(path.into());
    }
    std::env::var_os("HOME")
        .map(|home| PathBuf::from(home).join(name))
        .ok_or_else(|| io::Error::other(format!("neither {var} nor HOME is set")))
}

/// The socket the bridge dials: `$RUPQ_RELAY_SOCK`, else `~/rupq-relay.sock`.
pub fn relay_socket() -> io::Result<PathBuf> {
    home_file("RUPQ_RELAY_SOCK", "rupq-relay.sock")
}

/// The socket a live call dials: `$RUPQ_LIVE_SOCK`, else `~/rupq.sock`.
pub fn live_socket() -> io::Result<PathBuf> {
    home_file("RUPQ_LIVE_SOCK", "rupq.sock")
}

/// One Spool line.
#[derive(Clone, Debug, PartialEq)]
pub struct Entry {
    pub id: String,
    pub line: String,
}

impl Entry {
    /// The Agent that sent it: `id` is `<agent>:<seq>`.
    fn agent(&self) -> &str {
        self.id.rsplit_once(':').map_or("", |(agent, _)| agent)
    }
}

fn locked(root: &Path) -> io::Result<fs::File> {
    fs::create_dir_all(root)?;
    let lock = OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(root.join("spool.lock"))?;
    flock(&lock, FlockOperation::LockExclusive)?;
    Ok(lock)
}

/// MC21: number the report, append `{id, method, params}` to the Spool and fsync. Returns the id.
pub fn spool(agent: &str, method: &str, params: impl FnOnce(&str) -> Value) -> io::Result<String> {
    let root = crate::seq::root()?;
    let id = crate::seq::next(agent)?;
    let line = json!({ "id": id, "method": method, "params": params(&id) });
    let _lock = locked(&root)?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(root.join("spool"))?;
    file.write_all(format!("{line}\n").as_bytes())?;
    file.sync_data()?;
    Ok(id)
}

/// The Spool, in order.
pub fn pending(root: &Path) -> io::Result<Vec<Entry>> {
    let text = match fs::read_to_string(root.join("spool")) {
        Ok(text) => text,
        Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(err) => return Err(err),
    };
    Ok(text
        .lines()
        .filter_map(|line| {
            let id = serde_json::from_str::<Value>(line)
                .ok()?
                .get("id")?
                .as_str()?
                .to_owned();
            Some(Entry {
                id,
                line: line.to_owned(),
            })
        })
        .collect())
}

/// MC23: delete the line of `id`, after the bridge's ack.
pub fn remove(root: &Path, id: &str) -> io::Result<()> {
    let _lock = locked(root)?;
    let kept: String = pending(root)?
        .into_iter()
        .filter(|entry| entry.id != id)
        .map(|entry| entry.line + "\n")
        .collect();
    let temp = root.join("spool.tmp");
    let mut file = fs::File::create(&temp)?;
    file.write_all(kept.as_bytes())?;
    file.sync_all()?;
    fs::rename(&temp, root.join("spool"))?;
    fs::File::open(root)?.sync_all()
}

/// The bridge's side of the relay: lines out, and the live connections waiting for a reply.
#[derive(Default)]
struct Link {
    bridge: Option<mpsc::UnboundedSender<String>>,
    live: HashMap<u64, mpsc::UnboundedSender<String>>,
    next: u64,
}

type Shared = Arc<Mutex<Link>>;

fn lock(link: &Shared) -> std::sync::MutexGuard<'_, Link> {
    link.lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// `rup relay`: serve the bridge and the live calls until killed.
pub async fn relay() -> Result<(), String> {
    let root = crate::seq::root().map_err(|e| e.to_string())?;
    let bind = |path: PathBuf| -> Result<UnixListener, String> {
        let _ = fs::remove_file(&path);
        UnixListener::bind(&path).map_err(|e| format!("cannot listen at {}: {e}", path.display()))
    };
    let bridge_socket = bind(relay_socket().map_err(|e| e.to_string())?)?;
    let live_listener = bind(live_socket().map_err(|e| e.to_string())?)?;
    let link = Shared::default();
    tokio::spawn(accept_live(live_listener, Arc::clone(&link)));
    loop {
        let (stream, _) = bridge_socket.accept().await.map_err(|e| e.to_string())?;
        // A new bridge replaces the old: dropping its sender ends that connection's task.
        tokio::spawn(serve_bridge(stream, root.clone(), Arc::clone(&link)));
    }
}

async fn serve_bridge(stream: UnixStream, root: PathBuf, link: Shared) {
    let (read, mut write) = stream.into_split();
    let (tx, mut out) = mpsc::unbounded_channel::<String>();
    {
        let mut state = lock(&link);
        state.bridge = Some(tx.clone());
        state.live.clear();
    }
    let mut lines = BufReader::new(read).lines();
    let mut inflight: Option<String> = None;
    let mut blocked: HashSet<String> = HashSet::new();
    let mut tick = tokio::time::interval(Duration::from_millis(50));
    loop {
        tokio::select! {
            line = lines.next_line() => {
                let Ok(Some(line)) = line else { break };
                let Ok(frame) = serde_json::from_str::<Value>(&line) else { continue };
                if let Some(id) = frame.get("ack").and_then(Value::as_str) {
                    if inflight.as_deref() == Some(id) {
                        inflight = None;
                        if remove(&root, id).is_err() { break }
                    }
                } else if let Some(id) = frame.get("nack").and_then(Value::as_str) {
                    if inflight.as_deref() == Some(id) {
                        inflight = None;
                        blocked.insert(id.rsplit_once(':').map_or(String::new(), |(a, _)| a.to_owned()));
                    }
                } else if let Some(n) = frame.get("c").and_then(Value::as_u64) {
                    let reply = frame.get("d").map(Value::to_string);
                    let state = lock(&link);
                    if let (Some(to), Some(reply)) = (state.live.get(&n), reply) { let _ = to.send(reply); }
                }
            }
            Some(frame) = out.recv() => {
                if write.write_all(format!("{frame}\n").as_bytes()).await.is_err() { break }
            }
            _ = tick.tick(), if inflight.is_none() => {
                // MC23: Spool order, and an unacked report holds back its Agent's later ones.
                let next = pending(&root).ok().and_then(|all| all.into_iter().find(|e| !blocked.contains(e.agent())));
                if let Some(entry) = next {
                    if write.write_all(format!("{}\n", entry.line).as_bytes()).await.is_err() { break }
                    inflight = Some(entry.id);
                }
            }
        }
    }
    let mut state = lock(&link);
    if state.bridge.as_ref().is_some_and(|b| b.same_channel(&tx)) {
        state.bridge = None;
        state.live.clear();
    }
}

async fn accept_live(listener: UnixListener, link: Shared) {
    while let Ok((stream, _)) = listener.accept().await {
        tokio::spawn(serve_live(stream, Arc::clone(&link)));
    }
}

async fn serve_live(stream: UnixStream, link: Shared) {
    let (read, mut write) = stream.into_split();
    let (reply_tx, mut replies) = mpsc::unbounded_channel::<String>();
    let (n, bridge) = {
        let mut state = lock(&link);
        // No bridge: the connection closes at once, and the caller reads that as away.
        let Some(bridge) = state.bridge.clone() else {
            return;
        };
        state.next += 1;
        let n = state.next;
        state.live.insert(n, reply_tx);
        (n, bridge)
    };
    let mut lines = BufReader::new(read).lines();
    loop {
        tokio::select! {
            line = lines.next_line() => {
                let Ok(Some(line)) = line else { break };
                let Ok(d) = serde_json::from_str::<Value>(&line) else { continue };
                if bridge.send(json!({ "c": n, "d": d }).to_string()).is_err() { break }
            }
            reply = replies.recv() => {
                let Some(reply) = reply else { break };
                if write.write_all(format!("{reply}\n").as_bytes()).await.is_err() { break }
            }
        }
    }
    let _ = bridge.send(json!({ "c": n, "close": true }).to_string());
    lock(&link).live.remove(&n);
}

/// MC22: a client of the live socket, or `None` for away: no relay, no bridge, or no answer to identify.
pub async fn live_client(actor: &contracts::Actor) -> Option<rpc::Client> {
    let socket = live_socket().ok()?;
    let client = rpc::Client::connect(&socket).await.ok()?;
    client
        .request(
            "daemon.identify",
            contracts::IdentifyParams {
                actor: actor.clone(),
            },
        )
        .await
        .ok()?;
    Some(client)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mc23_a_line_stays_until_removed() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(
            dir.path().join("spool"),
            "{\"id\":\"a1:1\"}\n{\"id\":\"b2:1\"}\n",
        )
        .unwrap();
        assert_eq!(pending(dir.path()).unwrap().len(), 2);
        remove(dir.path(), "a1:1").unwrap();
        let left = pending(dir.path()).unwrap();
        assert_eq!(left.len(), 1);
        assert_eq!(left[0].agent(), "b2");
    }
}
