//! spike <q1|q2|...>: one live proof per question of the Rex spike. Prints `PROOF` lines.
use std::collections::BTreeMap;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use agents::claude_code::{Folders, Launcher, Pair, Role};
use contracts::terminal::{CatchUpParams, ReadParams, SearchParams, SpawnParams};
use rex_client_spike::{
    Control, Data, Piece, Result, SHELL, Splitter, block_event, rex, rex_bin, stream, user_socket,
};
use serde_json::{Value, json};

macro_rules! proof {
    ($q:expr, $($arg:tt)*) => { println!("PROOF {} {}", $q, format!($($arg)*)) };
}

mod exit;
mod harness;
mod measure;
mod server_spawn;
mod size_input;
mod stream;

use exit::*;
use harness::*;
use measure::*;
use server_spawn::*;
use size_input::*;
use stream::*;

#[tokio::main]
async fn main() -> Result<()> {
    let question = std::env::args().nth(1).unwrap_or_default();
    let scratch = tempfile::tempdir()?;
    match question.as_str() {
        "q1" => q1(scratch.path()).await,
        "q2" => q2(scratch.path()).await,
        "q3" => q3(scratch.path()).await,
        "q4" => q4(scratch.path()).await,
        "q5" => q5(scratch.path()).await,
        "q6" => q6(scratch.path()).await,
        "q7" => q7(scratch.path()).await,
        "q7-restart" => q7_restart(scratch.path()).await,
        "q8" => q8(scratch.path()).await,
        "exitcodes" => exitcodes().await,
        "q5-app" => q5_app(scratch.path()).await,
        "serve" => {
            let (argv, env, cwd) = agent_launch(scratch.path())?;
            let server = Server::own(false)?;
            let control = Control::connect(&server.socket, "roundup-spike", None).await?;
            let (session, block) = create(
                &control,
                "serve",
                options(
                    rex_command(&argv, &env, cwd.to_str().unwrap(), true),
                    None,
                    100,
                    30,
                    false,
                ),
            )
            .await?;
            println!("{} {session} {block}", server.socket.display());
            tokio::time::sleep(Duration::from_secs(25)).await;
            let _ = control
                .call("session.destroy", json!({"session_id":session}))
                .await;
            Ok(())
        }
        "q9" => q9(scratch.path()).await,
        "q10" => q10(scratch.path()).await,
        other => Err(format!("unknown question {other:?}").into()),
    }
}
