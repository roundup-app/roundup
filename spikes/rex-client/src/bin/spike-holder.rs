//! spike-holder SOCKET STATE OPTIONS: plays a rupd that dies. It creates a block, owns it, streams
//! it, saves what a restart needs to STATE (bytes to STATE.bin), then exits with no close frames.
use std::time::{Duration, Instant};

use rex_client_spike::{Control, Piece, SHELL, Splitter, stream};
use serde_json::{Value, json};

#[tokio::main]
async fn main() -> rex_client_spike::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let (socket, state) = (
        std::path::PathBuf::from(&args[1]),
        std::path::PathBuf::from(&args[2]),
    );
    let options: Value = serde_json::from_str(&args[3])?;
    let control = Control::connect(&socket, "roundup", None).await?;
    let created = control
        .call("session.create", json!({"label":"q7-restart","initial_windows":[{"layout":{"block":{"flavor":SHELL,"options":options}}}]}))
        .await?;
    let session = created["session_id"].as_str().ok_or("session")?.to_owned();
    let block = created["initial_windows"][0]["block_ids"][0]
        .as_str()
        .ok_or("block")?
        .to_owned();
    control
        .call("session.attach", json!({"session_id":session}))
        .await?;
    control
        .call(
            "session.own_block",
            json!({"session_id":session,"block_ids":[block],"mode":"take"}),
        )
        .await?;
    let mut data = stream(&control, &socket, &session, &block).await?;
    control
        .terminal(&session, &block, "write", json!({"data":"g"}))
        .await?;
    tokio::time::sleep(Duration::from_millis(300)).await;
    control
        .terminal(&session, &block, "write", json!({"data":"tick 40 100\r"}))
        .await?;
    let process = control
        .terminal(&session, &block, "process", json!({}))
        .await?;
    let mut splitter = Splitter::new(data.nonce);
    let mut program = Vec::new();
    let deadline = Instant::now() + Duration::from_millis(1500);
    while let Ok(Some(bytes)) = tokio::time::timeout(
        deadline.saturating_duration_since(Instant::now()),
        data.next(),
    )
    .await
    {
        for piece in splitter.push(&bytes) {
            if let Piece::Program(b) = piece {
                program.extend(b)
            }
        }
    }
    std::fs::write(state.with_extension("bin"), &program)?;
    let saved = json!({
        "session": session, "block": block, "client_id": control.client_id(),
        "control_token": control.reconnect_token(), "data_token": data.token.to_vec(),
        "received": data.received, "nonce": data.nonce, "child_pid": process["child"]["pid"],
    });
    std::fs::write(&state, saved.to_string())?;
    // Die as a crash would: the OS closes both sockets, no WebSocket close frame.
    std::process::exit(0);
}
