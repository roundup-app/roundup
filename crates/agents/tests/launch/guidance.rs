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
        assert_eq!(text, brief(&s, "7", role));
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
    assert!(!agent.contains("coordinating Door"));
}

#[test]
fn q11_a_worker_gets_plain_for_every_reply() {
    let s = setup();
    let text = brief(&s, "7", Role::Agent);
    assert!(text.contains("Write every reply, including direct Terminal prose, in hold:Plain regardless of recipient or tool."));
    assert!(text.contains(&asset("hold-plain.md")));
}

#[test]
fn q11_the_users_output_style_replaces_plain() {
    let s = setup();
    std::fs::write(
        s.root.path().join("settings.json"),
        r#"{"outputStyle":"Learning"}"#,
    )
    .unwrap();
    let project = s.dir.parent().unwrap().join(".claude");
    std::fs::create_dir_all(&project).unwrap();
    std::fs::write(
        project.join("settings.local.json"),
        r#"{"outputStyle":"Personal"}"#,
    )
    .unwrap();
    for role in [Role::Door, Role::Scout, Role::Agent] {
        let argv = s.prepare_as("7", role).unwrap();
        let settings = read(Path::new(&argv[2]));
        assert_eq!(settings["outputStyle"], "Personal");
        let text = brief(&s, "7", role);
        assert!(!text.contains("hold:Plain"));
        assert!(!text.contains(&asset("hold-plain.md")));
        assert!(!text.contains("## Output style"));
        assert_eq!(text, brief(&s, "8", role));
    }
}

#[test]
fn a3564c_each_brief_separates_peer_and_user_questions() {
    let s = setup();
    for role in [Role::Agent, Role::Door] {
        let text = brief(&s, "7", role);
        for rule in [
            "Ask the user with `AskUserQuestion`",
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
