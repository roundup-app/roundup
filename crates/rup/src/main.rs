use std::io::Read;
use std::process::ExitCode;
use std::time::Duration;

use contracts::agent::{Brief, NodeId, SignalOutcome, SignalParams};
use contracts::decision::{PermissionOutput, PermissionParams};
use contracts::{Actor, ActorKind};
use serde_json::{Value, json};

/// How long `rup signal` waits for the Daemon: well inside the 5 s Claude Code gives a hook.
const SIGNAL_DEADLINE: Duration = Duration::from_secs(1);

/// How long `rup context` waits for the Daemon: inside the 5 s Claude Code gives a hook.
const CONTEXT_DEADLINE: Duration = Duration::from_secs(4);

/// What `rup signal` says when it cannot know whether the Daemon took the Signal.
const MAYBE_ARRIVED: &str = "the Signal may or may not have arrived";

mod cli;
mod mcp;

/// What comes before the command.
#[derive(Default)]
struct Options {
    ext: Option<Actor>,
    json: bool,
}

impl Options {
    fn actor(&self) -> Actor {
        self.ext.clone().unwrap_or_else(Actor::user)
    }
}

/// CL2: `ext:<name>`, the name 1 to 64 of lowercase letters, digits, `-` and `_`.
fn ext_actor(value: &str) -> Result<Actor, String> {
    let rule = "--as takes ext:<name>, the name 1 to 64 of a-z, 0-9, - and _";
    let name = value.strip_prefix("ext:").ok_or(rule)?;
    let valid = (1..=64).contains(&name.len())
        && name
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_');
    if !valid {
        return Err(rule.into());
    }
    Ok(Actor {
        kind: ActorKind::Ext,
        id: value.to_owned(),
        parent: None,
    })
}

/// H15: `rup` never runs more than one task at a time, so one OS thread is enough; the thread test in
/// `crates/rup/tests/signal.rs` fails if tokio starts a second.
#[tokio::main(flavor = "current_thread")]
async fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut rest = args.iter().map(String::as_str).peekable();
    let mut options = Options::default();
    while let Some(&option) = rest.peek() {
        match option {
            "--json" => options.json = true,
            "--as" => {
                rest.next();
                match rest
                    .peek()
                    .map_or_else(|| Err("--as needs a value".to_owned()), |v| ext_actor(v))
                {
                    Ok(actor) => options.ext = Some(actor),
                    Err(why) => {
                        eprintln!("rup: {why}");
                        return ExitCode::from(2);
                    }
                }
            }
            _ => break,
        }
        rest.next();
    }
    let command: Vec<&str> = rest.collect();
    let hook = options.ext.is_some()
        && matches!(
            command.first(),
            Some(&("signal" | "context" | "permission"))
        );
    if hook {
        // Exit 2 would tell Claude Code to block its tool call or prompt (H8, E3, H15).
        eprintln!("rup: signal, context and permission are Agent hooks; --as does not apply");
        return ExitCode::FAILURE;
    }
    if options.json
        && matches!(
            command.first(),
            Some(&("mcp" | "signal" | "context" | "permission"))
        )
    {
        eprintln!(
            "rup: --json applies to ping and the commands of rup help; mcp owns stdout for the protocol"
        );
        return ExitCode::from(2);
    }
    let outcome = match command[..] {
        ["ping"] => ping(&options).await,
        ["signal", agent_id] if !agent_id.starts_with('-') => match signal(agent_id).await {
            // B39: the one reason to exit 2, which blocks a prompt that repeats delivered Messages.
            Ok(true) => {
                eprintln!("rup: this prompt repeats Messages already delivered; dropped");
                return ExitCode::from(2);
            }
            Ok(false) => Ok(()),
            Err(err) => Err(err),
        },
        // Exit 2 would tell Claude Code to block its tool call or prompt; `signal` fails only with 1.
        ["signal", ..] => Err("usage: rup signal <agent-id>".into()),
        ["context", agent_id] if !agent_id.starts_with('-') => return context(agent_id).await,
        // As for `signal`: only exit 1, never 2.
        ["context", ..] => Err("usage: rup context <agent-id>".into()),
        ["permission", agent_id] if !agent_id.starts_with('-') => permission(agent_id).await,
        // As for `signal`: exit 2 would block the tool call.
        ["permission", ..] => Err("usage: rup permission <agent-id>".into()),
        ["mcp"] => match options.ext {
            Some(actor) => return mcp::run(actor).await,
            None => {
                eprintln!("usage: rup mcp <agent-id> | rup --as ext:<name> mcp");
                return ExitCode::from(2);
            }
        },
        ["mcp", _] if options.ext.is_some() => {
            eprintln!("rup: an Agent id and --as ext:<name> cannot both be given");
            return ExitCode::from(2);
        }
        ["mcp", agent_id] => {
            let agent = Actor {
                kind: ActorKind::Agent,
                id: agent_id.to_owned(),
                parent: None,
            };
            return mcp::run(agent).await;
        }
        [] | ["help" | "--help" | "-h"] => {
            print!("{}", cli::help_text());
            return ExitCode::SUCCESS;
        }
        // I1-I8 own every other command and the help of a noun or verb; they read the arguments as given.
        _ => return cli::run(args).await,
    };
    match outcome {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) => {
            eprintln!("rup: {err}");
            ExitCode::FAILURE
        }
    }
}

async fn connect() -> Result<rpc::Client, String> {
    let socket = rpc::socket_path().map_err(|err| err.to_string())?;
    rpc::Client::connect(&socket)
        .await
        .map_err(|err| err.to_string())
}

/// CL1: one line naming the Daemon that answered, or with `--json` `{actor, socket, result}`.
async fn ping(options: &Options) -> Result<(), String> {
    let socket = rpc::socket_path().map_err(|err| err.to_string())?;
    let client = rpc::Client::connect(&socket)
        .await
        .map_err(|err| format!("no Daemon at {}: {err}", socket.display()))?;
    let actor = options.actor();
    if options.ext.is_some() {
        client
            .request("daemon.identify", json!({ "actor": actor }))
            .await
            .map_err(hung_up)?;
    }
    let reply = client
        .request("daemon.ping", Value::Null)
        .await
        .map_err(|err| err.to_string())?;
    if options.json {
        println!(
            "{}",
            json!({ "actor": actor, "socket": socket.display().to_string(), "result": reply })
        );
        return Ok(());
    }
    let word = |key: &str| reply[key].as_str().map(str::to_owned);
    println!(
        "rupd {} at {} for {}",
        reply["pid"],
        socket.display(),
        word("project").unwrap_or_default()
    );
    Ok(())
}

/// Claude Code runs this as the Agent's command hook: one payload on stdin is one Signal. `true`
/// when the Daemon says the prompt repeats delivered Messages (B39).
async fn signal(agent_id: &str) -> Result<bool, String> {
    let attempt =
        std::env::var("ROUNDUP_ATTEMPT").map_err(|_| "ROUNDUP_ATTEMPT is required".to_owned())?;
    if contracts::agent::parse_positive_ordinal(&attempt).is_none() {
        return Err("ROUNDUP_ATTEMPT must be a canonical positive signed 64-bit decimal".into());
    }
    let mut input = String::new();
    std::io::stdin()
        .read_to_string(&mut input)
        .map_err(|err| format!("cannot read the payload: {err}"))?;
    let payload =
        serde_json::from_str(&input).map_err(|err| format!("the payload is not JSON: {err}"))?;
    tokio::time::timeout(SIGNAL_DEADLINE, deliver(agent_id, attempt, payload))
        .await
        .map_err(|_| {
            format!(
                "rupd did not answer within {} s; {MAYBE_ARRIVED}",
                SIGNAL_DEADLINE.as_secs()
            )
        })?
}

/// E3: Claude Code runs this as the Agent's second `SessionStart` hook. It prints what the Daemon's
/// `agent.brief` returns and nothing else. Whatever goes wrong is one line on stderr and exit 0,
/// so the Agent still starts, without its Context.
async fn context(agent_id: &str) -> ExitCode {
    let told = tokio::time::timeout(CONTEXT_DEADLINE, brief(agent_id)).await;
    match told {
        Ok(Ok(brief)) => print!("{}", brief.stdout),
        Ok(Err(why)) => eprintln!("rup: no Context from the Daemon at {}: {why}", socket()),
        Err(_) => eprintln!(
            "rup: the Daemon at {} did not answer within {} s; no Context",
            socket(),
            CONTEXT_DEADLINE.as_secs()
        ),
    }
    ExitCode::SUCCESS
}

fn socket() -> String {
    rpc::socket_path().map_or_else(|err| err.to_string(), |path| path.display().to_string())
}

async fn brief(agent_id: &str) -> Result<Brief, String> {
    let client = identified(agent_id).await?;
    let reply = client
        .request(
            "agent.brief",
            NodeId {
                id: agent_id.to_owned(),
            },
        )
        .await
        .map_err(hung_up)?;
    serde_json::from_value(reply).map_err(|err| format!("the reply is unreadable: {err}"))
}

/// H8: Claude Code runs this as the Agent's `PermissionRequest` hook. It prints exactly the reply
/// the Daemon gives and nothing else; every failure is a line on stderr and exit 1, so Claude Code
/// shows its own dialog and no failure can allow or block a tool call.
async fn permission(agent_id: &str) -> Result<(), String> {
    let mut input = String::new();
    std::io::stdin()
        .read_to_string(&mut input)
        .map_err(|err| format!("cannot read the payload: {err}"))?;
    let payload: Value =
        serde_json::from_str(&input).map_err(|err| format!("the payload is not JSON: {err}"))?;
    // Without it `connect` would fall back to a default socket the hook was never pointed at.
    if std::env::var_os("RUPD_SOCKET").is_none() {
        return Err("RUPD_SOCKET is not set".into());
    }
    let client = identified(agent_id).await?;
    let reply = client
        .request(
            "agent.permission",
            PermissionParams {
                id: agent_id.to_owned(),
                payload,
            },
        )
        .await
        .map_err(hung_up)?;
    let PermissionOutput { output } = serde_json::from_value(reply)
        .map_err(|err| format!("rupd's reply is unreadable: {err}"))?;
    if output.is_empty() {
        // H2: the Decision is answered in the Terminal.
        eprintln!("answer in the Terminal");
    } else {
        print!("{output}");
    }
    Ok(())
}

/// A connection that closed with no reply: nothing more will come.
fn hung_up(err: rpc::RpcError) -> String {
    match err.code {
        rpc::code::UNKNOWN_OUTCOME => "rupd did not answer".to_owned(),
        _ => err.to_string(),
    }
}

/// Connect and identify as Agent `agent_id`.
async fn identified(agent_id: &str) -> Result<rpc::Client, String> {
    let client = connect().await?;
    let actor = Actor {
        kind: ActorKind::Agent,
        id: agent_id.to_owned(),
        parent: None,
    };
    client
        .request("daemon.identify", json!({ "actor": actor }))
        .await
        .map_err(hung_up)?;
    Ok(client)
}

/// Identify as Agent `agent_id` and hand the Daemon its Signal.
async fn deliver(agent_id: &str, attempt: String, payload: Value) -> Result<bool, String> {
    let client = identified(agent_id).await?;
    let signal = SignalParams {
        id: agent_id.to_owned(),
        attempt,
        payload,
    };
    client
        .request("agent.signal", signal)
        .await
        // A reply that cannot be read never drops a prompt.
        .map(|reply| {
            serde_json::from_value::<Option<SignalOutcome>>(reply)
                .is_ok_and(|o| o.is_some_and(|o| o.drop))
        })
        .map_err(|err| match err.code {
            // The connection closed mid-call: the Daemon may have taken the Signal already.
            rpc::code::UNKNOWN_OUTCOME => format!("{err}; {MAYBE_ARRIVED}"),
            _ => err.to_string(),
        })
}
