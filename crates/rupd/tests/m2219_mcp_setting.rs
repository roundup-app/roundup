//! M2219: the MCP setting a Project holds, and how `ROUNDUP_MCP` overrides it.

use std::ffi::OsStr;
use std::sync::Arc;

use rpc::Client;
use serde_json::{Value, json};
use tokio::net::UnixListener;

async fn on(client: &Client) -> bool {
    client.request("project.get", Value::Null).await.unwrap()["mcp"]["on"]
        .as_bool()
        .unwrap()
}

#[tokio::test]
async fn m2219_the_setting_resolves_from_the_environment_then_the_project() {
    let dir = tempfile::tempdir().unwrap();
    let roundup = dir.path().join(".roundup");
    let mut seen = Vec::new();
    for round in 0..2 {
        let socket = dir.path().join(format!("rupd{round}.sock"));
        let daemon = Arc::new(rupd::Daemon::open(&roundup).unwrap());
        tokio::spawn(rupd::serve(UnixListener::bind(&socket).unwrap(), daemon));
        let client = Client::connect(&socket).await.unwrap();
        if round == 0 {
            assert!(on(&client).await, "a Project that never set it reads on");
            let set = client
                .request("project.setMcp", json!({ "on": false }))
                .await;
            assert_eq!(set.unwrap(), Value::Null);
        }
        seen.push(on(&client).await);
    }
    // The value survived the Daemon restart.
    assert_eq!(seen, [false, false]);

    let off = Some(OsStr::new("off"));
    assert!(!agents::mcp_on(off, true), "the environment wins over on");
    assert!(!agents::mcp_on(off, false));
    assert!(agents::mcp_on(None, true));
    assert!(
        !agents::mcp_on(None, false),
        "the Project's own value holds"
    );
    for other in ["on", "OFF", "", "0"] {
        assert!(agents::mcp_on(Some(OsStr::new(other)), true), "{other}");
    }
}
