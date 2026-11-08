use super::*;

#[test]
fn q6_pin() {
    assert_eq!(
        sha256_hex(asset("reduce.md").as_bytes()),
        "c0397f941ee2db71ab1ba870b6f53987e38f0b7b0cbfec23a780f5c393f3703f"
    );
    assert_eq!(
        sha256_hex(asset("show-me.md").as_bytes()),
        "434a2346cc95e313b0d367d477dda2e23ba642dd2181757415a09500664af100"
    );
}

#[test]
fn q6_brief() {
    let s = setup();
    for role in [Role::Agent, Role::Door] {
        let text = brief(&s, "7", role);
        assert!(text.contains(&asset("reduce.md")), "{role:?}");
        assert!(text.contains(&asset("show-me.md")), "{role:?}");
        assert!(text.contains(
            "Run `reduce` on every Work order, Message to `you`, `AskUserQuestion` question, Digest, Pad reply and Todo title"
        ));
    }
}

#[test]
fn q7_brief_names_each_view_and_its_place() {
    let s = setup();
    let text = brief(&s, "7", Role::Agent);
    for view in ["a table", "code-shape sketch", "`diff`", "Mermaid diagram"] {
        assert!(text.contains(view), "{view}");
    }
    assert!(text.contains("only in a Pad"));
    assert!(text.contains("a diagram lives only in a Pad as depth"));
    assert!(text.contains("a table or code-shape sketch and gives the Pad's link"));
    assert!(!text.contains("send the Pad's name"));
}

#[test]
fn q7_brief_forbids_html() {
    let s = setup();
    let text = brief(&s, "7", Role::Agent);
    assert!(text.contains("write no HTML file and never `open` one"));
}

fn fixture(name: &str) -> String {
    std::fs::read_to_string(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/reduce")
            .join(name),
    )
    .unwrap()
}

fn lines(name: &str) -> Vec<String> {
    fixture(name).lines().map(str::to_owned).collect()
}

/// Q8 (b), Q12 (a): the facts of fixture `name` missing from `text`.
fn missing_facts(name: &str, text: &str) -> Vec<String> {
    lines(&format!("{name}.facts"))
        .into_iter()
        .filter(|fact| !text.contains(fact.as_str()))
        .collect()
}

#[test]
fn q8_reduced_is_shorter() {
    assert!(
        fixture("door-question.reduced.md").chars().count()
            < fixture("door-question.md").chars().count()
    );
}

#[test]
fn q8_every_fact_survives() {
    assert!(missing_facts("door-question", &fixture("door-question.md")).is_empty());
    assert!(missing_facts("door-question", &fixture("door-question.reduced.md")).is_empty());
}

#[test]
fn q8_no_padding_phrase_survives() {
    let original = fixture("door-question.md");
    let reduced = fixture("door-question.reduced.md");
    let padding = lines("door-question.padding");
    assert_eq!(padding.len(), 4);
    for phrase in padding {
        assert!(original.contains(&phrase), "{phrase}");
        assert!(!reduced.contains(&phrase), "{phrase}");
    }
}

#[test]
fn q8_the_check_rejects_a_dropped_fact() {
    let dropped = fixture("door-question.reduced.md").replace("Friday 14 Nov", "");
    assert_eq!(missing_facts("door-question", &dropped), ["Friday 14 Nov"]);
}

#[test]
fn q9_door_guidance_names_the_four_paddings() {
    let s = setup();
    let text = brief(&s, "7", Role::Door);
    for rule in [
        "Open a question with the question.",
        "State a guess once, as a choice to confirm.",
        "Write a list as the choices and nothing around them; each choice may carry its sketch or rows.",
        "Leave out an acknowledgment such as \"On it.\", a connective such as \"Separately:\" and a list item that restates its question.",
    ] {
        assert!(text.contains(rule), "{rule}");
    }
}

#[test]
fn q9_ordinary_brief_has_no_door_guidance() {
    let s = setup();
    let text = brief(&s, "7", Role::Agent);
    assert!(!text.contains("Open a question with the question."));
    assert!(!text.contains("a connective such as"));
}

#[test]
fn m9_a_doors_brief_names_the_workstream_and_project_tools() {
    let s = setup();
    let door = brief(&s, "7", Role::Door);
    let agent = brief(&s, "8", Role::Agent);

    for needle in [
        "`rail_createWorkstream`",
        "`rail_startDoor`",
        "`project_open`",
        "`agent_stop`",
        "`agent_prompt`",
        "Reach",
    ] {
        assert!(door.contains(needle), "{needle}");
    }
    assert!(door.contains("never nested"));
    assert!(agent.contains("`rail_createWorkstream`"));
    assert!(!agent.contains("You are this Workstream's coordinating Door"));
}

#[test]
fn q11_every_role_defaults_to_plain_in_settings() {
    for role in [Role::Door, Role::Scout, Role::Agent] {
        for resume in [None, Some("saved-conversation")] {
            let s = setup();
            let argv = s
                .launcher()
                .prepare(folders(&s.dir), "7", "1", &s.cwd, resume, role)
                .unwrap();
            let settings = read(Path::new(&argv[2]));
            assert_eq!(settings["outputStyle"], "hold:Plain", "{role:?} {resume:?}");
        }
    }
}

#[test]
fn q11_the_users_output_style_replaces_plain() {
    for local in [false, true] {
        let s = setup();
        std::fs::write(
            s.root.path().join("settings.json"),
            r#"{"outputStyle":"Learning"}"#,
        )
        .unwrap();
        if local {
            let project = s.dir.parent().unwrap().join(".claude");
            std::fs::create_dir_all(&project).unwrap();
            std::fs::write(
                project.join("settings.local.json"),
                r#"{"outputStyle":"Personal"}"#,
            )
            .unwrap();
        }
        for role in [Role::Door, Role::Scout, Role::Agent] {
            for resume in [None, Some("saved-conversation")] {
                let argv = s
                    .launcher()
                    .prepare(folders(&s.dir), "7", "1", &s.cwd, resume, role)
                    .unwrap();
                // A source sets the style, so the file leaves it to Claude Code's own loading.
                let settings = read(Path::new(&argv[2]));
                assert!(settings.get("outputStyle").is_none(), "{local}");
            }
        }
    }
}

#[test]
fn q11_the_brief_has_no_output_style_copy() {
    let s = setup();
    for role in [Role::Door, Role::Scout, Role::Agent] {
        let text = brief(&s, "7", role);
        assert!(!text.contains("hold:Plain"), "{role:?}");
        assert!(!text.contains(&asset("hold-plain.md")), "{role:?}");
        assert!(!text.contains("## Output style"), "{role:?}");
    }
}

#[test]
fn a3564c_each_brief_separates_peer_and_user_questions() {
    let s = setup();
    for role in [Role::Agent, Role::Door, Role::Scout] {
        let text = brief(&s, "7", role);
        for rule in [
            "Only without a coordinator, ask the user with `AskUserQuestion`",
            "Ask another Agent with `message_send` as a question",
            "names your question in `replyTo`",
            "Never answer another Agent's `AskUserQuestion` or permission prompt, and never type into its Terminal.",
        ] {
            assert!(text.contains(rule), "{role:?}: {rule}");
        }
        assert!(!text.contains(&["ask", "user"].join("_")), "{role:?}");
        assert!(!text.contains("decision_answer"), "{role:?}");
    }
}

#[test]
fn a5482a_each_brief_routes_user_questions_by_coordinator() {
    for role in [Role::Agent, Role::Door, Role::Scout] {
        for mcp in [true, false] {
            let s = setup();
            let pair = agents::claude_code::LaunchFacts {
                mcp_off: !mcp,
                ..Default::default()
            };
            s.launcher()
                .prepare_on(&agents::claude_code::Request {
                    folders: folders(&s.dir),
                    id: "7",
                    attempt: "1",
                    cwd: &s.cwd,
                    resume: None,
                    role,
                    facts: &pair,
                })
                .unwrap();
            let text = std::fs::read_to_string(s.dir.join("agents/7.brief.md")).unwrap();
            let send = if mcp {
                "message_send"
            } else {
                "rup message send"
            };
            assert!(
                text.contains(&format!(
                    "send every question for the user to that Agent with `{send}` as a question"
                )),
                "{role:?} {mcp}"
            );
            assert!(text.contains("including choices reserved to the user"));
            assert!(text.contains(
                "never use `AskUserQuestion` or send the user to your Terminal for a choice"
            ));
        }
    }
}

#[test]
fn a5482b_lead_brief_answers_or_asks_in_its_own_terminal() {
    let text = brief(&setup(), "7", Role::Door);
    assert!(text.contains("Answer a child's question yourself when the order supplies the answer or delegates the choice to you"));
    assert!(text.contains("Preserve explicit user limits"));
    assert!(text.contains("Treat a question in a child's Digest last text the same way"));
    assert!(text.contains("Before deciding from `[cut]`, obtain the complete final reply"));
}

#[test]
fn q5561_pad_guidance_reaches_each_writer() {
    for role in [Role::Agent, Role::Door] {
        for mcp in [true, false] {
            let s = setup();
            let pair = agents::claude_code::LaunchFacts {
                mcp_off: !mcp,
                ..Default::default()
            };
            s.launcher()
                .prepare_on(&agents::claude_code::Request {
                    folders: folders(&s.dir),
                    id: "7",
                    attempt: "1",
                    cwd: &s.cwd,
                    resume: None,
                    role,
                    facts: &pair,
                })
                .unwrap();
            let text = std::fs::read_to_string(s.dir.join("agents/7.brief.md")).unwrap();
            for instruction in [
                "only what the user needs to read",
                "verdict first",
                "paths, commands, ids, logs and raw evidence",
                "one final folded section named `For Agents`",
                "<details><summary>For Agents</summary>",
                "closing `</details>`, without `open`",
                "inside the same trailing section",
                "Facts the user needs to decide or act stay in the body",
            ] {
                assert!(text.contains(instruction), "{role:?} {mcp}: {instruction}");
            }
            for tool in ["pad_create", "pad_write", "pad_append", "pad_appendSection"] {
                let name = if mcp {
                    tool.to_owned()
                } else {
                    match tool {
                        "pad_appendSection" => "rup pad append-section".to_owned(),
                        _ => format!("rup {}", tool.replacen("_", " ", 1)),
                    }
                };
                assert!(text.contains(&name), "{role:?} {mcp}: {name}");
            }
        }
    }
}

#[test]
fn q12_door_brief_says_a_message_stands_on_its_own() {
    let s = setup();
    let door = brief(&s, "7", Role::Door);
    for part in [
        "stands on its own",
        "(a) each fact the user needs to follow it, and to answer it when it asks",
        "(b) each choice shown as what the user would see or get, a sketch, a wireframe or rows, never a bare title",
        "(c) plain words for each term the user has not used",
        "(d) what each answer starts",
        "it never carries a fact the user needs",
        "Give the link of a Pad or Todo you point to",
    ] {
        assert!(door.contains(part), "{part}");
        assert!(!brief(&s, "7", Role::Agent).contains(part), "{part}");
    }
    assert!(door.contains("where the user answers or acts, the message holding the same question"));
    assert!(door.contains("link a Todo to a Pad"));
}

#[test]
fn al7_brief_says_to_copy_pad_and_todo_links() {
    let s = setup();
    for role in [Role::Agent, Role::Door] {
        let text = brief(&s, "7", role);
        assert!(
            text.contains(
                "give its clickable link, copied from the reply's `link` and never made up"
            ),
            "{role:?}"
        );
    }
}

fn stand_alone(name: &str) -> String {
    std::fs::read_to_string(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/stand-alone")
            .join(name),
    )
    .unwrap()
}

fn stand_alone_cases() -> Vec<String> {
    (1..=5).map(|n| format!("case-{n}")).collect()
}

fn stand_alone_missing(case: &str, text: &str) -> Vec<String> {
    stand_alone(&format!("{case}.facts"))
        .lines()
        .filter(|fact| !text.contains(fact))
        .map(str::to_owned)
        .collect()
}

#[test]
fn q12_fixed_reply_holds_every_fact() {
    for case in stand_alone_cases() {
        let fixed = stand_alone(&format!("{case}.fixed.md"));
        assert!(stand_alone_missing(&case, &fixed).is_empty(), "{case}");
    }
}

#[test]
fn q12_original_shows_the_gap() {
    for case in stand_alone_cases() {
        let original = stand_alone(&format!("{case}.md"));
        assert!(!stand_alone_missing(&case, &original).is_empty(), "{case}");
    }
}

#[test]
fn q12_fixed_reply_links_each_pad_and_todo() {
    for case in stand_alone_cases() {
        for line in stand_alone(&format!("{case}.fixed.md")).lines() {
            if line.contains("Pad") || line.contains("Todo") {
                assert!(
                    line.contains("roundup://pad/") || line.contains("roundup://todo/"),
                    "{case}: {line}"
                );
            }
        }
    }
}

#[test]
fn q12_the_check_rejects_a_dropped_fact() {
    for case in stand_alone_cases() {
        let facts = stand_alone(&format!("{case}.facts"));
        let fact = facts.lines().next().unwrap();
        let dropped = stand_alone(&format!("{case}.fixed.md")).replace(fact, "");
        assert!(
            stand_alone_missing(&case, &dropped).contains(&fact.to_owned()),
            "{case}"
        );
    }
}
