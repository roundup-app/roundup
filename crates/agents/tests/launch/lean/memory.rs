//! LC19–LC20: exercise the launch artifacts and the same hook handler the command runs.
use super::*;

fn guard(settings: &Value) -> Option<&Value> {
    settings["hooks"]["PreToolUse"].as_array()?.iter().find(|hook| hook["matcher"] == "Write|Edit")
}

#[test]
fn lc19_lean_starts_include_memory_tools_and_guard() {
    for (row, role, pair) in lean_children().into_iter().take(2) {
        for mcp_off in [false, true] {
            for yolo in [false, true] {
                for resume in [None, Some("saved-conversation")] {
                    let s = setup();
                    let pair = Pair { mcp_off, yolo, ..pair.clone() };
                    let argv = s.prepare_lean("7", role, &pair, resume).unwrap();
                    let tools: Vec<_> = Setup::after(&argv, "--tools").unwrap().split(',').collect();
                    assert!(tools.contains(&"Write") && tools.contains(&"Edit"), "{row:?}");
                    let settings = read(Path::new(Setup::after(&argv, "--settings").unwrap()));
                    let hook = &guard(&settings).expect("memory guard")["hooks"][0];
                    assert_eq!(hook["type"], "command");
                    assert_eq!(hook["onFailure"], "block");
                    assert_ne!(hook["async"], true);
                    let command = shlex::split(hook["command"].as_str().unwrap()).unwrap();
                    assert_eq!(Path::new(&command[0]), s.rup);
                    assert_eq!(command[1], "claude-memory");
                    let brief = std::fs::read_to_string(Setup::after(&argv, "--append-system-prompt-file").unwrap()).unwrap();
                    assert!(brief.contains("Memory is the only files you write yourself"));
                    assert!(brief.contains("child Agent"));
                }
            }
        }
    }
}
