use std::path::Path;

use desktop::Config;

/// A12a, S1: the App hands its Daemon the `terminal-owner` beside it, and only when it is there.
#[test]
fn a12a_the_app_names_the_terminal_owner_beside_its_executable() {
    let app = tempfile::tempdir().unwrap();
    let exe = app.path().join("roundup");
    let tmp = Path::new("/tmp");
    assert_eq!(
        Config::locate(None, &exe, tmp, 1).unwrap().terminal_owner,
        None
    );
    std::fs::write(app.path().join("terminal-owner"), "").unwrap();
    assert_eq!(
        Config::locate(None, &exe, tmp, 1).unwrap().terminal_owner,
        Some(app.path().join("terminal-owner"))
    );
}
