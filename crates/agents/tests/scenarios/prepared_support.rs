//! Helpers for G2542's prepared-directory tests: enrolled directories, real ecosystem fixtures
//! (Node, Rust, Python) and a filesystem snapshot that proves dependency roots stayed put.

use std::collections::BTreeMap;
use std::os::unix::fs::{MetadataExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::process::Command;

use serde_json::{Value, json};

use crate::common::Fixture;

pub fn git(dir: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .current_dir(dir)
        .args(args)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "git {args:?} in {}: {}",
        dir.display(),
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).trim().to_owned()
}

/// An extra Worktree of the Project's repository, detached at `HEAD` (parked), as a user or a
/// vendor tool leaves it: the Project prepared it before enrolling.
pub fn parked_dir(project: &Path, name: &str) -> PathBuf {
    let path = project.join(".roundup/prepared").join(name);
    git(
        project,
        &["worktree", "add", "-q", "--detach", &path.to_string_lossy()],
    );
    path.canonicalize().unwrap()
}

pub async fn enroll(
    f: &Fixture,
    dirs: &[&Path],
    readiness: &str,
    timeout_ms: u64,
) -> Result<Value, rpc::RpcError> {
    f.call("project.setWorktrees", json!({"on": true, "check": null}))
        .await
        .unwrap();
    f.call(
        "project.setPrepared",
        json!({
            "enrolled": dirs.iter().map(|d| d.to_string_lossy()).collect::<Vec<_>>(),
            "readiness": readiness,
            "timeout_ms": timeout_ms,
            "setup": null,
        }),
    )
    .await
}

/// Every file under `root` with what a create, write, rename or unlink changes: device, inode,
/// size, modification and change times, and link target; directories carry their times too.
pub fn snapshot(root: &Path) -> BTreeMap<PathBuf, String> {
    let mut found = BTreeMap::new();
    let mut pending = vec![root.to_owned()];
    while let Some(dir) = pending.pop() {
        for entry in std::fs::read_dir(&dir).unwrap() {
            let path = entry.unwrap().path();
            let meta = std::fs::symlink_metadata(&path).unwrap();
            let link = std::fs::read_link(&path)
                .map(|t| t.to_string_lossy().into_owned())
                .unwrap_or_default();
            found.insert(
                path.clone(),
                format!(
                    "{}:{}:{}:{}.{}:{}.{}:{link}",
                    meta.dev(),
                    meta.ino(),
                    meta.len(),
                    meta.mtime(),
                    meta.mtime_nsec(),
                    meta.ctime(),
                    meta.ctime_nsec()
                ),
            );
            if meta.is_dir() {
                pending.push(path);
            }
        }
    }
    found.insert(root.to_owned(), {
        let meta = std::fs::symlink_metadata(root).unwrap();
        format!(
            "{}:{}:{}.{}",
            meta.dev(),
            meta.ino(),
            meta.mtime(),
            meta.mtime_nsec()
        )
    });
    found
}

/// The three dependency roots and the local config file a Project keeps ignored.
pub const IGNORED: [&str; 4] = ["node_modules", "target", ".venv", ".env"];

pub fn ignored_snapshot(dir: &Path) -> BTreeMap<PathBuf, String> {
    let mut all = BTreeMap::new();
    for name in IGNORED {
        let path = dir.join(name);
        if path.is_dir() {
            all.extend(snapshot(&path));
        } else if let Ok(meta) = std::fs::symlink_metadata(&path) {
            all.insert(
                path,
                format!(
                    "{}:{}:{}:{}",
                    meta.dev(),
                    meta.ino(),
                    meta.len(),
                    meta.ctime_nsec()
                ),
            );
        }
    }
    all
}

/// Shims for every installer: each records its call in `log` and fails.
pub fn installer_shims(dir: &Path, log: &Path) -> PathBuf {
    let bin = dir.join("shims");
    std::fs::create_dir_all(&bin).unwrap();
    for name in ["npm", "pnpm", "yarn", "pip", "pip3", "uv", "poetry"] {
        let path = bin.join(name);
        std::fs::write(
            &path,
            format!(
                "#!/bin/sh\necho \"{name} $*\" >> '{}'\nexit 1\n",
                log.display()
            ),
        )
        .unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    // `cargo` itself is a legitimate tool; only its fetching and building forms install.
    let real = String::from_utf8(
        Command::new("sh")
            .args(["-c", "command -v cargo"])
            .output()
            .unwrap()
            .stdout,
    )
    .unwrap();
    let path = bin.join("cargo");
    std::fs::write(
        &path,
        format!(
            "#!/bin/sh\ncase \"$1\" in fetch|build|install|add|update|b|run) echo \"cargo $*\" >> '{}'; exit 1;; esac\nexec '{}' \"$@\"\n",
            log.display(),
            real.trim()
        ),
    )
    .unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    bin
}

/// Commit the Project's tracked files: a source file per ecosystem and an ignore file.
pub fn commit_sources(project: &Path) {
    std::fs::write(
        project.join(".gitignore"),
        ".roundup/\nnode_modules/\ntarget/\n.venv/\n.env\nCargo.lock\n",
    )
    .unwrap();
    std::fs::write(project.join("package.json"), "{\"name\":\"fixture\"}\n").unwrap();
    std::fs::write(
        project.join("Cargo.toml"),
        "[package]\nname = \"smoke\"\nversion = \"0.1.0\"\nedition = \"2021\"\n",
    )
    .unwrap();
    std::fs::create_dir_all(project.join("src")).unwrap();
    std::fs::write(
        project.join("src/main.rs"),
        "fn main() { println!(\"rust-ok\"); }\n",
    )
    .unwrap();
    git(project, &["add", "-A"]);
    git(project, &["commit", "-q", "-m", "sources"]);
}

/// Project setup, outside any timing: a real Node module under `node_modules`.
pub fn prepare_node(dir: &Path) {
    let node = dir.join("node_modules/left");
    std::fs::create_dir_all(&node).unwrap();
    std::fs::write(node.join("index.js"), "module.exports = 'node-ok';\n").unwrap();
}

/// A real `venv` (no installer) whose console script names its interpreter by absolute path,
/// so a relocated or copied environment fails.
pub fn prepare_python(dir: &Path) {
    let status = Command::new("python3")
        .args([
            "-m",
            "venv",
            "--without-pip",
            &dir.join(".venv").to_string_lossy(),
        ])
        .status()
        .unwrap();
    assert!(status.success(), "python3 -m venv");
    let lib = std::fs::read_dir(dir.join(".venv/lib"))
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path()
        .join("site-packages");
    std::fs::create_dir_all(lib.join("samplepkg")).unwrap();
    std::fs::write(lib.join("samplepkg/__init__.py"), "VALUE = 'python-ok'\n").unwrap();
    let tool = dir.join(".venv/bin/sample-tool");
    std::fs::write(
        &tool,
        format!(
            "#!{}/.venv/bin/python\nimport samplepkg\nprint(samplepkg.VALUE)\n",
            dir.display()
        ),
    )
    .unwrap();
    std::fs::set_permissions(&tool, std::fs::Permissions::from_mode(0o755)).unwrap();
}

/// A real optimized binary under `target`, compiled from the committed dependency-free source.
pub fn prepare_rust(dir: &Path) {
    std::fs::create_dir_all(dir.join("target/release")).unwrap();
    let status = Command::new("rustc")
        .args([
            "--edition=2021",
            "-O",
            "src/main.rs",
            "-o",
            "target/release/smoke",
        ])
        .current_dir(dir)
        .status()
        .unwrap();
    assert!(status.success(), "rustc fixture");
}

pub fn prepare_env(dir: &Path) {
    std::fs::write(dir.join(".env"), "TOKEN=local-secret\n").unwrap();
}

pub fn prepare_all(dir: &Path, files: usize) {
    prepare_node(dir);
    prepare_python(dir);
    prepare_rust(dir);
    prepare_env(dir);
    pad(dir, files);
}

/// Ignored padding spread over many directories of the three roots, up to `files` ignored files.
pub fn pad(dir: &Path, files: usize) {
    let roots = ["node_modules", "target/debug", ".venv/lib/pad"];
    let per_root = files / roots.len() + 1;
    for root in roots {
        for index in 0..per_root {
            let folder = dir.join(root).join(format!("pkg{:03}", index / 50));
            if index % 50 == 0 {
                std::fs::create_dir_all(&folder).unwrap();
            }
            std::fs::write(
                folder.join(format!("file{index}.dat")),
                format!("{root}{index}"),
            )
            .unwrap();
        }
    }
}

/// The Project's smoke commands, one per ecosystem; each exits 0 only when its environment works,
/// writing no bytecode.
pub const SMOKE_NODE: &str =
    "test \"$(node -e \"process.stdout.write(require('left'))\")\" = node-ok";
pub const SMOKE_RUST: &str = "test \"$(target/release/smoke)\" = rust-ok";
pub const SMOKE_PYTHON: &str =
    "test \"$(PYTHONDONTWRITEBYTECODE=1 .venv/bin/sample-tool)\" = python-ok";
pub const SMOKE_ENV: &str = "grep -q local-secret .env";

pub fn smoke_all() -> String {
    [SMOKE_NODE, SMOKE_RUST, SMOKE_PYTHON, SMOKE_ENV].join(" && ")
}
