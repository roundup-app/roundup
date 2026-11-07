use rpc::RpcError;
use std::time::Duration;

/// Methods that write nothing: a timeout on one leaves no outcome unknown (U5301b).
fn writes_nothing(method: &str) -> bool {
    const READS: [&str; 20] = [
        "list",
        "get",
        "read",
        "tree",
        "describe",
        "digest",
        "context",
        "extras",
        "instructions",
        "skills",
        "snapshot",
        "screen",
        "search",
        "history",
        "touched",
        "worktreeState",
        "comments",
        "getHistory",
        "listHanded",
        "preview",
    ];
    method
        .split_once('.')
        .is_some_and(|(_, name)| READS.contains(&name))
}

pub(crate) fn unanswered(method: &str, bound: Duration) -> RpcError {
    if writes_nothing(method) {
        RpcError::internal(format!("no reply to {method} within {bound:?}"))
    } else {
        RpcError::internal(format!(
            "no reply to {method} within {bound:?}; whether the Daemon applied it is unknown"
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    const BOUND: Duration = Duration::from_secs(5);

    #[test]
    fn u5301b_a_timed_out_read_says_the_daemon_did_not_answer() {
        for method in ["todo.list", "pad.list", "rail.tree"] {
            let message = unanswered(method, BOUND).message;
            assert!(message.starts_with(&format!("no reply to {method} within")));
            assert!(!message.contains("unknown"), "{message}");
        }
    }

    #[test]
    fn u5301b_a_timed_out_mutation_stays_unknown() {
        for method in ["rail.remove", "todo.create"] {
            assert!(
                unanswered(method, BOUND)
                    .message
                    .contains("whether the Daemon applied it is unknown")
            );
        }
    }
}
