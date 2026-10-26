use super::*;

const ID: &str = "11111111-1111-4111-8111-111111111111";

fn selected(text: &[u8]) -> (tempfile::TempDir, Launcher, ImportCandidate) {
    let root = tempfile::tempdir().unwrap();
    let path = root
        .path()
        .join("projects/historical")
        .join(format!("{ID}.jsonl"));
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, text).unwrap();
    let launcher = Launcher::new(
        "unused",
        root.path().join("config.json"),
        "rup".into(),
        None,
    );
    let candidate = ImportCandidate {
        source: ID.into(),
        title: "Selected".into(),
        cwd: PathBuf::new(),
        last_activity_ms: 0,
        revision: source_revision(&path.metadata().unwrap()),
    };
    (root, launcher, candidate)
}

#[test]
fn u4251b_foreign_identity_is_refused() {
    let (root, launcher, candidate) =
        selected(b"{\"sessionId\":\"22222222-2222-4222-8222-222222222222\"}\n");
    let revision = candidate.revision.clone();
    let error = launcher
        .read_import_snapshot(root.path(), ID, &revision, 0, Some(candidate))
        .unwrap_err();
    assert!(
        error.message.contains("identity does not match source"),
        "{error:?}"
    );
}

#[test]
fn u3037b_malformed_complete_record_is_refused() {
    for text in [
        b"{broken}\n".as_slice(),
        b"[]\n",
        b"{\"isSidechain\":true}\n",
    ] {
        let (root, launcher, candidate) = selected(text);
        let revision = candidate.revision.clone();
        assert!(
            launcher
                .read_import_snapshot(root.path(), ID, &revision, 0, Some(candidate))
                .is_err()
        );
    }
}

#[test]
fn u3037b_preview_preserves_records_crossing_boundaries() {
    let text = format!(
        "{{\"payload\":\"{}\"}}\n{{\"partial\":",
        "x".repeat(128 * 1024)
    );
    let (root, launcher, candidate) = selected(text.as_bytes());
    let revision = candidate.revision.clone();
    let (_, bytes) = launcher
        .read_import_snapshot(root.path(), ID, &revision, 0, Some(candidate))
        .unwrap();
    assert_eq!(bytes, &text.as_bytes()[..text.find('\n').unwrap() + 1]);
}

#[test]
fn u3037b_preview_bounds_are_explicit() {
    let text = format!("{{\"payload\":\"{}\"}}\n", "x".repeat(8 * 1024 * 1024));
    let (root, launcher, candidate) = selected(text.as_bytes());
    let revision = candidate.revision.clone();
    let error = launcher
        .read_import_snapshot(root.path(), ID, &revision, 0, Some(candidate))
        .unwrap_err();
    assert!(error.message.contains("8 MiB"), "{error:?}");
}
