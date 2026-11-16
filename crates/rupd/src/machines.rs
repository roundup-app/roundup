//! MC1, MC2, MC25: `machine.list` and `machine.add` are herdr-core's own; the Daemon opens a connection
//! to the local core when asked and keeps no Machine row.

use std::collections::BTreeMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::time::Duration;

use contracts::machine::{AddParams, Machine, RemoveParams, UpdateParams};
use rpc::RpcError;
use serde_json::Value;

use crate::bridge::Bridges;
use crate::machine_install::{Setup, install};
use crate::{Conn, Daemon};

const TIMEOUT: Duration = Duration::from_secs(5);

type Connect =
    dyn Fn() -> Pin<Box<dyn Future<Output = herdr::Result<herdr::Conn>> + Send>> + Send + Sync;

/// Where a Machine call finds herdr-core: the local `herdr-core` program, unless a test says other.
#[derive(Clone)]
pub(crate) struct Core(Arc<Connect>, Option<Setup>, Arc<Kept>);

/// MC62: whether the minute read is armed, and the one connection it keeps until it drops.
#[derive(Default)]
struct Kept {
    armed: std::sync::atomic::AtomicBool,
    conn: tokio::sync::Mutex<Option<Arc<herdr::Conn>>>,
}

impl Default for Core {
    fn default() -> Self {
        Self(
            Arc::new(|| Box::pin(herdr::Conn::connect_local(TIMEOUT))),
            // MC25: until the release build ships `rup-linux-*`, adding a machine installs nothing.
            Some(Setup::system()).filter(Setup::has_artifacts),
            Arc::default(),
        )
    }
}

#[cfg(test)]
impl Core {
    pub(crate) fn new(
        connect: impl Fn() -> Pin<Box<dyn Future<Output = herdr::Result<herdr::Conn>> + Send>>
        + Send
        + Sync
        + 'static,
    ) -> Self {
        Self(Arc::new(connect), None, Arc::default())
    }

    /// MC25: a core whose added machines are set up through `setup`.
    pub(crate) fn with_setup(mut self, setup: Setup) -> Self {
        self.1 = Some(setup);
        self
    }
}

impl Core {
    /// U7210e: the version herdr-core's `hello` named, when a core answers.
    pub(crate) async fn version(&self) -> Option<String> {
        Some(self.open().await.ok()?.hello.version.clone())
    }

    /// The open connection while it stays open, else a new one, which is kept once armed.
    async fn open(&self) -> herdr::Result<Arc<herdr::Conn>> {
        let mut kept = self.2.conn.lock().await;
        if let Some(conn) = kept.as_ref().filter(|c| !c.is_closed()) {
            return Ok(Arc::clone(conn));
        }
        let conn = Arc::new((self.0)().await?);
        *kept = self
            .2
            .armed
            .load(Ordering::SeqCst)
            .then(|| Arc::clone(&conn));
        Ok(conn)
    }

    /// Arms the minute read and keeps `conn` for it.
    async fn arm(&self, conn: &Arc<herdr::Conn>) {
        self.2.armed.store(true, Ordering::SeqCst);
        let mut kept = self.2.conn.lock().await;
        if kept.as_ref().is_none_or(|c| c.is_closed()) {
            *kept = Some(Arc::clone(conn));
        }
    }
}

/// MC4: the core's failure keeps its code in the message.
fn failed(err: herdr::Error) -> RpcError {
    RpcError::internal(format!("{}: {err}", err.code()))
}

/// MC15: each Machine with whether roundup's ssh to it last answered, when roundup has tried it.
fn listed(
    machines: Vec<herdr::Machine>,
    reach: &BTreeMap<String, bool>,
    bridges: &Bridges,
    mine: &str,
) -> Vec<Machine> {
    machines
        .into_iter()
        .map(|m| Machine {
            reachable: reach.get(&m.name).copied(),
            outdated: (reach.get(&m.name) != Some(&false))
                .then(|| m.rest.get("version").and_then(Value::as_str))
                .flatten()
                .map(|theirs| herdr::older(theirs, mine)),
            away: bridges.away(&m.name),
            name: m.name,
            details: Value::Object(m.rest),
        })
        .collect()
}

impl Daemon {
    pub(super) async fn machine_list(&self, _conn: &mut Conn) -> Result<Vec<Machine>, RpcError> {
        let core = self.machine_core.open().await.map_err(failed)?;
        let machines = self.listed_now(&core).await?;
        if !machines.is_empty() {
            self.machine_core.arm(&core).await;
        }
        Ok(machines)
    }

    /// The core's list as it stands, with a bridge kept for each Machine on it (MC26).
    async fn listed_now(&self, core: &herdr::Conn) -> Result<Vec<Machine>, RpcError> {
        let machines = core.machine_list().await.map_err(failed)?;
        let names: Vec<String> = machines.iter().map(|m| m.name.clone()).collect();
        self.bridges.sync(&names);
        Ok(listed(
            machines,
            &self.terminals.machine_reachability(),
            &self.bridges,
            &core.hello.version,
        ))
    }

    /// MC26: from the moment this Daemon serves `socket`, hold one bridge per listed Machine,
    /// read again every minute so a Machine added or removed elsewhere follows. MC62: the read
    /// starts only once a Machine is known, and reuses its one connection while it stays open.
    pub(crate) fn start_bridges(self: &Arc<Self>, socket: &std::path::Path) {
        self.bridges.serving(socket);
        let daemon = Arc::clone(self);
        tokio::spawn(async move {
            let mut every_minute = tokio::time::interval(Duration::from_secs(60));
            loop {
                every_minute.tick().await;
                if !daemon.machine_core.2.armed.load(Ordering::SeqCst) {
                    continue;
                }
                if let Ok(core) = daemon.machine_core.open().await {
                    let _ = daemon.listed_now(&core).await;
                }
            }
        });
    }

    /// Adds through the core, then answers the core's list as it stands.
    pub(super) async fn machine_add(
        &self,
        _conn: &mut Conn,
        params: AddParams,
    ) -> Result<Vec<Machine>, RpcError> {
        let core = self.machine_core.open().await.map_err(failed)?;
        core.machine_add(&params.name).await.map_err(failed)?;
        self.machine_core.arm(&core).await;
        if let Some(setup) = &self.machine_core.1 {
            // MC25: the machine's Agents get roundup's hooks and tools.
            install(setup, &params.name)
                .await
                .map_err(|f| RpcError::internal(format!("{}: {}", f.code, f.message)))?;
        }
        self.listed_now(&core).await
    }

    /// MC71: forgets `name` in the core, then answers the core's list as it stands. This Mac is
    /// no entry of the core's list and is refused. Agents and Spools of roundup stay.
    pub(super) async fn machine_remove(
        &self,
        _conn: &mut Conn,
        params: RemoveParams,
    ) -> Result<Vec<Machine>, RpcError> {
        if params.name.trim().eq_ignore_ascii_case("This Mac") {
            return Err(RpcError::internal(
                "this_mac: This Mac cannot be removed".to_owned(),
            ));
        }
        let core = self.machine_core.open().await.map_err(failed)?;
        core.machine_rm(&params.name).await.map_err(failed)?;
        self.listed_now(&core).await
    }

    /// MC72: runs the CLI's `machine update <name>` on this Mac, then answers the core's list as
    /// it stands. The CLI reaches the Machine through the user's own ssh; `connect` has no method.
    pub(super) async fn machine_update(
        &self,
        _conn: &mut Conn,
        params: UpdateParams,
    ) -> Result<Vec<Machine>, RpcError> {
        if params.name.trim().eq_ignore_ascii_case("This Mac") {
            return Err(RpcError::internal(
                "this_mac: This Mac is updated with the App".to_owned(),
            ));
        }
        herdr::update_machine("herdr-core", &params.name)
            .await
            .map_err(failed)?;
        let core = self.machine_core.open().await.map_err(failed)?;
        self.listed_now(&core).await
    }
}

#[cfg(test)]
mod tests {
    //! MC1, MC2 against a fake herdr-core that speaks the spike's frames.
    use super::*;
    use crate::tests::{ask, daemon_in};
    use parking_lot::Mutex;
    use serde_json::json;
    use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader, duplex};

    const HELLO: &str = r#"{"id":0,"jsonrpc":"2.0","result":{"generation":1,"version":"0.1.21","framed":true,"methods":["machine.list","machine.add"]}}"#;

    fn frame(payload: &Value) -> Vec<u8> {
        let p = serde_json::to_vec(payload).unwrap();
        let mut v = 0u32.to_le_bytes().to_vec();
        v.push(0);
        v.extend_from_slice(&(p.len() as u32).to_le_bytes());
        v.extend(p);
        v
    }

    /// A core listing `roundup-ci-control`, recording every request it serves; `machine.add`
    /// puts the added name on the list.
    fn fake_core() -> (Core, Arc<Mutex<Vec<Value>>>) {
        let (core, seen, _, _) = counted_core(&["roundup-ci-control"]);
        (core, seen)
    }

    /// A core listing `initial`, counting its starts; the list is shared by every connection.
    #[allow(clippy::type_complexity)]
    fn counted_core(
        initial: &[&str],
    ) -> (
        Core,
        Arc<Mutex<Vec<Value>>>,
        Arc<std::sync::atomic::AtomicUsize>,
        Arc<Mutex<Vec<String>>>,
    ) {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let log = Arc::clone(&seen);
        let starts = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let counted = Arc::clone(&starts);
        let list = Arc::new(Mutex::new(
            initial.iter().map(|n| (*n).to_owned()).collect::<Vec<_>>(),
        ));
        let shared = Arc::clone(&list);
        let core = Core::new(move || {
            let log = Arc::clone(&log);
            let names = Arc::clone(&shared);
            counted.fetch_add(1, Ordering::SeqCst);
            Box::pin(async move {
                let (mac_r, mut core_w) = duplex(1 << 16);
                let (core_r, mac_w) = duplex(1 << 16);
                tokio::spawn(async move {
                    let mut r = BufReader::new(core_r);
                    let mut line = String::new();
                    r.read_line(&mut line).await.unwrap();
                    core_w
                        .write_all(format!("{HELLO}\n").as_bytes())
                        .await
                        .unwrap();
                    loop {
                        let mut h = [0u8; 9];
                        if r.read_exact(&mut h).await.is_err() {
                            return;
                        }
                        let mut p =
                            vec![0u8; u32::from_le_bytes([h[5], h[6], h[7], h[8]]) as usize];
                        r.read_exact(&mut p).await.unwrap();
                        let req: Value = serde_json::from_slice(&p).unwrap();
                        log.lock().push(req.clone());
                        if req["method"] == "machine.add" {
                            names
                                .lock()
                                .push(req["params"]["name"].as_str().unwrap().to_owned());
                        }
                        let refused =
                            req["method"] == "machine.rm" && req["params"]["name"] == "pinned";
                        if req["method"] == "machine.rm" && !refused {
                            let gone = req["params"]["name"].as_str().unwrap().to_owned();
                            names.lock().retain(|n| *n != gone);
                        }
                        let machines: Vec<Value> = names
                            .lock()
                            .iter()
                            .map(|n| json!({"name": n, "state": "ready"}))
                            .collect();
                        let result = if req["method"] == "machine.list" {
                            json!({"machines": machines})
                        } else {
                            json!({"added": true})
                        };
                        let reply = if refused {
                            json!({"jsonrpc":"2.0","id":req["id"],"error":{"code":-32000,"message":"machine is pinned","data":{"kind":"pinned","hint":"stop its terminals first"}}})
                        } else {
                            json!({"jsonrpc":"2.0","id":req["id"],"result":result})
                        };
                        core_w.write_all(&frame(&reply)).await.unwrap();
                    }
                });
                herdr::Conn::over(mac_r, mac_w, Duration::from_secs(2)).await
            })
        });
        (core, seen, starts, list)
    }

    async fn ticks(n: u32) {
        for _ in 0..n {
            tokio::time::advance(Duration::from_secs(60)).await;
            for _ in 0..20 {
                tokio::task::yield_now().await;
            }
        }
    }

    fn served(dir: &std::path::Path, core: Core) -> Arc<Daemon> {
        let mut daemon = daemon_in(dir);
        daemon.machine_core = core;
        let daemon = Arc::new(daemon);
        daemon.start_bridges(&dir.join("sock"));
        daemon
    }

    const LIST: &str = r#"{"jsonrpc":"2.0","id":1,"method":"machine.list"}"#;

    #[tokio::test(start_paused = true)]
    async fn mc62_zero_machines_start_no_herdr_core() {
        let dir = tempfile::tempdir().unwrap();
        let (core, _, starts, _) = counted_core(&[]);
        let _daemon = served(dir.path(), core);
        ticks(2).await;
        assert_eq!(starts.load(Ordering::SeqCst), 0);
    }

    #[tokio::test(start_paused = true)]
    async fn mc62_machine_list_still_answers_empty() {
        let dir = tempfile::tempdir().unwrap();
        let (core, _, starts, _) = counted_core(&[]);
        let daemon = served(dir.path(), core);
        assert_eq!(ask(&daemon, LIST).await["result"], json!([]));
        assert_eq!(starts.load(Ordering::SeqCst), 1);
    }

    #[tokio::test(start_paused = true)]
    async fn mc62_a_machine_added_through_the_daemon_is_followed_within_a_minute() {
        let dir = tempfile::tempdir().unwrap();
        let (core, seen, _, list) = counted_core(&[]);
        let daemon = served(dir.path(), core);
        let add = r#"{"jsonrpc":"2.0","id":1,"method":"machine.add","params":{"name":"box"}}"#;
        ask(&daemon, add).await;
        list.lock().push("elsewhere".to_owned());
        let lists = |s: &Mutex<Vec<Value>>| {
            s.lock()
                .iter()
                .filter(|r| r["method"] == "machine.list")
                .count()
        };
        let before = lists(&seen);
        ticks(1).await;
        assert!(
            lists(&seen) > before,
            "the minute read ran after machine.add"
        );
    }

    #[tokio::test(start_paused = true)]
    async fn mc62_an_external_add_is_seen_at_the_next_list_call() {
        let dir = tempfile::tempdir().unwrap();
        let (core, seen, _, list) = counted_core(&[]);
        let daemon = served(dir.path(), core);
        list.lock().push("outside".to_owned());
        ticks(2).await;
        assert!(seen.lock().is_empty(), "no read while unarmed");
        let reply = ask(&daemon, LIST).await;
        assert_eq!(reply["result"][0]["name"], "outside");
    }

    #[tokio::test(start_paused = true)]
    async fn mc62_an_open_connection_starts_no_process_per_tick() {
        let dir = tempfile::tempdir().unwrap();
        let (core, _, starts, _) = counted_core(&["a"]);
        let daemon = served(dir.path(), core);
        ask(&daemon, LIST).await;
        ticks(5).await;
        assert_eq!(starts.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn u7210e_check_reads_the_herdr_core_version() {
        let (core, _) = fake_core();
        assert_eq!(core.version().await.as_deref(), Some("0.1.20"));
        let missing = Core::new(|| Box::pin(async { Err(herdr::Error::Missing) }));
        assert_eq!(missing.version().await, None);
    }

    #[tokio::test]
    async fn mc1_machine_list_is_herdr_cores() {
        let dir = tempfile::tempdir().unwrap();
        let (core, _) = fake_core();
        let mut daemon = daemon_in(dir.path());
        daemon.machine_core = core;
        let reply = ask(
            &daemon,
            r#"{"jsonrpc":"2.0","id":1,"method":"machine.list"}"#,
        )
        .await;
        assert_eq!(
            reply["result"],
            json!([{"name": "roundup-ci-control", "details": {"state": "ready"}}])
        );
        let db = rusqlite::Connection::open(crate::data::naming_path(dir.path())).unwrap();
        let tables: i64 = db
            .query_row(
                "select count(*) from sqlite_master where name like '%machine%'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(tables, 0, "no machine table in the Daemon's data");
    }

    #[tokio::test]
    async fn mc2_add_calls_machine_add() {
        let dir = tempfile::tempdir().unwrap();
        let (core, seen) = fake_core();
        let mut daemon = daemon_in(dir.path());
        daemon.machine_core = core;
        let reply = ask(
            &daemon,
            r#"{"jsonrpc":"2.0","id":1,"method":"machine.add","params":{"name":"build-box"}}"#,
        )
        .await;
        let adds: Vec<Value> = seen
            .lock()
            .iter()
            .filter(|r| r["method"] == "machine.add")
            .cloned()
            .collect();
        assert_eq!(adds.len(), 1);
        assert_eq!(adds[0]["params"], json!({"name": "build-box"}));
        let names: Vec<&str> = reply["result"]
            .as_array()
            .unwrap()
            .iter()
            .map(|m| m["name"].as_str().unwrap())
            .collect();
        assert_eq!(names, ["roundup-ci-control", "build-box"]);
    }

    #[tokio::test]
    async fn mc71_remove_calls_machine_rm_after_confirm_and_drops_the_row() {
        let dir = tempfile::tempdir().unwrap();
        let (core, seen) = fake_core();
        let mut daemon = daemon_in(dir.path());
        daemon.machine_core = core;
        let reply = ask(
            &daemon,
            r#"{"jsonrpc":"2.0","id":1,"method":"machine.remove","params":{"name":"roundup-ci-control"}}"#,
        )
        .await;
        let rms: Vec<Value> = seen
            .lock()
            .iter()
            .filter(|r| r["method"] == "machine.rm")
            .cloned()
            .collect();
        assert_eq!(rms.len(), 1);
        assert_eq!(rms[0]["params"], json!({"name": "roundup-ci-control"}));
        assert_eq!(reply["result"], json!([]));
    }

    #[tokio::test]
    async fn mc71_a_refused_rm_carries_the_cores_hint_and_keeps_the_machine() {
        let dir = tempfile::tempdir().unwrap();
        let (core, _, _, list) = counted_core(&["pinned"]);
        let mut daemon = daemon_in(dir.path());
        daemon.machine_core = core;
        let reply = ask(
            &daemon,
            r#"{"jsonrpc":"2.0","id":1,"method":"machine.remove","params":{"name":"pinned"}}"#,
        )
        .await;
        let message = reply["error"]["message"].as_str().unwrap();
        assert!(message.contains("stop its terminals first"), "{message}");
        assert_eq!(*list.lock(), ["pinned"]);
    }

    #[tokio::test]
    async fn mc71_this_mac_cannot_be_removed() {
        let dir = tempfile::tempdir().unwrap();
        let (core, seen) = fake_core();
        let mut daemon = daemon_in(dir.path());
        daemon.machine_core = core;
        let reply = ask(
            &daemon,
            r#"{"jsonrpc":"2.0","id":1,"method":"machine.remove","params":{"name":"This Mac"}}"#,
        )
        .await;
        assert!(
            reply["error"]["message"]
                .as_str()
                .unwrap()
                .starts_with("this_mac")
        );
        assert!(seen.lock().is_empty());
    }

    #[tokio::test]
    async fn mc25_add_sets_the_machine_up_and_a_missing_socat_fails_it() {
        let dir = tempfile::tempdir().unwrap();
        let (core, _) = fake_core();
        let setup = Setup::new(dir.path().into(), |_, _, _| {
            Box::pin(async {
                Ok(crate::machine_install::Ran {
                    ok: true,
                    stdout: "arch=x86_64\nsocat=no\n".into(),
                })
            })
        });
        let mut daemon = daemon_in(dir.path());
        daemon.machine_core = core.with_setup(setup);
        let reply = ask(
            &daemon,
            r#"{"jsonrpc":"2.0","id":1,"method":"machine.add","params":{"name":"build-box"}}"#,
        )
        .await;
        let message = reply["error"]["message"].as_str().unwrap();
        assert!(message.starts_with("socat_missing"), "{message}");
    }
}
