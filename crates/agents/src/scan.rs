//! F5: find, by name, a vendor program running under a Door that the Daemon did not start. The
//! names come from the Adapters (`claude_code::programs`); this file writes none. It reads the
//! process table once per scan and prevents nothing.

use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::process::{Command, Stdio};

use contracts::agent::Stray;

/// Programs that run the file named after them: their program name is that file's.
const INTERPRETERS: [&str; 7] = ["sh", "bash", "dash", "zsh", "node", "python", "python3"];

/// One row of `ps -o pid=,ppid=,comm=,args=`.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Row {
    pid: u32,
    ppid: u32,
    comm: String,
    args: String,
}

/// The process table as `ps` prints it, which macOS and Linux both do.
pub(crate) fn read_table() -> std::io::Result<String> {
    let out = Command::new("ps")
        .args(["-ax", "-ww", "-o", "pid=,ppid=,comm=,args="])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()?;
    if !out.status.success() {
        return Err(std::io::Error::other(format!("ps exited {}", out.status)));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// The rows of `table`; a row that is not `pid ppid comm args` is skipped.
pub(crate) fn parse(table: &str) -> Vec<Row> {
    table
        .lines()
        .filter_map(|line| {
            let (pid, rest) = line.trim_start().split_once(char::is_whitespace)?;
            let (ppid, rest) = rest.trim_start().split_once(char::is_whitespace)?;
            let rest = rest.trim_start();
            let (comm, args) = rest.split_once(char::is_whitespace).unwrap_or((rest, ""));
            Some(Row {
                pid: pid.parse().ok()?,
                ppid: ppid.parse().ok()?,
                comm: comm.to_owned(),
                args: args.trim().to_owned(),
            })
        })
        .collect()
}

fn base(path: &str) -> &str {
    Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(path)
}

/// The names a process answers to: the basename of its executable and of `argv[0]`, and, for an
/// interpreter, of the first argument that is not an option.
fn names(row: &Row) -> Vec<&str> {
    let mut words = row.args.split_whitespace();
    let argv0 = words.next().map_or("", base);
    let mut names = vec![base(&row.comm), argv0];
    if INTERPRETERS.contains(&argv0) {
        names.extend(words.find(|word| !word.starts_with('-')).map(base));
    }
    names
}

/// The processes below any process whose arguments hold `marker` (a Door's own program), not
/// those themselves, that go by one of `programs`. A Terminal the Daemon registered is a child of
/// the Daemon and so never below a Door; one the Door owns (M14) is scanned from its `terminals`
/// pids, below the program the Daemon started and not that program itself.
pub(crate) fn strays(
    table: &[Row],
    marker: &str,
    terminals: &[u32],
    programs: &[&str],
) -> Vec<Stray> {
    let own: HashSet<u32> = table
        .iter()
        .filter(|row| row.args.contains(marker))
        .map(|row| row.pid)
        .chain(terminals.iter().copied())
        .collect();
    let mut children: HashMap<u32, Vec<&Row>> = HashMap::new();
    for row in table {
        children.entry(row.ppid).or_default().push(row);
    }
    let mut found = Vec::new();
    let mut seen = own.clone();
    let mut pending: Vec<u32> = own.iter().copied().collect();
    while let Some(parent) = pending.pop() {
        for child in children.get(&parent).into_iter().flatten() {
            if !seen.insert(child.pid) {
                continue;
            }
            pending.push(child.pid);
            if names(child).iter().any(|name| programs.contains(name)) {
                found.push(Stray {
                    pid: child.pid,
                    command: child.args.clone(),
                });
            }
        }
    }
    found.sort_by_key(|stray| stray.pid);
    found
}

#[cfg(test)]
#[global_allocator]
pub(crate) static ALLOCATOR: &stats_alloc::StatsAlloc<std::alloc::System> =
    &stats_alloc::INSTRUMENTED_SYSTEM;

#[cfg(test)]
mod tests {
    use super::*;

    const TABLE: &str = "\
    1     0 init            /sbin/init
  100     1 fake-claude     sh /p/fake-claude --settings /p/7.settings.json
  101   100 sh              sh /tmp/x/claude --flag
  102   100 node            node /srv/mcp.js
  103   102 claude          claude -p hi
  104   100 sleep           sleep 30
  200     1 claude          claude --version
  105   101 sleep           sleep 5
";

    #[test]
    fn f5_a_vendor_name_below_the_door_is_a_stray_by_executable_or_by_interpreter_argument() {
        let found = strays(&parse(TABLE), "/p/7.settings.json", &[], &["claude"]);

        let pids: Vec<_> = found.iter().map(|stray| stray.pid).collect();
        assert_eq!(pids, [101, 103]);
        assert_eq!(found[1].command, "claude -p hi");
    }

    #[test]
    fn f5_the_door_itself_and_a_row_outside_its_tree_are_not_strays() {
        let table = parse(TABLE);

        assert!(strays(&table, "/p/7.settings.json", &[], &["other"]).is_empty());
        assert!(strays(&table, "/p/8.settings.json", &[], &["claude"]).is_empty());
    }

    #[test]
    fn f5_a_row_that_is_not_a_row_is_skipped() {
        assert_eq!(parse("garbage\n\n  x y z\n 5 6 comm\n").len(), 1);
    }
    fn snapshot() -> String {
        use std::fmt::Write;
        let mut text = String::new();
        for door in 1..=10 {
            let root = door * 100;
            writeln!(text, "{root} 1 shell shell marker-{door}-").unwrap();
            for child in 1..=20 {
                writeln!(
                    text,
                    "{} {} vendor vendor --child",
                    root + child,
                    root + child - 1
                )
                .unwrap();
            }
        }
        for pid in 2000..2200 {
            writeln!(text, "{pid} 1 unrelated unrelated --idle").unwrap();
        }
        text
    }

    #[test]
    fn r5636e_scan_allocated_bytes() {
        for doors in [1, 10] {
            let text = snapshot();
            let markers: Vec<_> = (1..=doors).map(|door| format!("marker-{door}-")).collect();
            let region = stats_alloc::Region::new(ALLOCATOR);
            let table = parse(&text);
            let prepared = region.change();
            for marker in &markers {
                std::hint::black_box(strays(&table, marker, &[], &["vendor"]));
            }
            let total = region.change();
            eprintln!(
                "SCAN doors={doors} prep={prepared:?} walk={:?} total={total:?}",
                total - prepared
            );
            // Base 767fa083: 65,557 / 314,713 bytes for this 410-row fixture.
            assert!(total.bytes_allocated < if doors == 1 { 60_000 } else { 120_000 });
        }
    }
    fn pids(found: Vec<Stray>) -> Vec<u32> {
        found.into_iter().map(|stray| stray.pid).collect()
    }

    #[test]
    fn r5636a_owned_terminal_roots_are_excluded() {
        let table = parse(
            "100 1 vendor vendor marker\n101 100 vendor vendor\n200 1 vendor vendor\n201 200 vendor vendor\n300 1 vendor vendor\n301 300 vendor vendor",
        );
        assert_eq!(
            pids(strays(&table, "marker", &[101, 200], &["vendor"])),
            [201]
        );
    }

    #[test]
    fn r5636a_matching_keeps_pid_order() {
        let table = parse(
            "100 1 shell shell marker\n111 100 no no\n110 100 /bin/vendor unrelated\n109 100 no /opt/vendor\n108 100 sh sh -c /opt/vendor\n107 100 bash bash -x /opt/vendor\n106 100 dash dash /opt/vendor\n105 100 zsh zsh /opt/vendor\n104 100 node node --flag /opt/vendor\n103 100 python python -u /opt/vendor\n102 100 python3 python3 /opt/vendor\n101 100 node node other vendor",
        );
        assert_eq!(
            pids(strays(&table, "marker", &[], &["vendor"])),
            (102..=110).collect::<Vec<_>>()
        );
    }

    #[test]
    fn r5636a_sparse_and_cyclic_processes_terminate() {
        let table = parse(
            "4294967294 900 vendor vendor\n10 11 vendor vendor marker\n11 10 vendor vendor\n12 11 vendor vendor\n20 20 vendor vendor marker\n21 20 vendor vendor\n30 999 vendor vendor",
        );
        assert_eq!(
            pids(strays(&table, "marker", &[900, 11], &["vendor"])),
            [12, 21, 4294967294]
        );
    }

    #[test]
    fn r5636d_pid_reuse_uses_only_the_new_snapshot() {
        let first =
            parse("100 1 shell shell marker\n101 100 vendor vendor old\n102 101 vendor vendor");
        assert_eq!(pids(strays(&first, "marker", &[], &["vendor"])), [101, 102]);
        let second = parse(
            "100 1 shell shell marker\n101 9 vendor vendor new\n102 101 vendor vendor\n103 100 vendor vendor fresh",
        );
        let found = strays(&second, "marker", &[], &["vendor"]);
        assert_eq!(pids(found.clone()), [103]);
        assert_eq!(found[0].command, "vendor fresh");
    }
}
