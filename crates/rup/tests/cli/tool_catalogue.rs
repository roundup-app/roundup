//! I1/M2219: CLI commands and MCP tools share one catalogue and authority.
use super::*;

#[tokio::test]
async fn i1_every_mcp_tool_is_a_command_and_no_command_is_extra() {
    let dir = tempfile::tempdir().unwrap();
    let help = out(&on(&dir.path().join("none")).rup(&["help"]).await);
    let commands = listed_commands(&help);
    for door in [false, true] {
        let socket = dir.path().join(format!("{door}.sock"));
        let _requests = stand_in(&socket, door, Vec::new(), &[]);
        let tools: BTreeSet<String> = mcp_tools(&socket)
            .await
            .iter()
            .map(|(name, _)| tool_key(name))
            .collect();
        // M16: a Door's `rup mcp` omits the three tools that start a Terminal; the command stays.
        let cli: BTreeSet<String> = commands
            .iter()
            .filter(|(_, door_only)| door || !door_only)
            .map(|(usage, _)| command_key(usage))
            .filter(|key| {
                !door || !["agentrun", "terminalspawn", "terminalopen"].contains(&key.as_str())
            })
            .collect();
        assert_eq!(cli, tools, "door: {door}");
    }
    let streams = help
        .split("\n  streams\n")
        .nth(1)
        .and_then(|rest| rest.split("\n  other\n").next())
        .unwrap();
    assert!(
        streams.contains("rup events [--after <after>] [--kept] [--follow]")
            && streams.contains("Example: rup events --after 12 --follow --json"),
        "{streams}"
    );
    let other = help.split("\n  other\n").nth(1).unwrap();
    let other: Vec<&str> = other
        .lines()
        .filter(|line| line.starts_with("    rup "))
        .map(|line| line.split_whitespace().nth(1).unwrap())
        .collect();
    assert_eq!(other, ["help", "ping", "mcp", "signal", "context", "skill"]);
}

#[tokio::test]
async fn i1_a_commands_flags_are_its_schemas_fields() {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("s.sock");
    let mut requests = stand_in(&socket, false, Vec::new(), &[]);
    let tools = mcp_tools(&socket).await;
    let schema = |name: &str| tools.iter().find(|(n, _)| n == name).unwrap().1.clone();
    let run = on(&socket);
    let create = out(&run.rup(&["help", "todo", "create"]).await);
    let schema = schema("todo_create");
    let required: Vec<&str> = schema["required"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(Value::as_str)
        .collect();
    assert_eq!(required, ["title"]);
    assert!(
        create.contains("Usage: rup todo create [OPTIONS] <title>"),
        "{create}"
    );
    for flag in ["--owner", "--priority", "--body", "--blockers"] {
        assert!(create.contains(flag), "{create}");
    }
    let write = out(&run.rup(&["help", "pad", "write"]).await);
    for flag in ["--expected-revision", "--expected-incarnation"] {
        assert!(write.contains(flag), "{write}");
    }
    let assign = out(&run.rup(&["help", "todo", "assign"]).await);
    assert!(assign.contains("--expected-change"), "{assign}");
    let result = run
        .rup(&[
            "pad",
            "write",
            "notes",
            "replacement",
            "--expected-revision",
            "7",
            "--expected-incarnation",
            "11",
        ])
        .await;
    assert_eq!(code(&result), 0, "{}", err(&result));
    let params = request_of(&mut requests, "pad.write").await;
    assert_eq!(
        params,
        json!({
            "name": "notes", "text": "replacement",
            "expectedRevision": 7, "expectedIncarnation": "11",
        })
    );
    let read = out(&run.rup(&["help", "terminal", "read"]).await);
    assert!(read.contains("<id>") && read.contains("--after"), "{read}");
    let blockers = out(&run.rup(&["help", "todo", "set-blockers"]).await);
    assert!(blockers.contains("--blockers"), "{blockers}");
}

#[tokio::test]
async fn i1_a_door_only_command_is_refused_to_an_agent() {
    let dir = tempfile::tempdir().unwrap();
    let agent = dir.path().join("agent.sock");
    let _a = stand_in(&agent, false, Vec::new(), &[]);
    let refused = on(&agent).rup(&["agent", "digest"]).await;
    assert_eq!(code(&refused), 2);
    assert!(
        err(&refused).contains("only a Door has"),
        "{}",
        err(&refused)
    );
    let door = dir.path().join("door.sock");
    let _d = stand_in(&door, true, Vec::new(), &[]);
    assert_eq!(code(&on(&door).rup(&["agent", "digest"]).await), 0);
}

#[tokio::test]
async fn m2219_a_rup_command_is_judged_and_touched_like_the_tool() {
    let project = start_daemon().await;
    let maker = on(&project.socket).acting_as(Some("a7"));
    let made = maker
        .rup(&["rail", "create-workstream", "w", "--json"])
        .await;
    assert_eq!(code(&made), 0, "{}", err(&made));
    let id = serde_json::from_str::<Value>(&out(&made)).unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    // Reach (M7): the maker changes what it made; another Agent is refused, as over MCP.
    assert_eq!(code(&maker.rup(&["rail", "rename", &id, "w2"]).await), 0);
    let other = on(&project.socket).acting_as(Some("a8"));
    let refused = other.rup(&["rail", "rename", &id, "w3"]).await;
    assert_eq!(code(&refused), 1);
    assert!(err(&refused).contains("FORBIDDEN"), "{}", err(&refused));
    // The Touch names the calling Agent.
    let touched = out(&maker.rup(&["provenance", "touched", "a7", "--json"]).await);
    assert!(touched.contains(&format!("rail:{id}")), "{touched}");
}

#[tokio::test]
async fn m2219_every_command_the_off_brief_names_is_in_rup_help() {
    use agents::claude_code::{Folders, LaunchFacts, Launcher, Role};
    let root = tempfile::tempdir().unwrap();
    let project = root.path().join("proj");
    let data = project.join(".roundup");
    std::fs::create_dir_all(&data).unwrap();
    let rup = PathBuf::from(env!("CARGO_BIN_EXE_rup"));
    let launcher = Launcher::new("claude", root.path().join("claude.json"), rup, None);
    let pair = LaunchFacts {
        mcp_off: true,
        ..Default::default()
    };
    let help = tokio::process::Command::new(env!("CARGO_BIN_EXE_rup"))
        .arg("help")
        .output()
        .await
        .unwrap();
    let help = out(&help);
    let lines: Vec<&str> = help.lines().map(str::trim).collect();
    for role in [Role::Agent, Role::Door] {
        let _argv = launcher
            .prepare_on(&agents::claude_code::Request {
                folders: Folders {
                    project: &project,
                    data: &data,
                },
                id: "7",
                attempt: "1",
                cwd: &project,
                resume: None,
                role,
                facts: &pair,
            })
            .unwrap();
        let brief = std::fs::read_to_string(data.join("agents/7.brief.md")).unwrap();
        let named: BTreeSet<&str> = brief
            .split('`')
            .filter(|span| span.starts_with("rup "))
            .collect();
        assert!(named.len() > 50, "{named:?}");
        for command in named {
            assert!(
                lines.iter().any(|line| line
                    .strip_prefix(command)
                    .is_some_and(|rest| rest.is_empty() || rest.starts_with(' '))),
                "{role:?} names `{command}`, which rup help lacks"
            );
        }
    }
}

#[tokio::test]
async fn i2_a_commands_help_names_its_arguments_flags_and_an_example() {
    let dir = tempfile::tempdir().unwrap();
    let run = on(&dir.path().join("none"));
    let by_help = run.rup(&["help", "pad", "read"]).await;
    let by_flag = run.rup(&["pad", "read", "--help"]).await;
    assert_eq!((code(&by_help), code(&by_flag)), (0, 0));
    assert_eq!(out(&by_help), out(&by_flag));
    let text = out(&by_help);
    assert!(text.starts_with("Read one Pad."), "{text}");
    assert!(text.contains("Usage: rup pad read"), "{text}");
    assert!(text.contains("<name>") && text.contains("--json"), "{text}");
    assert!(text.contains("Example:\n  rup pad read notes"), "{text}");
    let noun = out(&run.rup(&["help", "pad"]).await);
    assert!(noun.contains("read") && noun.contains("append"), "{noun}");
    for args in [vec!["help"], vec!["help", "pad"]] {
        let result = run.rup(&args).await;
        let text = out(&result);
        assert_eq!(code(&result), 0);
        assert!(err(&result).is_empty());
        assert!(
            text.contains("--expected-revision") && text.contains("--expected-incarnation"),
            "{text}"
        );
        assert!(!text.contains("--expectedRevision") && !text.contains("--expectedIncarnation"));
    }
    for verb in ["write", "append-section"] {
        let by_help = run.rup(&["help", "pad", verb]).await;
        let by_flag = run.rup(&["pad", verb, "--help"]).await;
        assert_eq!((code(&by_help), code(&by_flag)), (0, 0));
        assert!(err(&by_help).is_empty() && err(&by_flag).is_empty());
        assert_eq!(out(&by_help), out(&by_flag));
        let text = out(&by_help);
        assert!(text.contains("--expected-revision"), "{text}");
        assert!(!text.contains("--expectedRevision") && !text.contains("--expectedIncarnation"));
        if verb == "write" {
            assert!(text.contains("--expected-incarnation"), "{text}");
        } else {
            let example = text
                .split("Example:\n  ")
                .nth(1)
                .unwrap()
                .lines()
                .next()
                .unwrap();
            assert_eq!(
                example,
                "rup pad append-section notes Plan Added --expected-revision 1"
            );
            let project = start_daemon().await;
            let run = on(&project.socket);
            assert_eq!(
                code(
                    &run.rup(&["pad", "create", "notes", "--text", "## Plan\nOriginal"])
                        .await
                ),
                0
            );
            let result = run
                .rup(&example.split_whitespace().skip(1).collect::<Vec<_>>())
                .await;
            assert_eq!(code(&result), 0, "{}", err(&result));
            let read: Value =
                serde_json::from_str(&out(&run.rup(&["pad", "read", "notes", "--json"]).await))
                    .unwrap();
            assert_eq!(read["revision"], 2);
            assert_eq!(read["text"], "## Plan\nOriginal\nAdded");
        }
    }
}
