//! The model boundary shared by real-Claude integration tests; no Claude behaviour lives here.
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};
use serde_json::Value;

pub struct Model {
    child: Child,
    pub url: String,
}

pub fn package_bin(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../node_modules/.bin").join(name)
}

impl Model {
    pub fn start(fixture: &str) -> Self {
        let port = std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/e2e/fixtures").join(format!("{fixture}.json"));
        let child = Command::new(package_bin("llmock"))
            .args(["--port", &port.to_string(), "--host", "127.0.0.1"])
            .args(["--validate-on-load", "--strict-tool-arguments", "--journal-max", "0", "--log-level", "warn", "--fixtures"])
            .arg(fixture).stdout(Stdio::null()).spawn().expect("pinned aimock starts after pnpm install");
        let mut model = Self { child, url: format!("http://127.0.0.1:{port}") };
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            assert!(model.child.try_wait().unwrap().is_none(), "aimock exited during startup");
            if model.get("health").is_some() { return model; }
            assert!(Instant::now() < deadline, "aimock health deadline");
            std::thread::sleep(Duration::from_millis(25));
        }
    }

    fn get(&self, resource: &str) -> Option<Value> {
        let output = Command::new("curl").args(["-sf", "--max-time", "2"])
            .arg(format!("{}/__aimock/{resource}", self.url)).output().unwrap();
        output.status.success().then(|| serde_json::from_slice(&output.stdout).unwrap())
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
