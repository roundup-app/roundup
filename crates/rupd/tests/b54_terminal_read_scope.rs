//! B54 through a real Daemon: a fake `claude` whose pane prints a word naming its Agent.
#[path = "support/rupd_harness.rs"]
mod rupd_harness;

use std::path::{Path, PathBuf};
use std::time::Duration;

use rpc::Client;
use serde_json::{Value, json};

const BOUND: Duration = Duration::from_secs(30);

struct World {
    // Rust drops fields in declaration order: the Daemon goes before its folders.
    daemon: rupd_harness::Rupd,
    dir: tempfile::TempDir,
    _data: tempfile::TempDir,
    user: Client,
}

struct Rail {
    m: String,
    c: String,
    g: String,
    s: String,
    n: String,
    d: String,
}

impl World {
    async fn start() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        let rupd = PathBuf::from(env!("CARGO_BIN_EXE_rupd"));
        let rup = rupd.with_file_name("rup");
        assert!(rup.is_file(), "cargo build -p rup first");
        let fake = Path::new(env!("CARGO_MANIFEST_DIR")).join("../rup/tests/e2e/fake_claude.py");
        let wrapper = dir.path().join("claude");
        std::fs::write(
            &wrapper,
            format!(
                "#!/bin/sh\nprintf 'WORD%s ' \"$ROUNDUP_AGENT\"\nexec {} \"$@\"\n",
                fake.display()
            ),
        )
        .unwrap();
        std::fs::set_permissions(
            &wrapper,
            std::os::unix::fs::PermissionsExt::from_mode(0o755),
        )
        .unwrap();
        let daemon = rupd_harness::start(&rupd, dir.path(), true, |command| {
            command
                .current_dir(dir.path())
                .env("CLAUDE_CONFIG_DIR", dir.path().join("claude-config"))
                .env("ROUNDUP_RUP_BIN", &rup)
                .env("ROUNDUP_CLAUDE_BIN", &wrapper)
                .env("FAKE_CLAUDE_LAUNCH_LOG", dir.path().join("launch"))
                .env("FAKE_CLAUDE_INPUT_LOG", dir.path().join("input"))
                .env("ROUNDUP_DATA_DIR", data.path());
        });
        let user = Client::connect(&daemon.socket).await.unwrap();
        Self {
            daemon,
            dir,
            _data: data,
            user,
        }
    }

    async fn as_agent(&self, id: &str) -> Client {
        let client = Client::connect(&self.daemon.socket).await.unwrap();
        client
            .request(
                "daemon.identify",
                json!({"actor":{"kind":"agent","id":id,"parent":null}}),
            )
            .await
            .unwrap();
        client
    }

    async fn workstream(&self, name: &str) -> String {
        let node = self
            .user
            .request("rail.createWorkstream", json!({"name":name,"parent":null}))
            .await
            .unwrap();
        node["id"].as_str().unwrap().to_owned()
    }

    async fn spawn(&self, by: &Client, parent: &str) -> String {
        let node = by
            .request(
                "agent.spawn",
                json!({"cwd":self.dir.path(),"prompt":null,"parent":parent}),
            )
            .await
            .unwrap();
        node["id"].as_str().unwrap().to_owned()
    }

    async fn terminal_of(&self, id: &str) -> String {
        let tree = self.user.request("rail.tree", Value::Null).await.unwrap();
        tree.as_array()
            .unwrap()
            .iter()
            .find(|n| n["id"] == id)
            .and_then(|n| n["terminal_id"].as_str())
            .unwrap()
            .to_owned()
    }

    async fn rail(&self) -> Rail {
        let m = self.workstream("w1").await;
        let n = self.workstream("w2").await;
        for door in [&m, &n] {
            self.user
                .request("rail.startDoor", json!({"id":door}))
                .await
                .unwrap();
        }
        let as_m = self.as_agent(&m).await;
        let c = self.spawn(&as_m, &m).await;
        let s = self.spawn(&as_m, &m).await;
        let as_c = self.as_agent(&c).await;
        let g = self.spawn(&as_c, &c).await;
        let d = self.spawn(&self.user, &n).await;
        Rail { m, c, g, s, n, d }
    }

    /// The pane of `agent` once its distinct word is on it.
    async fn pane(&self, agent: &str) -> String {
        let id = self.terminal_of(agent).await;
        tokio::time::timeout(BOUND, async {
            loop {
                let screen = self
                    .user
                    .request("terminal.screen", json!({"id":id}))
                    .await
                    .unwrap();
                if screen.to_string().contains(&format!("WORD{agent}")) {
                    return id.clone();
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await
        .expect("the pane printed its word")
    }

    fn typed(&self) -> String {
        std::fs::read_to_string(self.dir.path().join("input")).unwrap_or_default()
    }

    /// The input log once startup prompts have stopped arriving.
    async fn settled_typed(&self) -> String {
        let mut last = self.typed();
        let mut quiet = 0;
        loop {
            tokio::time::sleep(Duration::from_millis(500)).await;
            let now = self.typed();
            if now == last {
                quiet += 1;
                if quiet == 4 {
                    return now;
                }
            } else {
                quiet = 0;
                last = now;
            }
        }
    }

    async fn touches(&self, item: &str) -> Value {
        self.user
            .request("provenance.history", json!({"item":item}))
            .await
            .unwrap()
    }
}

fn reads(id: &str) -> [(&'static str, Value); 3] {
    [
        ("terminal.screen", json!({"id":id})),
        ("terminal.read", json!({"id":id,"after":0})),
        ("terminal.search", json!({"id":id,"pattern":"WORD"})),
    ]
}

async fn reads_ok(client: &Client, agent: &str, id: &str) {
    for (method, params) in reads(id) {
        let got = client.request(method, params).await.expect(method);
        assert!(
            got.to_string().contains(&format!("WORD{agent}")),
            "{method}: {got}"
        );
    }
}

async fn refused(client: &Client, caller: &str, id: &str) {
    for (method, params) in reads(id) {
        let err = client.request(method, params).await.expect_err(method);
        let text = err.to_string();
        assert!(
            text.contains(id) && text.contains(caller),
            "{method}: {text}"
        );
        assert!(
            text.contains(&format!("not started by {caller} or in its Reach")),
            "{method}: {text}"
        );
        assert!(!text.contains("WORD"), "{method}: {text}");
    }
}

#[tokio::test]
async fn b54_a_door_reads_its_own_childs_terminal() {
    let w = World::start().await;
    let r = w.rail().await;
    let pane = w.pane(&r.c).await;
    let typed = w.settled_typed().await;
    reads_ok(&w.as_agent(&r.m).await, &r.c, &pane).await;
    assert_eq!(w.typed(), typed);
    // The user has no limit.
    reads_ok(&w.user, &r.c, &pane).await;
}

#[tokio::test]
async fn b54_a_door_reads_a_grandchilds_terminal() {
    let w = World::start().await;
    let r = w.rail().await;
    let pane = w.pane(&r.g).await;
    let typed = w.settled_typed().await;
    reads_ok(&w.as_agent(&r.m).await, &r.g, &pane).await;
    assert_eq!(w.typed(), typed);
}

#[tokio::test]
async fn b54_a_child_cannot_read_its_parents_terminal() {
    let w = World::start().await;
    let r = w.rail().await;
    let parent = w.pane(&r.m).await;
    let own = w.pane(&r.c).await;
    let as_c = w.as_agent(&r.c).await;
    refused(&as_c, &r.c, &parent).await;
    // Its own pane stays forbidden too (M13).
    refused(&as_c, &r.c, &own).await;
}

#[tokio::test]
async fn b54_another_workstreams_terminal_is_refused_with_the_reason() {
    let w = World::start().await;
    let r = w.rail().await;
    let as_m = w.as_agent(&r.m).await;
    for other in [&r.d, &r.n] {
        let pane = w.pane(other).await;
        refused(&as_m, &r.m, &pane).await;
    }
    let run = w
        .as_agent(&r.d)
        .await
        .request(
            "agent.run",
            json!({"id":r.d,"command":["/bin/sh","-c","echo WORD; sleep 30"]}),
        )
        .await
        .unwrap();
    refused(&as_m, &r.m, run["terminal_id"].as_str().unwrap()).await;
}

#[tokio::test]
async fn b54_a_sibling_it_did_not_start_is_refused() {
    let w = World::start().await;
    let r = w.rail().await;
    let pane = w.pane(&r.s).await;
    refused(&w.as_agent(&r.c).await, &r.c, &pane).await;
}

#[tokio::test]
async fn b54_a_refused_read_reads_nothing_and_logs_no_touch() {
    let w = World::start().await;
    let r = w.rail().await;
    let pane = w.pane(&r.d).await;
    let before = (
        w.touches(&format!("agent:{}", r.d)).await,
        w.touches(&format!("terminal:{pane}")).await,
    );
    let typed = w.settled_typed().await;
    refused(&w.as_agent(&r.m).await, &r.m, &pane).await;
    let after = (
        w.touches(&format!("agent:{}", r.d)).await,
        w.touches(&format!("terminal:{pane}")).await,
    );
    assert_eq!(before, after);
    assert_eq!(w.typed(), typed);
}

#[tokio::test]
async fn b54_an_unknown_id_is_not_found_before_forbidden() {
    let w = World::start().await;
    let r = w.rail().await;
    let as_m = w.as_agent(&r.m).await;
    for (method, params) in reads("99999") {
        let err = as_m.request(method, params).await.expect_err(method);
        assert!(err.to_string().contains("terminal 99999"), "{err}");
        assert!(!err.to_string().contains("not started by"), "{err}");
    }
}
