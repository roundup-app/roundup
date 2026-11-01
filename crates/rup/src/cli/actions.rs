//! NA11–NA13: `rup actions` lists the App's named actions, `rup do <name> key=value…` runs one.

use std::process::ExitCode;

use contracts::action::{
    ActionArg, ActionPair, ActionRow, ArgType, RunParams, RunResult, RunStatus,
};
use contracts::{Actor, ActorKind};
use rpc::RpcError;
use serde_json::Value;

use super::help::distance;
use super::{DONE, FAILED, Failure, Input, Usage, bad_usage, connect};
use crate::mcp::CALL_TIMEOUT;

pub(super) const ACTIONS_HELP: &str = "\
List the named actions of the roundup App: one line each with its name, arguments (key=<type>, optional ones in [ ]), keys and why it is unavailable.

Usage: rup actions [--json]

Example:
  rup actions
";

pub(super) const DO_HELP: &str = "\
Run a named action of the roundup App, as its key would. A value may hold `=` and spaces; `-` reads stdin.

Usage: rup do <name> [key=value]... [--json]

Example:
  rup do agent.new-with-prompt prompt=\"Fix login\"
";

/// What `rup actions` and `rup do` take apart from the arguments themselves.
struct Parsed {
    json: bool,
    agent: Option<String>,
    help: bool,
    words: Vec<String>,
}

fn parse(args: &[String]) -> Result<Parsed, String> {
    let mut parsed = Parsed {
        json: false,
        agent: None,
        help: false,
        words: Vec::new(),
    };
    let mut rest = args.iter();
    while let Some(arg) = rest.next() {
        match arg.as_str() {
            "--json" => parsed.json = true,
            "-h" | "--help" => parsed.help = true,
            "--agent" => {
                parsed.agent = Some(rest.next().ok_or("--agent needs an id")?.clone());
            }
            flag if flag.starts_with('-') && flag != "-" && !flag.contains('=') => {
                return Err(format!("unknown flag {flag:?}"));
            }
            _ => parsed.words.push(arg.clone()),
        }
    }
    Ok(parsed)
}

/// The command word after the options that may precede it, when it is one of ours.
pub(super) fn command(args: &[String]) -> Option<(&'static str, Vec<String>)> {
    let mut at = 0;
    while at < args.len() {
        match args[at].as_str() {
            "--json" => at += 1,
            "--agent" => at += 2,
            "actions" => return Some(("actions", with_leading(args, at))),
            "do" => return Some(("do", with_leading(args, at))),
            _ => return None,
        }
    }
    None
}

fn with_leading(args: &[String], at: usize) -> Vec<String> {
    args[..at].iter().chain(&args[at + 1..]).cloned().collect()
}

pub(super) fn run_command(which: &str, args: &[String]) -> impl Future<Output = ExitCode> {
    let which = which.to_owned();
    let parsed = parse(args);
    async move {
        let parsed = match parsed {
            Ok(parsed) => parsed,
            Err(why) => return bad_usage(&why),
        };
        match (which.as_str(), parsed.help) {
            ("actions", true) => print!("{ACTIONS_HELP}"),
            (_, true) => print!("{DO_HELP}"),
            ("actions", false) => return list(&parsed).await,
            _ => return act(&parsed).await,
        }
        ExitCode::from(DONE)
    }
}

fn actor(parsed: &Parsed) -> Actor {
    let agent = parsed
        .agent
        .clone()
        .or_else(|| std::env::var("ROUNDUP_AGENT").ok())
        .filter(|id| !id.is_empty());
    match agent {
        Some(id) => Actor {
            kind: ActorKind::Agent,
            id,
            parent: None,
        },
        None => Actor::user(),
    }
}

/// I3: what went wrong, then what to do.
fn refused(err: &RpcError) -> ExitCode {
    match err.code {
        rpc::code::APP_CLOSED => {
            eprintln!("rup: the roundup App is not open (APP_CLOSED)");
            eprintln!("open the roundup App and run `rup actions` again");
        }
        rpc::code::FORBIDDEN => {
            eprintln!("rup: {} (FORBIDDEN)", err.message);
            eprintln!("run it from your own terminal, outside every Agent's shell");
        }
        code => {
            let name = match code {
                rpc::code::INVALID_PARAMS => "INVALID_PARAMS",
                rpc::code::UNKNOWN_OUTCOME => "UNKNOWN_OUTCOME",
                rpc::code::CONFLICT => "CONFLICT",
                _ => "INTERNAL",
            };
            eprintln!("rup: {} ({name})", err.message);
            eprintln!("see the actions with `rup actions`");
        }
    }
    ExitCode::from(FAILED)
}

fn gone(failure: Failure) -> ExitCode {
    match failure {
        Failure::Rpc(err) => refused(&err),
        Failure::Gone(why) | Failure::Usage(why) => {
            eprintln!("rup: {why}");
            ExitCode::from(FAILED)
        }
    }
}

async fn request(client: &rpc::Client, method: &str, params: Value) -> Result<Value, RpcError> {
    tokio::time::timeout(CALL_TIMEOUT, client.request(method, params))
        .await
        .unwrap_or_else(|_| {
            Err(RpcError::new(
                rpc::code::UNKNOWN_OUTCOME,
                format!("no answer within {} s", CALL_TIMEOUT.as_secs()),
            ))
        })
}

fn type_name(kind: ArgType) -> &'static str {
    match kind {
        ArgType::String => "string",
        ArgType::Integer => "integer",
        ArgType::Boolean => "boolean",
        ArgType::Choice => "choice",
    }
}

fn arg_label(arg: &ActionArg) -> String {
    let pair = format!("{}=<{}>", arg.key, type_name(arg.kind));
    if arg.required {
        pair
    } else {
        format!("[{pair}]")
    }
}

fn row_line(row: &ActionRow) -> String {
    let mut line = row.name.clone();
    for arg in &row.args {
        line.push(' ');
        line.push_str(&arg_label(arg));
    }
    if !row.keys.is_empty() {
        line.push_str("  ");
        line.push_str(&row.keys);
    }
    if !row.available {
        let cause = row.cause.as_deref().unwrap_or("not now");
        line.push_str(&format!("  unavailable: {cause}"));
    }
    line
}

async fn list(parsed: &Parsed) -> ExitCode {
    if let Some(extra) = parsed.words.first() {
        return bad_usage(&format!("rup actions takes no argument, got {extra:?}"));
    }
    let client = match connect(&actor(parsed)).await {
        Ok(client) => client,
        Err(failure) => return gone(failure),
    };
    let result = match request(&client, "action.list", Value::Null).await {
        Ok(result) => result,
        Err(err) => return refused(&err),
    };
    if parsed.json {
        println!("{result}");
        return ExitCode::from(DONE);
    }
    match serde_json::from_value::<Vec<ActionRow>>(result) {
        Ok(rows) => {
            for row in &rows {
                println!("{}", row_line(row));
            }
            ExitCode::from(DONE)
        }
        Err(err) => {
            eprintln!("rup: the App's list is not readable: {err}");
            ExitCode::from(FAILED)
        }
    }
}

/// Bad usage before the Daemon: `name` then `key=value` pairs, each key once.
fn pairs(words: &[String]) -> Result<(String, Vec<ActionPair>), Usage> {
    let Some((name, rest)) = words.split_first() else {
        return Err(Usage("rup do needs an action name".into()));
    };
    let mut input = Input { read: false };
    let mut out: Vec<ActionPair> = Vec::new();
    for token in rest {
        let Some((key, value)) = token.split_once('=') else {
            return Err(Usage(format!("{token:?} is not key=value")));
        };
        if key.is_empty() {
            return Err(Usage(format!("{token:?} has an empty key")));
        }
        if out.iter().any(|pair| pair.key == key) {
            return Err(Usage(format!("{key:?} is given twice")));
        }
        out.push(ActionPair {
            key: key.to_owned(),
            value: input.text(value)?,
        });
    }
    Ok((name.clone(), out))
}

fn closest<'a>(name: &str, rows: &'a [ActionRow]) -> Option<&'a str> {
    rows.iter()
        .map(|row| (distance(name, &row.name), row.name.as_str()))
        .min()
        .filter(|(far, _)| *far <= (name.len() / 3).max(2))
        .map(|(_, found)| found)
}

fn known(row: &ActionRow) -> String {
    if row.args.is_empty() {
        "none".into()
    } else {
        row.args.iter().map(arg_label).collect::<Vec<_>>().join(" ")
    }
}

/// The first reason the pairs do not fit the action's arguments, when one does not.
fn misfit(row: &ActionRow, given: &[ActionPair]) -> Option<String> {
    if let Some(pair) = given
        .iter()
        .find(|pair| !row.args.iter().any(|arg| arg.key == pair.key))
    {
        return Some(format!(
            "unknown argument \"{}\" for {}; its arguments: {}",
            pair.key,
            row.name,
            known(row)
        ));
    }
    for arg in &row.args {
        let Some(pair) = given.iter().find(|pair| pair.key == arg.key) else {
            if arg.required {
                return Some(format!(
                    "missing argument \"{}\" for {}; its arguments: {}",
                    arg.key,
                    row.name,
                    known(row)
                ));
            }
            continue;
        };
        let value = &pair.value;
        let bad = match arg.kind {
            ArgType::String => None,
            ArgType::Boolean => (!matches!(value.as_str(), "true" | "false"))
                .then(|| "must be true or false".to_owned()),
            ArgType::Choice => arg
                .options
                .as_ref()
                .filter(|options| !options.contains(value))
                .map(|options| format!("must be one of {}", options.join(", "))),
            ArgType::Integer => match value.parse::<i64>() {
                Err(_) => Some("must be an integer".to_owned()),
                Ok(n)
                    if arg.min.is_some_and(|min| n < min) || arg.max.is_some_and(|max| n > max) =>
                {
                    Some(format!(
                        "must be from {} to {}",
                        arg.min.map_or("any".into(), |n| n.to_string()),
                        arg.max.map_or("any".into(), |n| n.to_string())
                    ))
                }
                Ok(_) => None,
            },
        };
        if let Some(bad) = bad {
            return Some(format!(
                "argument \"{}\" of {} {bad}, got {value:?}",
                arg.key, row.name
            ));
        }
    }
    None
}

async fn act(parsed: &Parsed) -> ExitCode {
    let (name, args) = match pairs(&parsed.words) {
        Ok(found) => found,
        Err(Usage(why)) => return bad_usage(&why),
    };
    let actor = actor(parsed);
    let client = match connect(&actor).await {
        Ok(client) => client,
        Err(failure) => return gone(failure),
    };
    // The Daemon refuses an Agent before it looks at the name, so only the user's run is checked here.
    if actor.kind == ActorKind::User {
        let rows = match request(&client, "action.list", Value::Null).await {
            Ok(rows) => rows,
            Err(err) => return refused(&err),
        };
        let rows: Vec<ActionRow> = match serde_json::from_value(rows) {
            Ok(rows) => rows,
            Err(err) => {
                eprintln!("rup: the App's list is not readable: {err}");
                return ExitCode::from(FAILED);
            }
        };
        let Some(row) = rows.iter().find(|row| row.name == name) else {
            eprintln!("rup: unknown action \"{name}\"");
            if let Some(near) = closest(&name, &rows) {
                eprintln!("did you mean \"{near}\"?");
            }
            eprintln!("run \"rup actions\"");
            return ExitCode::from(FAILED);
        };
        if let Some(why) = misfit(row, &args) {
            eprintln!("rup: {why}\nrun \"rup actions\" to see every action's arguments");
            return ExitCode::from(FAILED);
        }
    }
    let result = match request(
        &client,
        "action.run",
        serde_json::json!(RunParams { name, args }),
    )
    .await
    {
        Ok(result) => result,
        Err(err) => return refused(&err),
    };
    if parsed.json {
        println!("{result}");
        return ExitCode::from(DONE);
    }
    match serde_json::from_value::<RunResult>(result) {
        Ok(RunResult {
            status: RunStatus::Done,
        }) => println!("done"),
        Ok(RunResult {
            status: RunStatus::Awaiting,
        }) => {
            println!("awaiting: the confirm or prompt it opened, for you to finish in the App");
        }
        Err(err) => {
            eprintln!("rup: the App's answer is not readable: {err}");
            return ExitCode::from(FAILED);
        }
    }
    ExitCode::from(DONE)
}
