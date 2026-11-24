//! U7191h: the Restart hold's TLA+ model, checked with everystate over every order of its faults.
use std::path::Path;
use std::process::Command;

#[test]
fn u7191h_the_restart_hold_model_checks() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let everystate = root.join("node_modules/.bin/everystate");
    if !everystate.is_file() {
        eprintln!("everystate is not installed; run `pnpm install` to check the model");
        return;
    }
    let run = Command::new(&everystate)
        .args([
            "-workers",
            "1",
            "-config",
            "RestartHold.cfg",
            "RestartHold.tla",
        ])
        .current_dir(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/restart_hold"))
        .output()
        .unwrap();
    let out = String::from_utf8_lossy(&run.stdout);
    assert!(
        run.status.success() && out.contains("No error has been found"),
        "{out}{}",
        String::from_utf8_lossy(&run.stderr)
    );
}
