//! P15/P2544d: guarded Pad edits through the built CLI.
use super::*;

#[tokio::test]
async fn p2544d_cli_write_accepts_revision_guard() {
    for guard in ["--expected-revision", "--expected-incarnation"] {
        let project = start_daemon().await;
        let run = on(&project.socket);
        let created = run
            .rup(&["pad", "create", "notes", "--text", "original", "--json"])
            .await;
        assert_eq!(code(&created), 0, "{}", err(&created));
        let created: Value = serde_json::from_str(&out(&created)).unwrap();
        let incarnation = created["incarnation"].as_str().unwrap();
        let current = if guard == "--expected-revision" {
            "1"
        } else {
            incarnation
        };
        let winner = run
            .rup(&["pad", "write", "notes", "winner", guard, current, "--json"])
            .await;
        assert_eq!(code(&winner), 0, "{}", err(&winner));
        assert!(err(&winner).is_empty());
        let winner: Value = serde_json::from_str(&out(&winner)).unwrap();
        assert_eq!(winner["text"], "winner");
        assert_eq!(winner["revision"], 2);
        assert_eq!(winner["incarnation"], incarnation);
        let stale = if guard == "--expected-revision" {
            "1"
        } else {
            "different-creation"
        };
        let rejected = run
            .rup(&["pad", "write", "notes", "loser", guard, stale, "--json"])
            .await;
        assert_eq!(code(&rejected), 1, "{}", err(&rejected));
        assert!(out(&rejected).is_empty());
        assert!(err(&rejected).contains("CONFLICT"), "{}", err(&rejected));
        if guard == "--expected-revision" {
            assert!(err(&rejected).contains("revision 2"));
        }
        let read: Value =
            serde_json::from_str(&out(&run.rup(&["pad", "read", "notes", "--json"]).await))
                .unwrap();
        assert_eq!(read, winner);
    }
}

#[tokio::test]
async fn p15_cli_append_section_text_from_stdin_and_exit_codes() {
    for text in ["Added", "-"] {
        let project = start_daemon().await;
        let run = on(&project.socket).acting_as(Some("audit"));
        assert_eq!(
            code(
                &run.rup(&["pad", "create", "notes", "--text", "## Plan\nOriginal"])
                    .await
            ),
            0
        );
        let run = run.with_stdin("Added\nSecond line\n".as_bytes());
        let appended = run
            .rup(&[
                "--agent",
                "audit",
                "--json",
                "pad",
                "append-section",
                "notes",
                "Plan",
                text,
                "--expected-revision",
                "1",
            ])
            .await;
        assert_eq!(code(&appended), 0, "{}", err(&appended));
        assert!(err(&appended).is_empty());
        let appended: Value = serde_json::from_str(&out(&appended)).unwrap();
        let expected = if text == "-" {
            "## Plan\nOriginal\nAdded\nSecond line"
        } else {
            "## Plan\nOriginal\nAdded"
        };
        assert_eq!(appended["text"], expected);
        assert_eq!(appended["revision"], 2);
        let read = run.rup(&["pad", "read", "notes", "--json"]).await;
        assert_eq!(
            serde_json::from_str::<Value>(&out(&read)).unwrap(),
            appended
        );
        for (tail, exit, diagnostic) in [
            (
                vec!["Plan", "loser", "--expected-revision", "1"],
                1,
                "CONFLICT",
            ),
            (
                vec!["Missing", "loser", "--expected-revision", "2"],
                1,
                "INVALID_PARAMS",
            ),
            (
                vec!["Plan", "loser", "--expected-revision"],
                2,
                "--expected-revision",
            ),
            (
                vec!["Plan", "loser", "--expected-revision", "bad"],
                2,
                "--expected-revision",
            ),
            (vec!["Plan", "loser", "--unknown"], 2, "--unknown"),
            (vec!["Plan", "--expected-revision", "2"], 2, "text"),
        ] {
            let mut args = vec!["--json", "pad", "append-section", "notes"];
            args.extend(tail);
            let rejected = run.rup(&args).await;
            assert_eq!(code(&rejected), exit, "{args:?}: {}", err(&rejected));
            assert!(out(&rejected).is_empty());
            assert!(err(&rejected).contains(diagnostic), "{}", err(&rejected));
            if diagnostic == "CONFLICT" {
                assert!(err(&rejected).contains("revision 2"));
            }
            let read = run.rup(&["pad", "read", "notes", "--json"]).await;
            assert_eq!(
                serde_json::from_str::<Value>(&out(&read)).unwrap(),
                appended
            );
        }
    }
}
