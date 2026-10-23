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
fn b24_only_a_door_brief_carries_the_role_guidance() {
    let s = setup();
    let door = brief(&s, "7", Role::Door);
    let agent = brief(&s, "8", Role::Agent);
    assert!(door.contains("coordinating Door"));
    assert!(door.contains("ask directly in your Terminal"));
    assert!(
        !door
            .split("## Your role")
            .nth(1)
            .unwrap()
            .contains("ask_user")
    );
    assert!(door.contains("Report the outcome directly in your Terminal"));
    // M9: the tool list names `rail_startDoor`; no other line of an Agent's Brief speaks of a Door.
    assert!(
        agent
            .lines()
            .filter(|line| !line.starts_with("- `"))
            .all(|line| !line.contains("Door"))
    );
    assert!(!agent.contains("Your role"));
}

#[test]
fn f8_the_door_brief_delegates_and_uses_its_terminal() {
    let s = setup();
    let text = brief(&s, "7", Role::Door);
    let role = text.split("## Your role").nth(1).unwrap();
    for instruction in [
        "The user types to you in your own Terminal",
        "Delegate implementation to children with `agent_spawn`",
        "You cannot execute commands or open or write to a Terminal",
        "Report the outcome directly in your Terminal",
        "ask directly in your Terminal",
        "`checkpoint_write`",
        "`order`",
        "`prompt`",
        "You write orders only for the Agents you spawn",
    ] {
        assert!(role.contains(instruction), "missing {instruction}: {role}");
    }
    assert!(!text.contains("Thread"));
    assert!(!text.contains("`message_send` to `you`"));
    assert!(!role.contains("only through `terminal_spawn`"));
    let messaging = text
        .lines()
        .find(|line| line.starts_with("- `message_send`:"))
        .unwrap();
    assert!(!messaging.contains("another Agent or the user"));
    assert!(messaging.contains("speak to the user directly in your own Terminal"));
}

#[test]
fn f8_each_brief_terminal_description_states_the_bubble_rule() {
    let s = setup();
    let door = brief(&s, "7", Role::Door);
    for tool in ["agent_run", "terminal_spawn", "terminal_open"] {
        assert!(
            !door.contains(&format!("- `{tool}`:")),
            "M16: the Door has {tool}"
        );
    }
    for role in [Role::Agent] {
        let text = brief(&s, "7", role);
        for tool in ["agent_run", "terminal_spawn", "terminal_open"] {
            let prefix = format!("- `{tool}`:");
            let entry = text.lines().find(|line| line.starts_with(&prefix)).unwrap();
            for rule in [
                "use your own tools for commands",
                "open a Bubble only when the user needs to see its output or will interactively type into it",
                "Routine builds, tests and inspection use your own tools",
            ] {
                assert!(entry.contains(rule), "{tool} missing {rule}: {entry}");
            }
        }
    }
}

#[test]
fn a28_a_doors_brief_says_to_name_each_child() {
    let s = setup();
    assert!(brief(&s, "7", Role::Door).contains("Give each child a `name` after its task."));
}

#[test]
fn e1_preparing_the_same_id_and_role_twice_writes_the_same_text() {
    let s = setup();
    assert_eq!(brief(&s, "7", Role::Door), brief(&s, "7", Role::Door));
}

#[test]
fn f3_every_brief_names_agent_spawn_and_only_a_doors_says_it_has_no_shell() {
    let s = setup();

    let door = brief(&s, "7", Role::Door);
    let agent = brief(&s, "8", Role::Agent);

    assert!(door.contains("- `agent_spawn`:"));
    assert!(door.contains("`message_send`"));
    assert!(door.contains("You cannot execute commands or open or write to a Terminal"));
    assert!(agent.contains("- `agent_spawn`:"));
    assert!(!agent.contains("You cannot execute commands or open or write to a Terminal"));
}

#[test]
fn m10_a_doors_brief_names_checkpoint_write_and_no_other_does() {
    let s = setup();

    let door = brief(&s, "7", Role::Door);
    let agent = brief(&s, "8", Role::Agent);

    assert!(door.contains("- `checkpoint_write`:"));
    assert!(door.contains("`reduce`") && door.contains("`show-me`"));
    assert!(door.contains("facts needed to understand that point in the work"));
    assert!(!agent.contains("checkpoint_write"));
    assert!(agent.contains("- `checkpoint_list`:"));
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
