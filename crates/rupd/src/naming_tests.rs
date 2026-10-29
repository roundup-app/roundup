//! A4688a: global preferences are shared without an App connection.
use super::*;
use crate::tests::{ask, daemon_in};

async fn call(daemon: &Daemon, method: &str, params: Value) -> Value {
    ask(daemon, &json!({"id":1,"method":method,"params":params}).to_string()).await
}

#[tokio::test]
async fn a4688a_saved_off_is_shared_and_survives_reopen() {
    let root = tempfile::tempdir().unwrap();
    let first = root.path().join("projects/first");
    let second = root.path().join("projects/second");
    let a = daemon_in(&first);
    let b = daemon_in(&second);
    let settings = json!({"automaticRenaming":false,"namingGuide":"角色-checks-tests\nKeep exact text"});
    let saved = call(&a,"daemon.setNaming",settings.clone()).await;
    assert!(saved.get("error").is_none(), "{saved}");
    assert_eq!(call(&b,"daemon.getNaming",Value::Null).await["result"], settings);
    drop(a);
    let reopened = daemon_in(&first);
    assert_eq!(call(&reopened,"daemon.getNaming",Value::Null).await["result"], settings);
}

#[tokio::test]
async fn u4688a_blank_guide_preserves_committed_preferences() {
    let root = tempfile::tempdir().unwrap();
    let daemon = daemon_in(root.path());
    let before = call(&daemon,"daemon.getNaming",Value::Null).await;
    assert!(before.get("error").is_none(), "{before}");
    let refused = call(&daemon,"daemon.setNaming",json!({"automaticRenaming":false,"namingGuide":" \n\t"})).await;
    assert_eq!(refused["error"]["code"], code::INVALID_PARAMS);
    assert_eq!(call(&daemon,"daemon.getNaming",Value::Null).await, before);
}
