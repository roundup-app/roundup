//! I2, CL4: `rup help`, its text, and the usage errors clap raises.

use std::process::ExitCode;

use clap::Command;
use clap::error::{ContextKind, ErrorKind};

use super::{BAD_USAGE, DONE, Field, Kind, NAMES_HELP, Spec, WHO_MAY_RUN, specs};

pub(super) fn first_sentence(description: &str) -> &str {
    let end = description.find(". ").unwrap_or(description.len());
    description[..end].trim_end_matches('.')
}

fn placeholder(field: &Field) -> String {
    match &field.kind {
        Kind::Text(choices) => choices
            .first()
            .cloned()
            .unwrap_or_else(|| field.name.clone()),
        _ => field.name.clone(),
    }
}

/// What the user types before the arguments: `rup pad read`, or `rup events` for a stream.
fn invocation(spec: &Spec) -> String {
    if spec.stream {
        format!("rup {}", spec.noun)
    } else {
        format!("rup {} {}", spec.noun, spec.verb)
    }
}

/// The usage line: `rup pad read <name>`.
fn usage(spec: &Spec) -> String {
    let mut line = invocation(spec);
    for field in &spec.fields {
        let flag = field.flag();
        let part = match (field.positional, field.required, &field.kind) {
            (true, true, Kind::Array(_)) => format!(" <{}>...", flag.trim_end_matches('s')),
            (true, true, _) => format!(" <{flag}>"),
            (true, false, _) => format!(" [<{flag}>]"),
            (false, true, Kind::Bool) => format!(" --{flag}"),
            (false, false, Kind::Bool) => format!(" [--{flag}]"),
            (false, true, Kind::Array(_)) => format!(" --{flag} <{flag}>..."),
            (false, false, Kind::Array(_)) => format!(" [--{flag} <{flag}>]..."),
            (false, true, _) => format!(" --{flag} <{}>", placeholder(field)),
            (false, false, _) => format!(" [--{flag} <{}>]", placeholder(field)),
        };
        line.push_str(&part);
    }
    line
}

pub(super) fn example(spec: &Spec) -> String {
    if spec.stream {
        return format!("{} --after 12 --follow --json", invocation(spec));
    }
    let mut line = invocation(spec);
    for field in spec.fields.iter().filter(|f| f.positional) {
        let sample = match (&field.kind, field.name.as_str()) {
            (Kind::Array(_), "ids") => "3 4 --any".to_owned(),
            (Kind::Int | Kind::Number, _) => "1".to_owned(),
            (_, "id") => "3".to_owned(),
            (_, "name") => "notes".to_owned(),
            (Kind::Text(choices), _) if !choices.is_empty() => choices[0].clone(),
            _ => "\"...\"".to_owned(),
        };
        line.push(' ');
        line.push_str(&sample);
    }
    line
}

const EXAMPLES: &str = "  rup pad read notes
  rup terminal read 3 --after 120
  rup todo create \"Fix login\"
  rup pad write notes - < notes.md";

const OTHER: &[(&str, &str)] = &[
    ("rup help [<command>]", "Print this help, or a command's"),
    ("rup ping", "Check the Daemon answers"),
    (
        "rup mcp <agent-id>",
        "Serve these commands as MCP tools over stdio",
    ),
    (
        "rup signal <agent-id>",
        "Hook: hand the Daemon a Signal from stdin",
    ),
    ("rup context <agent-id>", "Hook: print the Agent's Context"),
    (
        "rup skill <setup|status|remove>",
        "Teach other Claude Code sessions about roundup",
    ),
];

/// I2: what roundup and `rup` are, examples, the commands by noun, the exit codes.
pub fn help_text() -> String {
    let specs = specs(true);
    let mut text = String::from(
        "rup: the command line of roundup\n\n\
         roundup runs coding Agents in a Project and shows the user their Status, Todos, Pads, Messages and Terminals. \
         rup is how an Agent reads and changes all of that from its shell: every command acts as you, the Agent whose id is in ROUNDUP_AGENT.\n\n",
    );
    text.push_str(NAMES_HELP);
    text.push_str("\n\nExamples:\n");
    text.push_str(EXAMPLES);
    text.push_str("\n\nCommands:\n");
    let mut nouns: Vec<&str> = Vec::new();
    for spec in specs.iter().filter(|spec| !spec.stream) {
        if !nouns.contains(&spec.noun.as_str()) {
            nouns.push(&spec.noun);
        }
    }
    for noun in nouns {
        text.push_str(&format!("\n  {noun}\n"));
        for spec in specs.iter().filter(|spec| spec.noun == noun) {
            let door = if spec.door_only { " [Door only]" } else { "" };
            text.push_str(&format!(
                "    {}\n        {}.{door}\n",
                usage(spec),
                first_sentence(&spec.description)
            ));
        }
    }
    text.push_str("\n  streams\n");
    for spec in specs.iter().filter(|spec| spec.stream) {
        text.push_str(&format!(
            "    {}\n        {}.\n        Example: {}\n",
            usage(spec),
            first_sentence(&spec.description),
            example(spec)
        ));
    }
    text.push_str("\n  other\n");
    for (usage, what) in OTHER {
        text.push_str(&format!("    {usage}\n        {what}.\n"));
    }
    text.push_str(
        "\nOptions of every command:\n    \
         --agent <id>   Act as this Agent instead of ROUNDUP_AGENT\n    \
         --json         Print the result as JSON on stdout\n    \
         -h, --help     Print a command's arguments, flags and an example\n\n\
         A text argument takes `-` to read the whole of stdin, so a long body is never quoted.\n\
         `rup help <noun>` lists a noun's commands; `rup help <noun> <verb>` describes one.\n\n\
         Exit codes:\n    \
         0  done\n    \
         1  failed: the Daemon refused, did not answer within 10 s, or was not there\n    \
         2  bad usage: an unknown command, a missing or invalid argument, no Agent id, a Door-only command run by an Agent\n",
    );
    text.push('\n');
    text.push_str(WHO_MAY_RUN);
    text
}

/// `rup help`, `rup help <noun>`, `rup help <noun> <verb>`, and the same for `-h` and `--help`.
pub(super) fn help(root: &mut Command, path: &[String]) -> ExitCode {
    root.build();
    let mut at: &mut Command = root;
    for step in path {
        let name = step.clone();
        match at.find_subcommand_mut(&name) {
            Some(next) => at = next,
            None => {
                eprintln!("rup: unknown command {name:?}\nrun \"rup help\" to see the commands");
                return ExitCode::from(BAD_USAGE);
            }
        }
    }
    if path.is_empty() {
        print!("{}", help_text());
    } else {
        print!("{}", at.render_long_help());
    }
    ExitCode::from(DONE)
}

pub(super) fn usage_error(root: &Command, args: &[String], err: &clap::Error) -> ExitCode {
    match err.kind() {
        ErrorKind::DisplayHelp | ErrorKind::DisplayHelpOnMissingArgumentOrSubcommand => {
            if args.iter().all(|arg| arg.starts_with('-')) {
                print!("{}", help_text());
            } else {
                print!("{}", err.render());
            }
            ExitCode::from(DONE)
        }
        ErrorKind::MissingSubcommand if args.is_empty() => {
            print!("{}", help_text());
            ExitCode::from(DONE)
        }
        ErrorKind::InvalidSubcommand => {
            let unknown = err
                .get(ContextKind::InvalidSubcommand)
                .map(ToString::to_string)
                .unwrap_or_default();
            let prefix = args
                .first()
                .filter(|noun| **noun != unknown && root.find_subcommand(noun).is_some())
                .map_or(String::new(), |noun| format!("{noun} "));
            eprintln!("rup: unknown command {:?}", format!("{prefix}{unknown}"));
            if let Some(close) = err.get(ContextKind::SuggestedSubcommand) {
                let close = close.to_string();
                let closest = close
                    .split(", ")
                    .min_by_key(|candidate| distance(&unknown, candidate))
                    .unwrap_or(&close);
                eprintln!("did you mean {:?}?", format!("{prefix}{closest}"));
            }
            eprintln!("run \"rup help\" to see the commands");
            if prefix.is_empty() {
                // CL4: an unknown command is followed by who may run what.
                eprint!("\n{WHO_MAY_RUN}");
            }
            ExitCode::from(BAD_USAGE)
        }
        _ => {
            let message = err.render().to_string();
            let message = message.strip_prefix("error: ").unwrap_or(&message);
            eprintln!("rup: {}", message.trim_end());
            ExitCode::from(BAD_USAGE)
        }
    }
}

/// Edit distance between two short names, to pick the closest of clap's suggestions.
fn distance(a: &str, b: &str) -> usize {
    let b: Vec<char> = b.chars().collect();
    let mut row: Vec<usize> = (0..=b.len()).collect();
    for (i, x) in a.chars().enumerate() {
        let mut prev = std::mem::replace(&mut row[0], i + 1);
        for (j, y) in b.iter().enumerate() {
            let next = (prev + usize::from(x != *y))
                .min(row[j] + 1)
                .min(row[j + 1] + 1);
            prev = std::mem::replace(&mut row[j + 1], next);
        }
    }
    row[b.len()]
}
