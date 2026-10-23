//! E1, E9, Q1–Q9: stable Brief contents and pinned assets.
use super::*;

#[test]
fn e9_two_agents_of_one_role_get_equal_brief_bytes() {
    let s = setup();
    assert_eq!(
        brief(&s, "7013", Role::Agent),
        brief(&s, "7014", Role::Agent)
    );
    assert_eq!(brief(&s, "7013", Role::Door), brief(&s, "7014", Role::Door));
}

#[test]
fn e9_the_brief_holds_no_id() {
    let s = setup();
    let text = brief(&s, "7013", Role::Agent);
    assert!(!text.contains("7013") && !text.contains("Agent id"));
    assert!(text.contains("Context you get at start"));
}

#[test]
fn e9_a_door_and_an_ordinary_agent_still_differ() {
    let s = setup();
    assert_ne!(brief(&s, "7", Role::Agent), brief(&s, "8", Role::Door));
}

#[test]
fn e1_the_brief_names_the_tools_and_holds_nothing_mutable() {
    let s = setup();
    let text = brief(&s, "7", Role::Agent);
    assert!(!text.contains("Agent id is 7"));
    assert!(text.contains("supervises you"));
    for tool in [
        "todo_create",
        "todo_update",
        "pad_write",
        "pad_append",
        "message_send",
        "ask_user",
        "agent_context",
    ] {
        assert!(text.contains(&format!("`{tool}`")), "{tool}");
    }
    assert!(text.contains("`agent_spawn`"), "agent_spawn");
    assert!(!text.contains(&s.cwd.to_string_lossy().into_owned()));
}

#[test]
fn e1_the_flag_adds_to_the_argv_and_leaves_the_users_files_alone() {
    let s = setup();
    std::fs::write(s.cwd.join("CLAUDE.md"), "mine").unwrap();
    for role in [Role::Agent, Role::Door] {
        let argv = s.prepare_as("7", role).unwrap();
        assert_eq!(argv[..5], s.prepare_as("7", role).unwrap()[..5]);
        assert_eq!(
            std::fs::read_to_string(s.cwd.join("CLAUDE.md")).unwrap(),
            "mine"
        );
        assert!(!s.cwd.join(".claude").exists());
    }
}

#[test]
fn e1_preparing_the_same_id_and_role_twice_writes_the_same_text() {
    let s = setup();
    assert_eq!(brief(&s, "7", Role::Door), brief(&s, "7", Role::Door));
}

#[test]
fn e3_the_signal_stays_first_and_the_context_command_follows_with_five_seconds() {
    let s = setup();
    let settings = read(Path::new(&s.prepare("7").unwrap()[2]));
    let at_start = settings["hooks"]["SessionStart"][0]["hooks"]
        .as_array()
        .unwrap();
    assert_eq!(at_start.len(), 2);
    assert!(
        at_start[0]["command"]
            .as_str()
            .unwrap()
            .contains(" signal '7'")
    );
    assert_eq!(at_start[1]["timeout"], 5);
    assert!(
        at_start[1]["command"]
            .as_str()
            .unwrap()
            .ends_with(" context '7'")
    );
}

#[test]
fn q1_pin() {
    use sha2::{Digest, Sha256};
    let bytes =
        std::fs::read(Path::new(env!("CARGO_MANIFEST_DIR")).join("assets/hold-plain.md")).unwrap();
    let hex: String = Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    assert_eq!(
        hex,
        "0f2c26f0cea8ba39af771d2fdb09db6ae4a7a90c64c272a0a0e967f420e9af1e"
    );
}

#[test]
fn q1_brief() {
    let s = setup();
    let body =
        std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("assets/hold-plain.md"))
            .unwrap();
    let text = brief(&s, "7", Role::Agent);
    assert!(text.contains(&body));
    assert!(text.contains("Digest and Pad reply"));
    assert!(text.contains("Write each limit of a Work order as a rule that reads on its own"));
}

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
            "Run `reduce` on every Work order, Message to `you`, `ask_user` question, Digest, Pad reply and Todo title"
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
fn q11_a_worker_gets_plain_for_every_reply() {
    let s = setup();
    let text = brief(&s, "7", Role::Agent);
    assert!(text.contains("Write every reply, including direct Terminal prose, in hold:Plain regardless of recipient or tool."));
    assert!(text.contains(&asset("hold-plain.md")));
}
