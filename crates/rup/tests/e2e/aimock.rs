//! The model boundary shared by real-Claude integration tests; no Claude behaviour lives here.
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

pub const KEY: &str = "sk-mock-key-000000000000000000000001";

pub struct Model {
    child: Child,
    pub url: String,
}

pub fn package_bin(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../node_modules/.bin")
        .join(name)
}

impl Model {
    pub fn start(fixture: &str) -> Self {
        Self::start_at(
            &Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("tests/e2e/fixtures")
                .join(format!("{fixture}.json")),
        )
    }

    pub fn start_at(fixture: &Path) -> Self {
        let port = std::net::TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        let child = Command::new(package_bin("llmock"))
            .env("AIMOCK_API_KEYS", KEY)
            .args(["--port", &port.to_string(), "--host", "127.0.0.1"])
            .args([
                "--strict",
                "--validate-on-load",
                "--strict-tool-arguments",
                "--journal-max",
                "0",
                "--log-level",
                "warn",
                "--fixtures",
            ])
            .arg(
                Path::new(env!("CARGO_MANIFEST_DIR"))
                    .join("../rup/tests/e2e/fixtures/rail_rename_note.json"),
            )
            .arg("--fixtures")
            .arg(fixture)
            .stdout(Stdio::null())
            .spawn()
            .expect("pinned aimock starts after pnpm install");
        let mut model = Self {
            child,
            url: format!("http://127.0.0.1:{port}"),
        };
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            assert!(
                model.child.try_wait().unwrap().is_none(),
                "aimock exited during startup"
            );
            if model.get("health").is_some() {
                return model;
            }
            assert!(Instant::now() < deadline, "aimock health deadline");
            std::thread::sleep(Duration::from_millis(25));
        }
    }

    fn get(&self, resource: &str) -> Option<Value> {
        let output = Command::new("curl")
            .args(["-sf", "--max-time", "2", "--noproxy", "*", "-H"])
            .arg(format!("x-api-key: {KEY}"))
            .arg(format!("{}/__aimock/{resource}", self.url))
            .output()
            .unwrap();
        output
            .status
            .success()
            .then(|| serde_json::from_slice(&output.stdout).unwrap())
    }

    pub fn journal(&self) -> Vec<Value> {
        serde_json::from_value(self.get("journal").expect("aimock journal answers")).unwrap()
    }
}

impl Drop for Model {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl Model {
    pub fn assert_matched(&self) {
        let journal = self.journal();
        assert!(!journal.is_empty(), "real Claude made no model request");
        assert!(
            journal
                .iter()
                .all(|e| !e["response"]["fixture"].is_null() && e["response"]["status"] == 200),
            "unmatched or failed aimock request: {journal:#?}"
        );
    }

    pub async fn tool_result(&self, id: &str) -> Value {
        tokio::time::timeout(Duration::from_secs(30), async {
            loop {
                let journal = self.journal();
                assert!(
                    journal
                        .iter()
                        .all(|e| !e["response"]["fixture"].is_null()
                            && e["response"]["status"] == 200),
                    "unmatched or failed aimock request: {journal:#?}"
                );
                if let Some(result) = journal.iter().find_map(|e| {
                    e["body"]["messages"]
                        .as_array()?
                        .iter()
                        .find(|m| m["role"] == "tool" && m["tool_call_id"] == id)
                        .cloned()
                }) {
                    return result;
                }
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
        })
        .await
        .unwrap_or_else(|_| panic!("missing tool result {id}: {:#?}", self.journal()))
    }
}

/// The pinned Claude behind the model route: `ANTHROPIC_BASE_URL` and no outside traffic. The Launcher
/// strips `ANTHROPIC_BASE_URL` from a child's environment (A30) and a lean child (LC2) reads none of the
/// user's `env` setting, so only a program in front of Claude can carry the route: the model's URL
/// comes from `AIMOCK_URL` in the Daemon's environment.
pub fn routed_claude(dir: &Path) -> PathBuf {
    use std::os::unix::fs::PermissionsExt;
    let path = dir.join("claude-routed");
    std::fs::write(
        &path,
        format!(
            "#!/bin/sh\nexport ANTHROPIC_BASE_URL=\"$AIMOCK_URL\" CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 DISABLE_AUTOUPDATER=1 CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL=1 CLAUDE_CODE_MAX_RETRIES=0\nexec '{}' \"$@\"\n",
            package_bin("claude").display()
        ),
    )
    .unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    path
}

pub fn configure(config: &Path, cwd: &Path) {
    use serde_json::json;
    std::fs::create_dir_all(config).unwrap();
    let settings = json!({
        "apiKeyHelper": "printf sk-mock-key-000000000000000000000001",
    });
    std::fs::write(config.join("settings.json"), settings.to_string()).unwrap();
    // A lean child (LC2) reads no user `permissions.defaultMode`; the Project's settings pin it.
    std::fs::create_dir_all(cwd.join(".claude")).unwrap();
    std::fs::write(
        cwd.join(".claude/settings.json"),
        json!({"permissions": {"defaultMode": "default"}}).to_string(),
    )
    .unwrap();
    let mut state = json!({
        "hasCompletedOnboarding": true,
        "theme": "dark",
        "lastOnboardingVersion": "2.1.300",
        "lastReleaseNotesSeen": "2.1.300",
        "customApiKeyResponses": {"approved": ["00000000000000000001"], "rejected": []},
        "hasSeenAutoDefaultNudge": true,
        "hasResetAutoModeOptInForDefaultOffer": true,
        "hasSeenAutoModeEntryWarning": true,
        "projects": {}
    });
    for path in [cwd.to_path_buf(), cwd.canonicalize().unwrap()] {
        state["projects"][path.to_str().unwrap()] = json!({"hasTrustDialogAccepted": true});
    }
    std::fs::write(config.join(".claude.json"), state.to_string()).unwrap();
}

/// A launch gate in front of the pinned Claude: it logs each start's argv and the launch settings
/// it saw, creates `held` when `hold` is missing, waits for `hold` (an Agent's start only, never the Daemon's probes), then runs the real program.
/// It scripts nothing of what Claude does.
pub fn launch_wrapper(dir: &Path, hold: &Path, held: &Path, log: &Path) -> PathBuf {
    use std::os::unix::fs::PermissionsExt;
    let path = dir.join("claude-launch");
    let quoted = |path: &Path| serde_json::to_string(path.to_str().unwrap()).unwrap();
    std::fs::write(
        &path,
        format!(
            r#"#!/usr/bin/env python3
import json, os, sys, time
seen = {{n: os.environ[n] for n in ("ANTHROPIC_MODEL", "CLAUDE_CODE_EFFORT_LEVEL") if n in os.environ}}
with open({log}, "a") as log:
    log.write(json.dumps({{"argv": sys.argv[1:], "env": seen, "functionHooks": os.environ.get("CLAUDE_CODE_ENABLE_FUNCTION_HOOKS")}}) + "\n")
if sys.argv[1:2] == ["--settings"]:
    if not os.path.exists({hold}):
        open({held}, "w").close()
    while not os.path.exists({hold}):
        time.sleep(0.02)
claude = {claude}
os.execv(claude, [claude, *sys.argv[1:]])
"#,
            log = quoted(log),
            hold = quoted(hold),
            held = quoted(held),
            claude = quoted(&routed_claude(dir)),
        ),
    )
    .unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    path
}
