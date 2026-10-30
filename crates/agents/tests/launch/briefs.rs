use super::*;

#[test]
fn e9_two_agents_of_one_role_get_equal_brief_bytes() {
    let s = setup();
    assert_eq!(
        brief(&s, "7013", Role::Agent),
        brief(&s, "7014", Role::Agent)
    );
    assert_eq!(brief(&s, "7013", Role::Door), brief(&s, "7014", Role::Door));
    assert_eq!(
        brief(&s, "7013", Role::Scout),
        brief(&s, "7014", Role::Scout)
    );
}

#[test]
fn e9_the_brief_holds_no_id() {
    let s = setup();
    let text = brief(&s, "7013", Role::Agent);
    assert!(!text.contains("7013") && !text.contains("Agent id"));
    assert!(text.contains("Context you get at start"));
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
    assert!(door.contains("ask with `AskUserQuestion`"));
    assert!(door.contains("Report the outcome directly in your Terminal"));
    // B4699c permits block-reporting guidance, but no coordinating-role instructions.
    assert!(
        agent
            .lines()
            .filter(|line| !line.starts_with("- `"))
            .all(|line| !line.contains("Door")
                || line.starts_with("If you have a coordinating Door"))
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
        "ask with `AskUserQuestion`",
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
fn b4699a_the_door_brief_delegates_shaping_to_one_child() {
    let text = brief(&setup(), "7", Role::Door);
    assert!(text.contains("When the user asks to shape an ask, spawn exactly one shaping child under yourself in this Workstream with `agent_spawn`, then direct the user to that child's Terminal to shape it there; do not shape inline or call `rail_createWorkstream` or `rail_startDoor` for this request."));
}

#[test]
fn b4699b_the_door_brief_forbids_reasking_for_authorized_actions() {
    let text = brief(&setup(), "7", Role::Door);
    assert!(text.contains("Never add a child limit asking the user to approve an action they already authorized, such as asking before each `gh issue create`. Preserve their actual limits and the vendor's permission mechanism."));
}

#[test]
fn b4699c_each_brief_routes_child_blocks_to_the_door() {
    let s = setup();
    for role in [Role::Door, Role::Agent, Role::Scout] {
        let text = brief(&s, "7", role);
        assert!(text.contains("If you have a coordinating Door and cannot proceed within your order, report the block and the decision needed to that Door with `message_send`, not `AskUserQuestion`; engineering choices within existing authorization go to the Door."), "{role:?}");
        assert!(text.contains("Only a decision reserved to the user by their stated limits, or an unresolved goal or taste choice, goes to the user with `AskUserQuestion`. A vendor permission prompt remains the user's to answer; never seek its answer from the Door."), "{role:?}");
        if role == Role::Door {
            assert!(text.contains("Include in child orders: report blocks and the decision needed to this Door with `message_send`; ask the user only for decisions that are theirs alone, and leave vendor permission prompts to them."));
        }
    }
}

#[test]
fn e3_workstream_guidance_precedes_tools() {
    let s = setup();
    for mcp in [true, false] {
        for role in [Role::Door, Role::Agent, Role::Scout] {
            s.launcher()
                .prepare_on(
                    folders(&s.dir),
                    "7",
                    "1",
                    &s.cwd,
                    None,
                    role,
                    &agents::claude_code::Pair {
                        mcp_off: !mcp,
                        ..Default::default()
                    },
                )
                .unwrap();
            let text = std::fs::read_to_string(s.dir.join("agents/7.brief.md")).unwrap();
            let catalogue = text
                .find(if mcp { "## Tools" } else { "## Commands" })
                .unwrap();
            let guidance = text.find("## Working in a Workstream");
            if role != Role::Door {
                assert!(
                    guidance.is_none(),
                    "membership belongs in start Context: {role:?}"
                );
                continue;
            }
            assert!(guidance.unwrap() < catalogue);
            for rule in [
                "Before starting a task",
                "two or more steps",
                "before editing files, running repairs or delegating work",
                "at least two saved roundup task Todos",
                "even when the user did not ask",
                "As each outcome lands",
                "do not defer completion until handoff",
                "before arranging a wait or handing off",
                "A plan in prose, a vendor task list or a Reaction instruction does not replace",
                "without approval",
                "reason",
                "end your turn",
                "never poll",
                "user moves win",
            ] {
                assert!(text[..catalogue].contains(rule), "missing {rule}");
            }
            let entries = text[catalogue..].split("\n\n").nth(2).unwrap();
            assert!(!entries.is_empty());
            for entry in entries.lines() {
                assert!(
                    entry.starts_with("- `"),
                    "one physical line per tool: {entry}"
                );
                assert!(
                    entry.split_whitespace().count() <= 25,
                    "catalogue entry exceeds 24 words (excluding bullet): {entry}"
                );
            }
            if mcp {
                assert!(
                    text.contains("ToolSearch") && text.contains("select:mcp__roundup__<name>,…")
                );
                assert!(text.contains(
                    "Load `agent_context`, `message_list` and `agent_digest` together first."
                ));
                assert!(!text.contains("Load every tool"));
            } else {
                assert!(text.contains("rup help"));
            }
        }
    }
}

#[test]
fn b5168e_the_door_brief_names_the_tools_and_the_ask_once_rule() {
    let text = brief(&setup(), "7", Role::Door);
    for tool in [
        "github_pr_get",
        "github_issue_get",
        "github_pr_set_body",
        "github_pr_ready",
        "github_pr_auto_merge",
    ] {
        assert!(text.contains(&format!("- `{tool}`: ")), "{tool}");
    }
    assert!(text.contains("never ask the user to run `gh` for it"));
    assert!(text.contains("you do not restate it unless something changed since you made it"));
}

#[test]
fn b5168g_no_coordinator_brief_asks_the_user_to_run_a_covered_gh_command() {
    let s = setup();
    for role in [Role::Door, Role::Agent] {
        let text = brief(&s, "7", role);
        for command in [
            "gh pr view",
            "gh pr edit",
            "gh pr ready",
            "gh pr merge --auto",
            "gh issue view",
        ] {
            assert!(!text.contains(command), "{command}");
        }
    }
}
