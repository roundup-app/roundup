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
    assert!(text.contains("write the diagram in a Pad and send the Pad's name"));
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

/// Q8 (b): the facts missing from `text`.
fn missing_facts(text: &str) -> Vec<String> {
    lines("door-question.facts")
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
    assert!(missing_facts(&fixture("door-question.md")).is_empty());
    assert!(missing_facts(&fixture("door-question.reduced.md")).is_empty());
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
    assert_eq!(missing_facts(&dropped), ["Friday 14 Nov"]);
}

#[test]
fn q9_door_guidance_names_the_four_paddings() {
    let s = setup();
    let text = brief(&s, "7", Role::Door);
    for rule in [
        "Open a question with the question.",
        "State a guess once, as a choice to confirm.",
        "Write a list as the choices and nothing around them.",
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
                let settings = read(Path::new(&argv[2]));
                assert_eq!(
                    settings["outputStyle"],
                    if local { "Personal" } else { "Learning" }
                );
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
fn a5482a_each_brief_routes_every_child_question_to_its_coordinator() {
    for role in [Role::Agent, Role::Door, Role::Scout] {
        for mcp in [true, false] {
            let text = agents::claude_code::brief::text(role, mcp);
            let send = if mcp { "message_send" } else { "rup message send" };
            assert!(text.contains(&format!("send every question for the user to that Agent with `{send}` as a question")), "{role:?} {mcp}");
            assert!(text.contains("including choices reserved to the user"));
            assert!(text.contains("never use `AskUserQuestion` or send the user to your Terminal for a choice"));
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
