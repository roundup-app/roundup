//! EP5–EP7: an Extension is granted `panel`, `agents.place` and `agents.settings` only by the
//! owner's attested approval of its folder, name and capabilities; its store and Actor are its
//! folder's; `agents.settings` lets it start an Agent with Claude Code settings. Each Extension is
//! a real `node` child of a real `rupd`, with a fake vendor.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]
#[path = "support/rupd_harness.rs"]
mod rupd_harness;

use rpc::Client;
use serde_json::{Value, json};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

struct Fx {
    daemon: rupd_harness::Rupd,
    secret: String,
    project: PathBuf,
    extensions: PathBuf,
    _root: tempfile::TempDir,
}

impl Fx {
    /// A `rupd` whose Extensions folder holds `folders` as `(folder, name, uses)`; the fixture
    /// module of each writes the `hello` it was sent to `hello.json` and has the action
    /// `probe.<folder>`.
    async fn start(folders: &[(&str, &str, &[&str])]) -> Self {
        let root = tempfile::tempdir().unwrap();
        let base = root.path().canonicalize().unwrap();
        let project = base.join("proj");
        let home = base.join("home");
        let extensions = home.join(".roundup/extensions");
        std::fs::create_dir_all(&project).unwrap();
        std::fs::create_dir_all(&extensions).unwrap();
        std::fs::create_dir_all(base.join("data")).unwrap();
        for (folder, name, uses) in folders {
            write_ext(&extensions, &project, folder, name, uses);
        }
        let bin = PathBuf::from(env!("CARGO_BIN_EXE_rupd"));
        let mut daemon = rupd_harness::start(&bin, &project, true, |cmd| {
            cmd.env("HOME", &home)
                .env("ROUNDUP_RUP_BIN", bin.with_file_name("rup"))
                .env(
                    "ROUNDUP_CLAUDE_BIN",
                    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                        .join("../rup/tests/e2e/fake_claude.py"),
                )
                .env("ROUNDUP_SIDECAR_DIR", base.join("unused-sidecar"))
                .env("CLAUDE_CONFIG_DIR", base.join("config"))
                .env("ROUNDUP_DATA_DIR", base.join("data"))
                .env("FAKE_CLAUDE_LAUNCH_LOG", base.join("launches"))
                .arg("--notify-bound")
                .stdout(Stdio::piped());
        });
        let mut line = [0u8; 76];
        daemon
            .child
            .stdout
            .as_mut()
            .unwrap()
            .read_exact(&mut line)
            .unwrap();
        let secret = std::str::from_utf8(&line)
            .unwrap()
            .strip_prefix("rupd-bound ")
            .and_then(|rest| rest.strip_suffix('\n'))
            .unwrap()
            .to_owned();
        Self {
            daemon,
            secret,
            project,
            extensions,
            _root: root,
        }
    }

    /// The folder's manifest and module: the module writes `hello.json` at register, and its
    /// action `probe.<folder>` reads and sets the store, makes a Pad under its Actor and asks
    /// for an Agent with `settings`, writing what it saw to `probe.json`.
    fn write(&self, folder: &str, name: &str, uses: &[&str]) {
        write_ext(&self.extensions, &self.project, folder, name, uses);
    }
}

fn write_ext(extensions: &Path, project: &Path, folder: &str, name: &str, uses: &[&str]) {
    let dir = extensions.join(folder);
    std::fs::create_dir_all(&dir).unwrap();
    let manifest = json!({
        "name": name,
        "module": "index.mjs",
        "permissions": ["store", "pads", "agents"],
        "uses": uses,
    });
    std::fs::write(dir.join("rup-extension.json"), manifest.to_string()).unwrap();
    let module = format!(
        r#"import {{ writeFileSync }} from "node:fs";
const out = (file, value) => writeFileSync(new URL(file, import.meta.url), JSON.stringify(value));
export function register(on, hello) {{
  out("hello.json", hello);
  on("action", {{ name: "probe.{folder}", label: "Probe" }}, async ($) => {{
    const seen = await $.store.get("seen");
    await $.store.set({{ key: "seen", value: "yes" }});
    await $.pads.create({{ name: "pad-of-{folder}" }}).catch(() => {{}});
    let spawned;
    try {{
      spawned = await $.agents.spawn({{ cwd: {cwd}, prompt: "p", settings: {{ env: {{ A: "1" }} }} }});
    }} catch (error) {{
      spawned = {{ error: error.code, message: error.message }};
    }}
    out("probe.json", {{ seen, spawned }});
  }});
}}
"#,
        cwd = json!(project)
    );
    // Written last: the module is what the watcher's fingerprint reads with the manifest.
    std::fs::write(dir.join("index.mjs"), module).unwrap();
}

impl Fx {
    async fn user(&self) -> Client {
        Client::connect(&self.daemon.socket).await.unwrap()
    }

    async fn attested(&self) -> Client {
        let client = self.user().await;
        client
            .request("app.attest", json!({ "secret": self.secret }))
            .await
            .unwrap();
        client
    }

    /// The `hello` the folder's module was last sent, once `granted` is what it says.
    async fn hello_granted(&self, folder: &str, granted: &[&str]) -> Value {
        let file = self.extensions.join(folder).join("hello.json");
        let mut last = String::new();
        for _ in 0..400 {
            if let Ok(text) = std::fs::read_to_string(&file) {
                last = text.clone();
                if let Ok(hello) = serde_json::from_str::<Value>(&text)
                    && hello["granted"] == json!(granted)
                {
                    return hello;
                }
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        let caps = self.user().await.request("extension.capabilities", Value::Null).await;
        panic!("{folder}'s hello never granted {granted:?}; last: {last}; {caps:?}");
    }

    async fn approve(
        &self,
        folder: &str,
        name: &str,
        uses: &[&str],
    ) -> Result<Value, rpc::RpcError> {
        self.attested()
            .await
            .request(
                "extension.approve",
                json!({"dir": folder, "name": name, "uses": uses}),
            )
            .await
    }

    /// Runs `probe.<folder>` as the user and reads what it wrote.
    async fn probe(&self, folder: &str) -> Value {
        let user = self.user().await;
        let name = format!("probe.{folder}");
        let mut ran = Err(rpc::RpcError::internal("not listed"));
        for _ in 0..400 {
            ran = user.request("action.run", json!({ "name": name })).await;
            if ran.is_ok() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        ran.unwrap();
        let text =
            std::fs::read_to_string(self.extensions.join(folder).join("probe.json")).unwrap();
        serde_json::from_str(&text).unwrap()
    }

    async fn agents(&self) -> usize {
        let tree = self
            .user()
            .await
            .request("rail.tree", Value::Null)
            .await
            .unwrap();
        tree.as_array()
            .unwrap()
            .iter()
            .filter(|node| node["kind"] == "agent")
            .count()
    }
}

#[tokio::test]
async fn ep5_an_extension_asking_panel_is_granted_it_only_after_an_attested_approval() {
    let fx = Fx::start(&[("hum", "hum", &["panel"])]).await;
    let hello = fx.hello_granted("hum", &[]).await;
    assert_eq!(
        hello["offers"],
        json!(["panel", "service", "agents.place", "agents.settings"])
    );
    let listed = fx
        .user()
        .await
        .request("extension.capabilities", Value::Null)
        .await
        .unwrap();
    assert_eq!(
        listed,
        json!([{"dir": "hum", "name": "hum", "asked": ["panel"], "granted": [], "waiting": ["panel"]}])
    );
    fx.approve("hum", "hum", &["panel"]).await.unwrap();
    fx.hello_granted("hum", &["panel"]).await;
    let listed = fx
        .user()
        .await
        .request("extension.capabilities", Value::Null)
        .await
        .unwrap();
    assert_eq!(listed[0]["granted"], json!(["panel"]));
    assert_eq!(listed[0]["waiting"], json!([]));
}

#[tokio::test]
async fn ep5_the_approval_call_on_an_unattested_connection_is_forbidden() {
    let fx = Fx::start(&[("hum", "hum", &["panel"])]).await;
    fx.hello_granted("hum", &[]).await;
    let refused = fx
        .user()
        .await
        .request(
            "extension.approve",
            json!({"dir": "hum", "name": "hum", "uses": ["panel"]}),
        )
        .await
        .unwrap_err();
    assert_eq!(refused.code, rpc::code::FORBIDDEN);
    let claimed = fx.user().await;
    claimed
        .request(
            "daemon.identify",
            json!({"actor": {"kind": "ext", "id": "ext:hum", "parent": null}}),
        )
        .await
        .unwrap();
    let refused = claimed
        .request(
            "extension.approve",
            json!({"dir": "hum", "name": "hum", "uses": ["panel"]}),
        )
        .await
        .unwrap_err();
    assert_eq!(refused.code, rpc::code::FORBIDDEN);
    let listed = fx
        .user()
        .await
        .request("extension.capabilities", Value::Null)
        .await
        .unwrap();
    assert_eq!(listed[0]["granted"], json!([]));
}

#[tokio::test]
async fn ep5_adding_a_capability_asks_again_for_all_three() {
    let all = ["panel", "agents.settings"];
    let fx = Fx::start(&[("hum", "hum", &all)]).await;
    fx.hello_granted("hum", &[]).await;
    fx.approve("hum", "hum", &all).await.unwrap();
    fx.hello_granted("hum", &["panel", "agents.settings"]).await;

    fx.write("hum", "hum", &["panel", "agents.place", "agents.settings"]);
    fx.hello_granted("hum", &[]).await;
    let listed = fx
        .user()
        .await
        .request("extension.capabilities", Value::Null)
        .await
        .unwrap();
    assert_eq!(
        listed[0]["waiting"],
        json!(["panel", "agents.place", "agents.settings"])
    );

    let three = ["panel", "agents.place", "agents.settings"];
    fx.approve("hum", "hum", &three).await.unwrap();
    fx.hello_granted("hum", &three).await;

    fx.write("hum", "renamed", &three);
    fx.hello_granted("hum", &[]).await;
}

#[tokio::test]
async fn ep5_service_is_granted_on_declaration() {
    let fx = Fx::start(&[("hum", "hum", &["service", "panel"])]).await;
    fx.hello_granted("hum", &["service"]).await;
}

#[tokio::test]
async fn ep6_a_second_folder_with_the_same_name_gets_its_own_store_actor_and_no_approval() {
    let fx = Fx::start(&[("hum", "hum", &["panel"]), ("humtwo", "hum", &["panel"])]).await;
    fx.hello_granted("hum", &[]).await;
    fx.hello_granted("humtwo", &[]).await;
    fx.approve("hum", "hum", &["panel"]).await.unwrap();
    fx.hello_granted("hum", &["panel"]).await;
    fx.hello_granted("humtwo", &[]).await;

    assert_eq!(fx.probe("hum").await["seen"], Value::Null);
    assert_eq!(fx.probe("hum").await["seen"], "yes");
    assert_eq!(fx.probe("humtwo").await["seen"], Value::Null);

    let user = fx.user().await;
    for (folder, other) in [("hum", "humtwo"), ("humtwo", "hum")] {
        let touched = user
            .request(
                "provenance.touched",
                json!({"actor_id": format!("ext:{folder}")}),
            )
            .await
            .unwrap();
        let items: Vec<&str> = touched
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|touch| touch["item"].as_str())
            .collect();
        assert!(
            items.contains(&format!("pad:pad-of-{folder}").as_str()),
            "{items:?}"
        );
        assert!(
            !items.contains(&format!("pad:pad-of-{other}").as_str()),
            "{items:?}"
        );
    }
    let listed = user
        .request("extension.capabilities", Value::Null)
        .await
        .unwrap();
    let humtwo = listed
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["dir"] == "humtwo")
        .unwrap();
    assert_eq!(humtwo["granted"], json!([]));
}

#[tokio::test]
async fn ep7_spawn_with_settings_starts_for_an_extension_granted_agents_settings() {
    let fx = Fx::start(&[("hum", "hum", &["agents.settings"])]).await;
    fx.hello_granted("hum", &[]).await;
    fx.approve("hum", "hum", &["agents.settings"])
        .await
        .unwrap();
    fx.hello_granted("hum", &["agents.settings"]).await;
    let probed = fx.probe("hum").await;
    assert!(probed["spawned"]["error"].is_null(), "{probed}");
    assert_eq!(fx.agents().await, 1);
}

#[tokio::test]
async fn ep7_spawn_with_settings_from_an_ungranted_extension_is_forbidden_and_starts_nothing() {
    let fx = Fx::start(&[("hum", "hum", &["agents.settings"])]).await;
    fx.hello_granted("hum", &[]).await;
    let probed = fx.probe("hum").await;
    assert_eq!(probed["spawned"]["error"], rpc::code::FORBIDDEN);
    assert_eq!(fx.agents().await, 0);
}
