//! H21: which Agent a calling process is, from its place in the process tree and never from what
//! it claims. A process is an Agent when one of its ancestors, itself included, is the `claude`
//! the Daemon spawned for that Agent and that `claude` still runs.

use std::collections::HashMap;

/// A parent chain longer than this is not a real one.
const MAX_DEPTH: usize = 128;

/// The parent of process `pid`, or `None` when it cannot be read or is the root.
pub(crate) fn parent_of(pid: u32) -> Option<u32> {
    let parent = match std::fs::read_to_string(format!("/proc/{pid}/stat")) {
        // `pid (comm) state ppid …`: `comm` may hold spaces and parentheses, so cut after its last `)`.
        Ok(stat) => stat
            .rsplit_once(')')?
            .1
            .split_whitespace()
            .nth(1)?
            .parse()
            .ok()?,
        Err(_) => {
            let out = std::process::Command::new("ps")
                .args(["-o", "ppid=", "-p", &pid.to_string()])
                .output()
                .ok()?;
            String::from_utf8_lossy(&out.stdout).trim().parse().ok()?
        }
    };
    (parent > 0 && parent != pid).then_some(parent)
}

/// The Agent whose `claude` pid is `pid` or an ancestor of it, given `claudes` (pid to Agent id).
pub(crate) fn agent_above(
    pid: u32,
    claudes: &HashMap<u32, String>,
    parent_of: impl Fn(u32) -> Option<u32>,
) -> Option<String> {
    let mut at = Some(pid);
    for _ in 0..MAX_DEPTH {
        let current = at?;
        if let Some(agent) = claudes.get(&current) {
            return Some(agent.clone());
        }
        at = parent_of(current);
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn h21_a_caller_is_the_agent_whose_claude_it_descends_from() {
        let claudes = HashMap::from([(10, "a1".to_owned())]);
        let tree = |pid| match pid {
            30 => Some(20),
            20 => Some(10),
            10 => Some(1),
            _ => None,
        };
        assert_eq!(agent_above(30, &claudes, tree).as_deref(), Some("a1"));
        assert_eq!(agent_above(10, &claudes, tree).as_deref(), Some("a1"));
        assert_eq!(agent_above(40, &claudes, tree), None);
        assert_eq!(agent_above(20, &HashMap::new(), tree), None);
    }

    #[test]
    fn h21_a_parent_loop_is_no_agent() {
        let claudes = HashMap::from([(10, "a1".to_owned())]);
        assert_eq!(agent_above(5, &claudes, |_| Some(6)), None);
    }

    #[test]
    fn h21_the_parent_of_this_process_is_read() {
        assert!(parent_of(std::process::id()).is_some());
    }
}
