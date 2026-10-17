#[path = "../../rup/tests/common/d9_fixture.rs"]
mod fixture;

use desktop::{AppState, Config, build};
use serde_json::{Value, json};
use std::path::Path;
use std::time::Duration;
use tauri::Manager;
use tauri::test::{mock_builder, mock_context, noop_assets};

#[test]
fn d9_the_app_shared_client_is_not_held_by_clear() {
    let fixture = fixture::Fixture::new(120000);
    let mut config = Config::locate(
        Some(fixture.wrapper.clone().into_os_string()),
        Path::new("/unused/roundup"),
        fixture.dir.path(),
        std::process::id(),
    )
    .unwrap();
    assert_eq!(config.call_bound, desktop::CALL_BOUND);
    config.data_dir = Some(fixture.dir.path().join("data"));
    let app = build(mock_builder(), config, None, |_, _| panic!("App exited"))
        .build(mock_context(noop_assets()))
        .unwrap();
    let state = app.state::<AppState>();
    tauri::async_runtime::block_on(async {
        state
            .open_project(app.handle(), &fixture.project)
            .await
            .unwrap();
        let path = fixture.project.to_str().unwrap();
        let ws = state
            .rpc(
                path,
                "rail.createWorkstream",
                json!({"name":"D9", "parent":null}),
            )
            .await
            .unwrap()["id"]
            .as_str()
            .unwrap()
            .to_owned();
        state
            .rpc(path, "rail.startDoor", json!({"id":ws}))
            .await
            .unwrap();
        fixture
            .ready(async || state.rpc(path, "rail.tree", Value::Null).await.unwrap())
            .await;
        let (clear, tree) = tokio::join!(
            tokio::time::timeout(
                Duration::from_secs(1),
                state.rpc(path, "workstream.clear", json!({"id":ws,"reason":"D9"}))
            ),
            tokio::time::timeout(
                Duration::from_secs(1),
                state.rpc(path, "rail.tree", Value::Null)
            )
        );
        assert_eq!(clear.unwrap().unwrap(), json!({"pending":true}));
        assert!(!tree.unwrap().unwrap().as_array().unwrap().is_empty());
        fixture.received().await;
        let tree = tokio::time::timeout(
            Duration::from_secs(1),
            state.rpc(path, "rail.tree", Value::Null),
        )
        .await
        .unwrap()
        .unwrap();
        assert!(tree.as_array().unwrap().iter().any(|node| node["id"] == ws));
        state.close_project(path).unwrap();
    });
}
