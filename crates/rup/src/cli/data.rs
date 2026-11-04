//! FK5977d: `rup data fork <folder> --name <n> --colour <c> [--project <key>[:agents=<id,..>][:no-todos]…]…`
//! sends `data.fork` once and prints what it copied.

use std::process::ExitCode;

use contracts::ActorKind;
use contracts::data::{ForkAgents, ForkAgentsAll, ForkColour, ForkParams, ForkProject, ForkResult};
use serde_json::{Value, json};

use super::{DONE, FAILED, bad_usage, connect};
use crate::mcp::CALL_TIMEOUT;

pub(super) const DATA_HELP: &str = "\
Copy the live data folder into a new Fork data folder. With no --project it copies everything; each --project names one Project key and what to keep of it.

Usage: rup data fork <folder> --name <name> --colour <colour> [--project <key>[:agents=<id,..>|none|all][:no-todos][:no-pads][:no-messages][:no-history]]... [--json]

Colours: red, orange, amber, green, teal, blue, violet, pink.

Example:
  rup data fork ~/forks/login --name Login --colour teal --project app-1a2b3c4d5e6f7a8b:agents=3,4:no-history
";

/// `rup data fork …`: the words after `data fork`, when the arguments are one.
pub(super) fn command(args: &[String]) -> Option<Vec<String>> {
    match args {
        [data, fork, rest @ ..] if data == "data" && fork == "fork" => Some(rest.to_vec()),
        _ => None,
    }
}

fn colour(word: &str) -> Result<ForkColour, String> {
    serde_json::from_value(Value::String(word.to_owned())).map_err(|_| {
        format!(
            "unknown colour {word:?}: use red, orange, amber, green, teal, blue, violet or pink"
        )
    })
}

fn project(spec: &str) -> Result<ForkProject, String> {
    let mut parts = spec.split(':');
    let key = parts
        .next()
        .filter(|key| !key.is_empty())
        .ok_or("--project needs a key")?;
    let mut pick = ForkProject {
        key: key.to_owned(),
        agents: ForkAgents::Keyword(ForkAgentsAll::All),
        todos: true,
        pads: true,
        messages: true,
        history: true,
    };
    for part in parts {
        match part {
            "no-todos" => pick.todos = false,
            "no-pads" => pick.pads = false,
            "no-messages" => pick.messages = false,
            "no-history" => pick.history = false,
            _ => {
                let ids = part
                    .strip_prefix("agents=")
                    .ok_or_else(|| format!("unknown project option {part:?} in {spec:?}"))?;
                pick.agents = match ids {
                    "all" => ForkAgents::Keyword(ForkAgentsAll::All),
                    "none" => ForkAgents::Keyword(ForkAgentsAll::None),
                    ids => ForkAgents::Ids(ids.split(',').map(str::to_owned).collect()),
                };
            }
        }
    }
    Ok(pick)
}

struct Parsed {
    params: ForkParams,
    json: bool,
    help: bool,
}

fn parse(args: &[String]) -> Result<Parsed, String> {
    let (mut name, mut colour_word, mut folder) = (None, None, None);
    let mut projects = Vec::new();
    let (mut json, mut help) = (false, false);
    let mut rest = args.iter();
    while let Some(arg) = rest.next() {
        let mut value = |what: &str| {
            rest.next()
                .cloned()
                .ok_or_else(|| format!("{what} needs a value"))
        };
        match arg.as_str() {
            "--json" => json = true,
            "-h" | "--help" => help = true,
            "--name" => name = Some(value("--name")?),
            "--colour" => colour_word = Some(value("--colour")?),
            "--project" => projects.push(project(&value("--project")?)?),
            flag if flag.starts_with('-') => return Err(format!("unknown flag {flag:?}")),
            _ if folder.is_none() => folder = Some(arg.clone()),
            _ => return Err("give one folder".into()),
        }
    }
    if help {
        return Ok(Parsed {
            params: ForkParams {
                name: String::new(),
                colour: ForkColour::Red,
                path: String::new(),
                projects: None,
            },
            json,
            help,
        });
    }
    let folder = folder.ok_or("give the folder to copy into")?;
    let folder = std::path::absolute(&folder).map_err(|err| format!("{folder}: {err}"))?;
    Ok(Parsed {
        params: ForkParams {
            name: name.ok_or("--name is required")?,
            colour: colour(&colour_word.ok_or("--colour is required")?)?,
            path: folder.to_string_lossy().into_owned(),
            projects: (!projects.is_empty()).then_some(projects),
        },
        json,
        help,
    })
}

pub(super) async fn run(args: &[String]) -> ExitCode {
    let parsed = match parse(args) {
        Ok(parsed) => parsed,
        Err(why) => return bad_usage(&why),
    };
    if parsed.help {
        print!("{DATA_HELP}");
        return ExitCode::from(DONE);
    }
    let client = match connect(&contracts::Actor::user()).await {
        Ok(client) => client,
        Err(super::Failure::Gone(why) | super::Failure::Usage(why)) => {
            eprintln!("rup: {why}");
            return ExitCode::from(FAILED);
        }
        Err(super::Failure::Rpc(err)) => {
            eprintln!("rup: {}", err.message);
            return ExitCode::from(FAILED);
        }
    };
    debug_assert_eq!(contracts::Actor::user().kind, ActorKind::User);
    let reply = tokio::time::timeout(
        CALL_TIMEOUT,
        client.request("data.fork", json!(parsed.params)),
    )
    .await;
    let result = match reply {
        Ok(Ok(result)) => result,
        Ok(Err(err)) => {
            eprintln!("rup: {} ({})", err.message, super::code_name(err.code));
            eprintln!("nothing was written; fix the cause and run it again");
            return ExitCode::from(FAILED);
        }
        Err(_) => {
            eprintln!(
                "rup: no answer within {} s (UNKNOWN_OUTCOME)",
                CALL_TIMEOUT.as_secs()
            );
            return ExitCode::from(FAILED);
        }
    };
    if parsed.json {
        println!("{result}");
        return ExitCode::from(DONE);
    }
    match serde_json::from_value::<ForkResult>(result) {
        Ok(done) => {
            println!("forked into {}", done.path);
            for p in done.projects {
                println!(
                    "{}: {} agents, {} todos, {} pads, {} messages, {} history",
                    p.key,
                    p.agents.len(),
                    p.todos,
                    p.pads,
                    p.messages,
                    p.history
                );
            }
            ExitCode::from(DONE)
        }
        Err(err) => {
            eprintln!("rup: the Daemon's answer is not readable: {err}");
            ExitCode::from(FAILED)
        }
    }
}
