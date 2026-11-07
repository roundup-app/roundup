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
    tokio::time::timeout(Duration::from_secs(1), async {
        while !daemon.config.state().look.is_empty() {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap();
}
