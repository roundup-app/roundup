//! Z3742n: emitted hook commands retain each shell word without launching a shell.
use agents::claude_code::{Folders, Launcher, Role};
use std::path::Path;

fn prepare(root: &Path, rup: &Path, attempt: &str) -> Result<Vec<String>, rpc::RpcError> {
    std::fs::write(rup, "").unwrap();
    Launcher::new("fake-claude", root.join("claude.json"), rup.into(), None).prepare(
        Folders {
            project: root,
            data: root,
        },
        "7",
        attempt,
        root,
        None,
        Role::Agent,
    )
}

#[test]
fn z3742n_quoted_words_round_trip() {
    let root = tempfile::tempdir().unwrap();
    let rup = root.path().join("rup '雪' ; $(exit 9)");
    for word in ["", "two words", "it's", "雪", "; $(exit 9)\n*?\\\"$HOME"] {
        let argv = prepare(root.path(), &rup, word).unwrap();
        let settings: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&argv[2]).unwrap()).unwrap();
        let hook = settings["hooks"]["Stop"][0]["hooks"][0]["command"]
            .as_str()
            .unwrap();
        assert_eq!(
            shlex::split(hook).unwrap(),
            [
                format!("ROUNDUP_ATTEMPT={word}"),
                rup.to_str().unwrap().to_owned(),
                "signal".into(),
                "7".into()
            ],
        );
    }
}

#[test]
fn z3742n_a_nul_word_cannot_publish_a_hook() {
    let root = tempfile::tempdir().unwrap();
    assert!(prepare(root.path(), &root.path().join("rup"), "unsafe\0suffix").is_err());
}

#[test]
fn z3742n_a_non_utf8_path_cannot_publish_a_substituted_hook() {
    use std::os::unix::ffi::OsStrExt;
    let root = tempfile::tempdir().unwrap();
    let rup = root.path().join(std::ffi::OsStr::from_bytes(b"rup-\xff"));
    assert!(prepare(root.path(), &rup, "1").is_err());
}
