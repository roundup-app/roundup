//! X17: real Claude takes the App's colour scheme.
#[path = "e2e/daemon.rs"]
#[allow(dead_code)]
mod daemon;

use base64::Engine;
use contracts::{EventData, Kind};
use daemon::next;
use serde_json::{Value, json};
use std::time::Duration;

/// Wait for a snapshot that draws `shown` and not `hidden`.
async fn palette_is(client: &rpc::Client, terminal: &str, shown: &str, hidden: &str) {
    let mut last = String::new();
    let waited = tokio::time::timeout(Duration::from_secs(30), async {
        loop {
            last = snapshot_text(client, terminal).await;
            if last.contains(shown) && !last.contains(hidden) {
                return;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    })
    .await;
    assert!(
        waited.is_ok(),
        "Claude never drew {shown} without {hidden}: {last:?}"
    );
}

async fn snapshot_text(client: &rpc::Client, terminal: &str) -> String {
    let snapshot = client
        .request("terminal.snapshot", json!({"id": terminal}))
        .await
        .unwrap();
    let data = base64::engine::general_purpose::STANDARD
        .decode(snapshot["data"].as_str().unwrap())
        .unwrap();
    String::from_utf8_lossy(&data).into_owned()
}

async fn set_scheme(client: &rpc::Client, scheme: &str, background: &str, foreground: &str) {
    client
        .request(
            "terminal.scheme",
            json!({"scheme": scheme, "background": background, "foreground": foreground}),
        )
        .await
        .unwrap();
}

/// The default text colour real Claude draws, as the SGR it puts in the Terminal's snapshot:
/// black in its light palette, white in its dark one.
const LIGHT_TEXT: &str = "38;2;0;0;0m";
const DARK_TEXT: &str = "38;2;255;255;255m";

#[tokio::test]
async fn x17_real_claude_takes_the_apps_scheme_at_start_and_on_a_switch() {
    for (first, then) in [("light", "dark"), ("dark", "light")] {
        let project = daemon::start_real("d2_the_first_prompt_names_the_agent", &[]);
        // Claude asks the terminal for its colours only under the `auto` theme.
        let config = project.dir.path().join("claude-config/.claude.json");
        let mut state: Value =
            serde_json::from_str(&std::fs::read_to_string(&config).unwrap()).unwrap();
        state["theme"] = json!("auto");
        std::fs::write(&config, state.to_string()).unwrap();
        let mut client = project.subscribed().await;
        let colours = |scheme: &str| match scheme {
            "light" => ("#ffffff", "#1d1d1f", LIGHT_TEXT, DARK_TEXT),
            _ => ("#1c1c1e", "#f5f5f7", DARK_TEXT, LIGHT_TEXT),
        };
        let (background, foreground, shown, hidden) = colours(first);
        set_scheme(&client, first, background, foreground).await;
        let agent: contracts::agent::RailNode = serde_json::from_value(
            client
                .request(
                    "agent.spawn",
                    json!({"cwd": project.dir.path(), "name":"scheme-reader", "prompt": "fix the refresh race"}),
                )
                .await
                .unwrap(),
        )
        .unwrap();
        let terminal = agent.terminal_id.clone().unwrap();
        palette_is(&client, &terminal, shown, hidden).await;

        let (background, foreground, shown, hidden) = colours(then);
        set_scheme(&client, then, background, foreground).await;
        palette_is(&client, &terminal, shown, hidden).await;
        // The aimock fixture insists that Claude reached the model before the Daemon stops.
        for kind in [Kind::Working, Kind::Idle] {
            next(&mut client, |event| match event {
                EventData::AgentStatus(status)
                    if status.id == agent.id && status.status.kind == kind =>
                {
                    Some(())
                }
                _ => None,
            })
            .await;
        }
    }
}
