//! H21: which Agent a calling process is, from its place in the process tree and never from what
//! it claims. A process is an Agent when one of its ancestors, itself included, is the `claude`
//! the Daemon spawned for that Agent and that `claude` still runs.

use std::collections::HashMap;

/// A parent chain longer than this is not a real one.
const MAX_DEPTH: usize = 128;

/// Parent lookups made so far, for the test that counts them per write.
#[cfg(feature = "test-support")]
static LOOKUPS: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

/// Parent lookups made so far in this process.
#[cfg(feature = "test-support")]
pub fn parent_lookups() -> usize {
    LOOKUPS.load(std::sync::atomic::Ordering::Relaxed)
}

/// The parent of process `pid`, or `None` when it cannot be read or is the root. Reads the kernel
/// directly and never starts a process: a spawn per ancestor costs a frame on every Terminal write.
pub(crate) fn parent_of(pid: u32) -> Option<u32> {
    #[cfg(feature = "test-support")]
    LOOKUPS.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let parent = native_parent(pid)?;
    (parent > 0 && parent != pid).then_some(parent)
}

#[cfg(target_os = "macos")]
fn native_parent(pid: u32) -> Option<u32> {
    let info =
        libproc::proc_pid::pidinfo::<libproc::bsd_info::BSDInfo>(i32::try_from(pid).ok()?, 0)
            .ok()?;
    Some(info.pbi_ppid)
}

#[cfg(not(target_os = "macos"))]
fn native_parent(pid: u32) -> Option<u32> {
    // `pid (comm) state ppid …`: `comm` may hold spaces and parentheses, so cut after its last `)`.
    std::fs::read_to_string(format!("/proc/{pid}/stat"))
        .ok()?
        .rsplit_once(')')?
        .1
        .split_whitespace()
        .nth(1)?
        .parse()
        .ok()
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
    fn r3696a_parent_walk_spawns_no_process() {
        const CHILD: &str = "R3696A_SHIM";
        if let Some(ran) = std::env::var_os(CHILD) {
            assert_eq!(
                parent_of(std::process::id()),
                Some(std::os::unix::process::parent_id())
            );
            assert!(
                !std::path::Path::new(&ran).exists(),
                "the parent lookup ran `ps`"
            );
            return;
        }
        // Re-run this test with a `ps` shim first on `PATH`, which marks the file if it runs.
        let dir = tempfile::tempdir().unwrap();
        let ran = dir.path().join("ran");
        let shim = dir.path().join("ps");
        std::fs::write(&shim, format!("#!/bin/sh\ntouch '{}'\n", ran.display())).unwrap();
        std::fs::set_permissions(&shim, std::os::unix::fs::PermissionsExt::from_mode(0o755))
            .unwrap();
        let path = std::env::var_os("PATH").unwrap_or_default();
        let shimmed = std::env::join_paths(
            std::iter::once(dir.path().to_path_buf()).chain(std::env::split_paths(&path)),
        )
        .unwrap();
        let status = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "peer::tests::r3696a_parent_walk_spawns_no_process",
            ])
            .env("PATH", shimmed)
            .env(CHILD, &ran)
            .status()
            .unwrap();
        assert!(status.success());
    }
}
