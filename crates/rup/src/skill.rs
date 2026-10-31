//! SK7–SK9: `rup skill setup|status|remove` for the owner's shell, and `rup skill report`, the
//! command the installed hook runs. The first three call the Adapter in this process; `report`
//! writes one Program status report (OSC 7501) to the controlling terminal and nothing else.

use std::io::Write;
use std::process::ExitCode;

use agents::claude_code::skill_setup::{Install, Planned};
use serde_json::json;

const HELP: &str = "\
rup skill: teach other Claude Code sessions about roundup

Usage:
    rup skill setup [--dry-run] [--force] [--json]
        Install roundup's skill and hook. Example: rup skill setup --dry-run
    rup skill status [--json]
        Say what is installed. Example: rup skill status --json
    rup skill remove [--dry-run] [--json]
        Take out only what setup installed. Example: rup skill remove
    rup skill report --state <state> [--kind <kind>] [--where]
        Internal: the hook's command. Writes one status report to the terminal and always exits 0.

Options:
    --dry-run   Print what would happen with each outcome prefixed `would `, and write nothing
    --force     Replace a skill named roundup that roundup did not install (setup only)
    --json      Print the list as one JSON document

Exit codes:
    0  done
    1  setup or remove met a foreign, unreadable or unsupported item, or a write failed
    2  bad usage
";

pub fn help_text() -> &'static str {
    HELP
}

/// `args` is everything after `skill`.
pub fn run(args: &[String]) -> ExitCode {
    let Some((verb, flags)) = args.split_first() else {
        return usage("no command");
    };
    match verb.as_str() {
        "report" => report(flags),
        "-h" | "--help" => {
            print!("{HELP}");
            ExitCode::SUCCESS
        }
        "setup" | "status" | "remove" => manage(verb, flags),
        other => usage(&format!("unknown command \"skill {other}\"")),
    }
}

fn usage(why: &str) -> ExitCode {
    eprintln!("rup: {why}\nrun \"rup help skill\" to see the commands");
    ExitCode::from(2)
}

/// SK7: never fails, never blocks the vendor program's action (exit 2), never reads stdin.
fn report(flags: &[String]) -> ExitCode {
    let set = |name: &str| std::env::var_os(name).is_some_and(|value| !value.is_empty());
    // SK8: an Agent keeps its own Brief and hooks.
    if set("ROUNDUP_AGENT") {
        return ExitCode::SUCCESS;
    }
    let Some(terminal) = std::env::var("ROUNDUP_TERMINAL")
        .ok()
        .filter(|id| !id.is_empty())
    else {
        return ExitCode::SUCCESS;
    };
    let (mut state, mut kind, mut place) = (None, None, false);
    let mut it = flags.iter();
    while let Some(flag) = it.next() {
        match flag.as_str() {
            "--state" => state = it.next(),
            "--kind" => kind = it.next(),
            "--where" => place = true,
            _ => {}
        }
    }
    if place {
        println!(
            "This session runs in a roundup Terminal (id {terminal}); run \"rup help\" to learn the commands."
        );
    }
    let wire = match (state.map(String::as_str), kind.map(String::as_str)) {
        (Some(s @ ("idle" | "working" | "done" | "clear")), _) => s.to_owned(),
        (Some("blocked"), Some(k @ ("permission" | "question"))) => format!("blocked:kind={k}"),
        _ => return ExitCode::SUCCESS,
    };
    let wire = if wire.starts_with("blocked") {
        wire.replacen("blocked", "state=blocked", 1)
    } else {
        format!("state={wire}")
    };
    if let Ok(mut tty) = std::fs::OpenOptions::new().write(true).open("/dev/tty") {
        let _ = write!(tty, "\x1b]7501;{wire}\x1b\\");
    }
    ExitCode::SUCCESS
}

fn manage(verb: &str, flags: &[String]) -> ExitCode {
    let (mut json_out, mut dry, mut force) = (false, false, false);
    for flag in flags {
        match flag.as_str() {
            "--json" => json_out = true,
            "--dry-run" if verb != "status" => dry = true,
            "--force" if verb == "setup" => force = true,
            other => return usage(&format!("\"skill {verb}\" takes no {other}")),
        }
    }
    let rup = match std::env::current_exe() {
        Ok(path) => path,
        Err(err) => {
            eprintln!("rup: cannot find this program's path: {err}");
            return ExitCode::FAILURE;
        }
    };
    let install = match Install::from_vars(|name| std::env::var_os(name), &rup) {
        Ok(install) => install.force(force),
        Err(why) => {
            eprintln!("rup: {why}\nset HOME or CLAUDE_CONFIG_DIR and run it again");
            return ExitCode::FAILURE;
        }
    };
    if verb == "status" {
        let lines: Vec<_> = install
            .status()
            .into_iter()
            .map(|r| (r.item.as_str(), r.state.as_str().to_owned(), r.path))
            .collect();
        print_lines(&lines, json_out);
        return ExitCode::SUCCESS;
    }
    let plan = if verb == "setup" {
        install.plan_setup()
    } else {
        install.plan_remove()
    };
    let done: Vec<Planned> = if dry {
        plan.entries.clone()
    } else {
        match plan.apply() {
            Ok(done) => done,
            Err(err) => {
                eprintln!(
                    "rup: cannot write {}: {}\ncheck that the folder is writable and run it again",
                    err.path.display(),
                    err.source
                );
                return ExitCode::FAILURE;
            }
        }
    };
    let prefix = if dry { "would " } else { "" };
    let lines: Vec<_> = done
        .iter()
        .map(|p| {
            (
                p.item.as_str(),
                format!("{prefix}{}", p.outcome.as_str()),
                p.path.clone(),
            )
        })
        .collect();
    print_lines(&lines, json_out);
    let mut failed = false;
    for p in done.iter().filter(|p| p.outcome.refused()) {
        failed = true;
        eprintln!("rup: {}", refusal(verb, p));
    }
    if failed {
        ExitCode::FAILURE
    } else {
        ExitCode::SUCCESS
    }
}

fn refusal(verb: &str, p: &Planned) -> String {
    let (item, path) = (p.item.as_str(), p.path.display());
    match p.outcome.as_str() {
        "foreign" => format!(
            "the {item} at {path} is not roundup's and was left as it is\nremove that folder, or run \"rup skill {verb} --force\""
        ),
        "unreadable" => format!(
            "cannot read the {item} at {path}; it was left as it is\nfix the file and run \"rup skill {verb}\" again"
        ),
        _ => "no Claude Code was found; nothing was written\ninstall Claude Code, or set CLAUDE_CONFIG_DIR to its folder".to_owned(),
    }
}

fn print_lines(lines: &[(&str, String, std::path::PathBuf)], json_out: bool) {
    if json_out {
        let list: Vec<_> = lines
            .iter()
            .map(|(item, outcome, path)| {
                json!({"item": item, "outcome": outcome, "path": path.display().to_string()})
            })
            .collect();
        println!("{}", json!(list));
        return;
    }
    for (item, outcome, path) in lines {
        println!("{outcome} {item} {}", path.display());
    }
}
