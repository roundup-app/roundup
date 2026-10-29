//! S4: development App preparation and startup refusal.
use std::os::unix::fs::PermissionsExt;
use std::os::unix::process::CommandExt;
use std::path::Path;
use std::process::Command;
use std::time::Duration;
use tempfile::TempDir;

#[test]
fn s4_just_app_refuses_to_start_when_something_already_answers_on_the_dev_port() {
    // A bind failure means another server already holds the port, which is the condition under test.
    let _occupant = std::net::TcpListener::bind("[::1]:5173")
        .ok()
        .inspect(|listener| {
            let listener = listener.try_clone().unwrap();
            std::thread::spawn(move || {
                for mut stream in listener.incoming().flatten() {
                    use std::io::Write;
                    let _ = stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n");
                }
            });
        });
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let project = TempDir::new().unwrap();
    let just = Command::new("just")
        .arg("app")
        .arg(project.path())
        .current_dir(root)
        .process_group(0)
        .stderr(std::process::Stdio::piped())
        .spawn()
        .unwrap();

    let pid = just.id();
    let (done, result) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = done.send(just.wait_with_output());
    });
    let output = result
        .recv_timeout(Duration::from_secs(10))
        .unwrap_or_else(|_| {
            // Without the guard the recipe may open a window; stop this fixture's group.
            let _ = Command::new("kill")
                .arg("--")
                .arg(format!("-{pid}"))
                .status();
            panic!("just app did not refuse within 10 s");
        })
        .unwrap();
    let stderr = String::from_utf8(output.stderr).unwrap();
    assert!(!output.status.success());
    assert!(stderr.contains("already answers on :5173"));
}

fn app_recipe(pnpm: &str, curl: &str) -> std::process::Output {
    let dir = TempDir::new().unwrap();
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    std::fs::copy(root.join("justfile"), dir.path().join("justfile")).unwrap();
    for (name, body) in [
        ("tools/sidecar/bundle.sh", "exit 0"),
        ("curl", curl),
        ("pnpm", pnpm),
        ("cargo", "echo cargo \"$*\" >&2"),
    ] {
        let path = dir.path().join(name);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    Command::new("just")
        .args(["app", "."])
        .current_dir(dir.path())
        .env(
            "PATH",
            format!(
                "{}:{}",
                dir.path().display(),
                std::env::var("PATH").unwrap()
            ),
        )
        .env_remove("CI")
        .output()
        .unwrap()
}

#[test]
fn s4_just_app_installs_noninteractively_before_building() {
    let output = app_recipe(
        "[ \"$CI\" = true ] && [ \"$*\" = 'install --frozen-lockfile' ] || exit 0\necho 'dependency setup failed' >&2\nexit 17",
        "exit 1",
    );
    let stderr = String::from_utf8(output.stderr).unwrap();
    assert!(!output.status.success());
    assert!(stderr.contains("dependency setup failed"), "{stderr}");
    assert!(!stderr.contains("cargo build"), "{stderr}");
}

#[test]
fn s4_just_app_does_not_open_the_window_when_imports_fail() {
    let output = app_recipe(
        "[ \"$1\" = install ] && exit 0\nexec sleep 30",
        "case \"$*\" in *__roundup_ready*) echo 'missing-s4-dependency'; exit 22;; esac\n[ -f answered ] && exit 0\ntouch answered\nexit 1",
    );
    let stderr = String::from_utf8(output.stderr).unwrap();
    assert!(!output.status.success());
    assert!(stderr.contains("webview imports are not ready"), "{stderr}");
    assert!(
        String::from_utf8(output.stdout)
            .unwrap()
            .contains("missing-s4-dependency")
    );
    assert!(!stderr.contains("cargo run"), "{stderr}");
}
