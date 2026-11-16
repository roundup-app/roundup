//! MC72: the method `machine.remove` sends is one the checked-in schema lists.

use serde_json::Value;

const SCHEMA: &str = include_str!("../schema/herdr-core-0.1.21.json");
const CONN: &str = include_str!("../src/conn.rs");

#[test]
fn mc72_remove_uses_a_method_in_the_pinned_schema() {
    let schema: Value = serde_json::from_str(SCHEMA).unwrap();
    let sent = CONN
        .split("pub async fn machine_rm")
        .nth(1)
        .and_then(|body| body.split('"').nth(1))
        .unwrap();

    assert_eq!(sent, "machine.rm");
    assert!(
        schema["advertised"]
            .as_array()
            .unwrap()
            .iter()
            .any(|method| method == sent)
    );
}

#[tokio::test]
async fn mc72_update_runs_the_cli_with_the_machine_name() {
    use std::os::unix::fs::PermissionsExt;

    let dir = tempfile::tempdir().unwrap();
    let log = dir.path().join("log");
    let fake = dir.path().join("herdr-core");
    std::fs::write(
        &fake,
        format!(
            "#!/bin/sh\necho \"$@\" >> {}\nif [ \"$3\" = bad ]; then echo starting >&2; echo 'ssh: no route' >&2; exit 1; fi\n",
            log.display()
        ),
    )
    .unwrap();
    std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();

    herdr::update_machine(&fake, "box").await.unwrap();
    let failed = herdr::update_machine(&fake, "bad").await.unwrap_err();

    assert_eq!(
        std::fs::read_to_string(&log).unwrap(),
        "machine update box\nmachine update bad\n"
    );
    assert_eq!(failed.to_string(), "ssh: no route");
}

#[test]
fn mc75_only_an_older_version_is_older() {
    assert!(herdr::older("0.1.20", "0.1.21"));
    assert!(!herdr::older("0.1.21", "0.1.21"));
    assert!(!herdr::older("0.2.0", "0.1.21"));
    assert!(!herdr::older("unknown", "0.1.21"));
}
