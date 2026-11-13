//! MC1, MC2: `machine.list` and `machine.add` are herdr-core's own; the Daemon opens a connection
//! to the local core when asked and keeps no Machine row.

use std::collections::BTreeMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use contracts::machine::{AddParams, Machine};
use rpc::RpcError;
use serde_json::Value;

use crate::{Conn, Daemon};

const TIMEOUT: Duration = Duration::from_secs(5);

type Connect =
    dyn Fn() -> Pin<Box<dyn Future<Output = herdr::Result<herdr::Conn>> + Send>> + Send + Sync;

/// Where a Machine call finds herdr-core: the local `herdr-core` program, unless a test says other.
#[derive(Clone)]
pub(crate) struct Core(Arc<Connect>);

impl Default for Core {
    fn default() -> Self {
        Self(Arc::new(|| Box::pin(herdr::Conn::connect_local(TIMEOUT))))
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
        Self(Arc::new(connect))
    }
}

/// MC4: the core's failure keeps its code in the message.
fn failed(err: herdr::Error) -> RpcError {
    RpcError::internal(format!("{}: {err}", err.code()))
}

/// MC15: each Machine with whether roundup's ssh to it last answered, when roundup has tried it.
fn listed(machines: Vec<herdr::Machine>, reach: &BTreeMap<String, bool>) -> Vec<Machine> {
    machines
        .into_iter()
        .map(|m| Machine {
            reachable: reach.get(&m.name).copied(),
            name: m.name,
            details: Value::Object(m.rest),
        })
        .collect()
}

impl Daemon {
    pub(super) async fn machine_list(&self, _conn: &mut Conn) -> Result<Vec<Machine>, RpcError> {
        let core = (self.machine_core.0)().await.map_err(failed)?;
        Ok(listed(
            core.machine_list().await.map_err(failed)?,
            &self.terminals.machine_reachability(),
        ))
    }

    /// Adds through the core, then answers the core's list as it stands.
    pub(super) async fn machine_add(
        &self,
        _conn: &mut Conn,
        params: AddParams,
    ) -> Result<Vec<Machine>, RpcError> {
        let core = (self.machine_core.0)().await.map_err(failed)?;
        core.machine_add(&params.name).await.map_err(failed)?;
        Ok(listed(
            core.machine_list().await.map_err(failed)?,
            &self.terminals.machine_reachability(),
        ))
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

    const HELLO: &str = r#"{"id":0,"jsonrpc":"2.0","result":{"generation":1,"version":"0.1.18","framed":true,"methods":["machine.list","machine.add"]}}"#;

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
        let seen = Arc::new(Mutex::new(Vec::new()));
        let log = Arc::clone(&seen);
        let core = Core::new(move || {
            let log = Arc::clone(&log);
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
                    let mut names = vec!["roundup-ci-control".to_owned()];
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
                            names.push(req["params"]["name"].as_str().unwrap().to_owned());
                        }
                        let machines: Vec<Value> = names
                            .iter()
                            .map(|n| json!({"name": n, "state": "ready"}))
                            .collect();
                        let result = if req["method"] == "machine.list" {
                            json!({"machines": machines})
                        } else {
                            json!({"added": true})
                        };
                        let reply = json!({"jsonrpc":"2.0","id":req["id"],"result":result});
                        core_w.write_all(&frame(&reply)).await.unwrap();
                    }
                });
                herdr::Conn::over(mac_r, mac_w, Duration::from_secs(2)).await
            })
        });
        (core, seen)
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
}
