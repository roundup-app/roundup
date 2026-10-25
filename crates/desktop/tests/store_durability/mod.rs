//! U3787f's native prerequisite only; nine-family migration is #4023.
use serde_json::{Value, json};
use std::{fs, path::Path};
use tauri::test::{MockRuntime, mock_builder, mock_context, noop_assets};
use tauri_plugin_store::{StoreBuilder, StoreExt};

const COMMITTED: &[u8] = br#"{"draft":{"project":"/original/project","recipient":"agent-original","revision":7,"text":"newer committed work\n\u96ea"}}"#;
const LEGACY: &[u8] = br#"{"project":"/original/project","recipient":"agent-original","revision":3,"text":"older legacy work"}"#;

fn test_app(dir: &Path) -> tauri::App<MockRuntime> {
    let mut context = mock_context(noop_assets());
    context.config_mut().app.app_directories_override = Some(
        tauri::utils::config::AppDirectoriesOverride::Root(dir.to_path_buf()),
    );
    mock_builder()
        .plugin(tauri_plugin_store::Builder::default().build())
        .build(context)
        .unwrap()
}

fn seed(dir: &Path) {
    fs::write(dir.join("records.json"), COMMITTED).unwrap();
    fs::write(dir.join("legacy.json"), LEGACY).unwrap();
}

fn preserved(dir: &Path) {
    assert_eq!(fs::read(dir.join("records.json")).unwrap(), COMMITTED);
    assert_eq!(fs::read(dir.join("legacy.json")).unwrap(), LEGACY);
    let app = test_app(dir);
    let store = app
        .store_builder("records.json")
        .disable_auto_save()
        .build()
        .unwrap();
    let committed: Value = serde_json::from_slice(COMMITTED).unwrap();
    assert_eq!(store.get("draft"), Some(committed["draft"].clone()));
}

pub fn u3787f_interrupted_migration_preserves_both_stores_native_reopen() {
    let dir = tempfile::tempdir().unwrap();
    seed(dir.path());
    {
        let app = test_app(dir.path());
        let store = app.store_builder("records.json").build().unwrap();
        assert_eq!(store.get("draft").unwrap()["revision"], 7);
        store.set("draft", json!({"project":"/original/project", "recipient":"agent-original", "revision":8, "text":"exact newer text\n雪"}));
        store.save().unwrap();
        let disk: Value =
            serde_json::from_slice(&fs::read(dir.path().join("records.json")).unwrap()).unwrap();
        assert_eq!(disk["draft"]["revision"], 8);
        assert_eq!(disk["draft"]["text"], "exact newer text\n雪");
    }
    let app = test_app(dir.path());
    let store = app.store_builder("records.json").build().unwrap();
    assert_eq!(
        store.get("draft"),
        Some(
            json!({"project":"/original/project", "recipient":"agent-original", "revision":8, "text":"exact newer text\n雪"})
        )
    );
    store.set("draft", json!({"revision":9})); // No explicit acknowledgement: reopen must still see 8.
    drop(store);
    drop(app);
    let app = test_app(dir.path());
    assert_eq!(
        app.store_builder("records.json")
            .build()
            .unwrap()
            .get("draft")
            .unwrap()["revision"],
        8
    );
    assert_eq!(fs::read(dir.path().join("legacy.json")).unwrap(), LEGACY);
}

pub fn u3787f_failed_migration_keeps_recovery_native_invalid_existing() {
    let dir = tempfile::tempdir().unwrap();
    let app = test_app(dir.path());
    // A genuinely absent file may use defaults.
    assert_eq!(
        app.store_builder("absent.json")
            .disable_auto_save()
            .default("seed", 1)
            .build()
            .unwrap()
            .get("seed"),
        Some(json!(1))
    );
    for bytes in [b"{invalid".as_slice(), b"[]", b"", b"{\"draft\":"] {
        fs::write(dir.path().join("invalid.json"), bytes).unwrap();
        for override_defaults in [false, true] {
            for _ in 0..2 {
                let mut builder = app
                    .store_builder("invalid.json")
                    .disable_auto_save()
                    .default("seed", 1);
                if override_defaults {
                    builder = builder.override_defaults();
                }
                let error = match builder.build() {
                    Ok(_) => panic!("invalid existing file became defaults"),
                    Err(error) => error.to_string(),
                };
                assert!(
                    error.contains("load") && error.contains("invalid.json"),
                    "{error}"
                );
                assert!(error.contains("line") || error.contains("EOF"), "{error}");
                assert!(app.get_store("invalid.json").is_none());
                assert_eq!(fs::read(dir.path().join("invalid.json")).unwrap(), bytes);
            }
        }
    }
    fs::create_dir(dir.path().join("unreadable.json")).unwrap();
    let error = match app
        .store_builder("unreadable.json")
        .disable_auto_save()
        .build()
    {
        Ok(_) => panic!("unreadable path became defaults"),
        Err(e) => e.to_string(),
    };
    assert!(
        error.contains("load") && error.contains("directory"),
        "{error}"
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::{PermissionsExt, symlink};
        let path = dir.path().join("denied.json");
        fs::write(&path, COMMITTED).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o000)).unwrap();
        let result = app.store_builder("denied.json").build();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        let error = match result {
            Ok(_) => panic!("unreadable file became defaults"),
            Err(e) => e.to_string(),
        };
        assert!(
            error.contains("load") && error.contains("Permission denied"),
            "{error}"
        );
        assert_eq!(fs::read(&path).unwrap(), COMMITTED);
        symlink("missing.json", dir.path().join("dangling.json")).unwrap();
        assert!(app.store_builder("dangling.json").build().is_err());
        assert!(dir.path().join("dangling.json").is_symlink());
    }
    // Explicit repair of the bytes permits a retry; a failed load registered no defaults.
    fs::write(dir.path().join("invalid.json"), COMMITTED).unwrap();
    assert_eq!(
        app.store_builder("invalid.json")
            .disable_auto_save()
            .build()
            .unwrap()
            .get("draft")
            .unwrap()["revision"],
        7
    );
}

pub fn u3787f_failed_migration_keeps_recovery_native_serialization() {
    let dir = tempfile::tempdir().unwrap();
    seed(dir.path());
    let app = test_app(dir.path());
    let store = app
        .store_builder("records.json")
        .disable_auto_save()
        .serialize(|_| Err(std::io::Error::other("fixture serialization refusal").into()))
        .build()
        .unwrap();
    store.set("draft", json!({"revision":8}));
    let error = store.save().unwrap_err().to_string();
    assert!(
        error.contains("serialize") && error.contains("fixture serialization refusal"),
        "{error}"
    );
    assert_eq!(store.get("draft"), Some(json!({"revision":8})));
    preserved(dir.path());
}

fn child_save(dir: &Path, builder: StoreBuilder<MockRuntime>) {
    let store = builder.disable_auto_save().build().unwrap();
    store.set("draft", json!({"project":"/original/project", "recipient":"agent-original", "revision":8, "text":"x".repeat(8192)}));
    let error = store
        .save()
        .expect_err("the filesystem fault must refuse acknowledgement")
        .to_string();
    assert!(
        error.contains("save")
            || error.contains("write")
            || error.contains("commit")
            || error.contains("read back"),
        "{error}"
    );
    assert_eq!(store.get("draft").unwrap()["revision"], 8);
    // No private contents are printed by the plugin or this observer.
    println!("save refused: {error}");
    assert_eq!(fs::read(dir.join("legacy.json")).unwrap(), LEGACY);
}

pub fn u3787f_failed_migration_keeps_recovery_native_partial_write() {
    const NAME: &str = "u3787f_failed_migration_keeps_recovery_native_partial_write";
    if let Some(dir) = std::env::var_os("ROUNDUP_STORE_CHILD") {
        let dir = Path::new(&dir);
        let app = test_app(dir);
        child_save(dir, app.store_builder("records.json"));
        return;
    }
    let dir = tempfile::tempdir().unwrap();
    seed(dir.path());
    // Limit only this child. The OS allows a real partial write, then returns EFBIG.
    let output = std::process::Command::new("python3").args(["-c", "import os,resource,signal,sys; signal.signal(signal.SIGXFSZ,signal.SIG_IGN); resource.setrlimit(resource.RLIMIT_FSIZE,(128,128)); os.execv(sys.argv[1],sys.argv[1:])"])
        .arg(std::env::current_exe().unwrap()).args(["--exact", NAME])
        .env("ROUNDUP_STORE_CHILD", dir.path()).output().unwrap();
    preserved(dir.path());
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(String::from_utf8_lossy(&output.stdout).contains("save refused"));
}

#[cfg(target_os = "linux")]
fn traced_save(name: &str, interrupt: bool) {
    use std::{
        io::{BufRead, BufReader},
        process::{Command, Stdio},
        time::Duration,
    };
    if let Some(dir) = std::env::var_os("ROUNDUP_STORE_CHILD") {
        let dir = Path::new(&dir);
        let app = test_app(dir);
        child_save(
            dir,
            app.store_builder("records.json").serialize(|cache| {
                let dir = std::env::var_os("ROUNDUP_STORE_CHILD").unwrap();
                fs::write(Path::new(&dir).join("pid"), std::process::id().to_string())?;
                serde_json::to_vec(cache).map_err(Into::into)
            }),
        );
        return;
    }
    let dir = tempfile::tempdir().unwrap();
    seed(dir.path());
    let fault = if interrupt {
        "error=EINTR:signal=SIGSTOP"
    } else {
        "error=EIO"
    };
    let mut command = Command::new("strace");
    command
        .args([
            "-f",
            "-e",
            "trace=rename,renameat,renameat2",
            "-e",
            &format!("inject=rename,renameat,renameat2:{fault}"),
        ])
        .arg(std::env::current_exe().unwrap())
        .args(["--exact", name])
        .env("ROUNDUP_STORE_CHILD", dir.path());
    if interrupt {
        let mut child = command.stderr(Stdio::piped()).spawn().unwrap();
        let stderr = child.stderr.take().unwrap();
        let (ready, receiver) = std::sync::mpsc::channel();
        let observer = std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines() {
                if line.unwrap().contains("SIGSTOP") {
                    ready.send(()).unwrap();
                    return;
                }
            }
        });
        // Wait for the actual syscall stop, never elapsed time or a guessed stage.
        let reached_commit = receiver.recv_timeout(Duration::from_secs(10));
        if let Ok(pid) = fs::read_to_string(dir.path().join("pid")) {
            assert!(
                Command::new("kill")
                    .args(["-KILL", &pid])
                    .status()
                    .unwrap()
                    .success()
            );
        }
        if reached_commit.is_err() {
            let _ = child.kill();
        }
        assert!(!child.wait().unwrap().success());
        observer.join().unwrap();
        reached_commit.expect("save reached the replacement syscall before interruption");
    } else {
        let output = command.output().unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(String::from_utf8_lossy(&output.stderr).contains("EIO"));
    }
    preserved(dir.path());
}

#[cfg(target_os = "linux")]
pub fn u3787f_failed_migration_keeps_recovery_native_commit() {
    traced_save(
        "u3787f_failed_migration_keeps_recovery_native_commit",
        false,
    );
}

#[cfg(target_os = "linux")]
pub fn u3787f_interrupted_migration_preserves_both_stores_native_before_commit() {
    traced_save(
        "u3787f_interrupted_migration_preserves_both_stores_native_before_commit",
        true,
    );
}

#[cfg(target_os = "linux")]
pub fn u3787f_failed_migration_keeps_recovery_native_readback() {
    const NAME: &str = "u3787f_failed_migration_keeps_recovery_native_readback";
    if let Some(dir) = std::env::var_os("ROUNDUP_STORE_CHILD") {
        let dir = Path::new(&dir);
        let app = test_app(dir);
        // Skip the opening read so the injected EIO selects only independent readback.
        child_save(dir, app.store_builder("records.json").create_new());
        return;
    }
    let dir = tempfile::tempdir().unwrap();
    seed(dir.path());
    let trace = dir.path().join("trace");
    let output = std::process::Command::new("strace")
        .args(["-f", "-o"])
        .arg(&trace)
        .arg("-P")
        .arg(dir.path().join("records.json"))
        .args(["-e", "trace=read", "-e", "inject=read:error=EIO:when=1"])
        .arg(std::env::current_exe().unwrap())
        .args(["--exact", NAME])
        .env("ROUNDUP_STORE_CHILD", dir.path())
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(fs::read_to_string(trace).unwrap().contains("EIO"));
    assert!(String::from_utf8_lossy(&output.stdout).contains("read back"));
    // Replacement already committed: no acknowledgement, but valid new records remain recoverable.
    let app = test_app(dir.path());
    let store = app
        .store_builder("records.json")
        .disable_auto_save()
        .build()
        .unwrap();
    assert_eq!(store.get("draft").unwrap()["revision"], 8);
    assert_eq!(fs::read(dir.path().join("legacy.json")).unwrap(), LEGACY);
}
