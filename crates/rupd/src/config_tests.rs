use super::*;
use contracts::EventData;
use std::time::Duration;

#[test]
fn mc40_bad_value_or_unknown_key_refuses_the_whole_file() {
    let look =
        parse_look(r##"{"mode":"dark","fontSize":14,"colors":{"accent":"#ff0000"}}"##).unwrap();
    assert_eq!(look["mode"], "dark");
    assert_eq!(look["color.accent"], "#ff0000");
    for (file, key) in [
        (r#"{"mode":"dark","zoom":2}"#, "zoom"),
        (r#"{"mode":"purple"}"#, "mode"),
        (r#"{"fontSize":99}"#, "fontSize"),
        (r##"{"colors":{"red":"#fff"}}"##, "colors.red"),
        (r#"{"colors":{"accent":"red"}}"#, "colors.accent"),
    ] {
        assert!(parse_look(file).unwrap_err().starts_with(key), "{file}");
    }
}

#[test]
fn mc41_unknown_name_or_bad_press_refuses_the_file() {
    let keys = parse_keys(r#"{"todo.add":"meta+shift+KeyT"}"#).unwrap();
    assert_eq!(keys["todo.add"], "meta+shift+KeyT");
    for file in [
        r#"{"a":"KeyT"}"#,
        r#"{"a":"shift+meta+KeyT"}"#,
        r#"{"a":3}"#,
        "[]",
    ] {
        assert!(parse_keys(file).is_err(), "{file}");
    }
}

#[tokio::test]
async fn mc40_saved_look_applies_without_restart() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = crate::tests::daemon_in(dir.path());
    let daemon = Arc::new(daemon.with_config(dir.path()));
    let (mut events, _) = daemon.subscribe();
    daemon.config.start(&daemon);
    std::fs::write(dir.path().join("look.json"), r#"{"mode":"light"}"#).unwrap();
    let wait = async {
        loop {
            if matches!(
                events.recv().await.map(|e| e.data),
                Ok(EventData::ConfigChanged)
            ) {
                break;
            }
        }
    };
    tokio::time::timeout(Duration::from_secs(1), wait)
        .await
        .unwrap();
    assert_eq!(daemon.config.state().look["mode"], "light");

    std::fs::write(dir.path().join("look.json"), r#"{"mode":"nope"}"#).unwrap();
    let problem = async {
        loop {
            if let Ok(EventData::ConfigProblem(p)) = events.recv().await.map(|e| e.data) {
                break p;
            }
        }
    };
    let problem = tokio::time::timeout(Duration::from_secs(1), problem)
        .await
        .unwrap();
    assert_eq!(problem.file, "look.json");
    assert_eq!(daemon.config.state().look["mode"], "light");

    std::fs::remove_file(dir.path().join("look.json")).unwrap();
    let removed = async {
        loop {
            if matches!(
                events.recv().await.map(|e| e.data),
                Ok(EventData::ConfigChanged)
            ) {
                break;
            }
        }
    };
    tokio::time::timeout(Duration::from_secs(1), removed)
        .await
        .unwrap();
    assert!(daemon.config.state().look.is_empty());
}

async fn first_problem(
    events: &mut tokio::sync::broadcast::Receiver<contracts::Event>,
) -> contracts::config::ConfigProblem {
    let wait = async {
        loop {
            if let Ok(EventData::ConfigProblem(p)) = events.recv().await.map(|e| e.data) {
                break p;
            }
        }
    };
    tokio::time::timeout(Duration::from_secs(2), wait)
        .await
        .unwrap()
}

#[tokio::test]
async fn mc44_first_start_writes_the_agents_md() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = Arc::new(crate::tests::daemon_in(dir.path()).with_config(dir.path()));
    daemon.config.start(&daemon);
    assert_eq!(
        std::fs::read_to_string(dir.path().join("AGENTS.md")).unwrap(),
        AGENTS_MD
    );
}

#[tokio::test]
async fn mc44_a_later_start_keeps_the_users_edits() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("AGENTS.md"), "mine").unwrap();
    let daemon = Arc::new(crate::tests::daemon_in(dir.path()).with_config(dir.path()));
    daemon.config.start(&daemon);
    assert_eq!(
        std::fs::read_to_string(dir.path().join("AGENTS.md")).unwrap(),
        "mine"
    );
}

#[test]
fn mc44_the_file_names_each_part_and_the_limits() {
    for part in ["look.json", "keys.json", "extensions/", "door.md"] {
        assert!(AGENTS_MD.contains(part), "{part}");
    }
    for kind in ["attention rules", "second surface or an interruption"] {
        assert!(AGENTS_MD.contains(kind), "{kind}");
    }
    assert!(AGENTS_MD.contains("config.problem"));
}

#[test]
fn mc45_a_file_naming_an_attention_key_is_refused_whole() {
    for (file, key) in [
        (r#"{"mode":"dark","alertLevel":"all"}"#, "alertLevel"),
        (r##"{"mode":"dark","colors":{"alert":"#fff"}}"##, "alert"),
        (r#"{"centre":"todo"}"#, "centre"),
        (r#"{"shelfFollowsRail":false}"#, "shelfFollowsRail"),
    ] {
        let cause = parse_look(file).unwrap_err();
        assert!(cause.starts_with(key), "{cause}");
        assert!(
            cause.contains("attention rules are not customisable"),
            "{cause}"
        );
    }
    for name in [
        "rail.setAlertLevel",
        "message.send",
        "route.set",
        "held.release",
    ] {
        let file = format!(r#"{{"todo.add":"meta+KeyT","{name}":"meta+KeyY"}}"#);
        let cause = parse_keys(&file).unwrap_err();
        assert!(cause.starts_with(name), "{cause}");
    }
    assert!(parse_keys(r#"{"rail.select":"meta+KeyJ","trail.go":"meta+KeyK"}"#).is_ok());
}

#[tokio::test]
async fn mc45_the_refusal_is_loud_and_applies_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = Arc::new(crate::tests::daemon_in(dir.path()).with_config(dir.path()));
    let (mut events, _) = daemon.subscribe();
    daemon.config.start(&daemon);
    std::fs::write(dir.path().join("look.json"), r#"{"mode":"light"}"#).unwrap();
    let applied = async {
        while !matches!(
            events.recv().await.map(|e| e.data),
            Ok(EventData::ConfigChanged)
        ) {}
    };
    tokio::time::timeout(Duration::from_secs(2), applied)
        .await
        .unwrap();
    std::fs::write(
        dir.path().join("look.json"),
        r#"{"mode":"dark","alertLevel":"all"}"#,
    )
    .unwrap();
    let problem = first_problem(&mut events).await;
    assert_eq!(problem.file, "look.json");
    assert_eq!(
        problem.cause,
        "alertLevel: attention rules are not customisable"
    );
    assert_eq!(daemon.config.state().look["mode"], "light");
}

#[test]
fn mc46_a_request_for_a_second_surface_or_interrupt_is_refused() {
    for (file, key) in [
        (r#"{"prPanel":true}"#, "prPanel"),
        (r#"{"machine-sidebar":true}"#, "machine-sidebar"),
        (r#"{"bell":"finish"}"#, "bell"),
        (r#"{"osNotification":true}"#, "osNotification"),
        (r##"{"colors":{"badge":"#fff"}}"##, "badge"),
        (r#"{"toast":1}"#, "toast"),
    ] {
        let cause = parse_look(file).unwrap_err();
        assert!(cause.starts_with(key), "{cause}");
        assert!(
            cause.contains("second surface or an interruption"),
            "{cause}"
        );
    }
}
