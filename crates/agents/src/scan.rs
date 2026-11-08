//! F5: find, by name, a vendor program running under a Door that the Daemon did not start. The
//! names come from the Adapters (`claude_code::programs`); this file writes none. It reads the
//! process table once per scan and prevents nothing.

use std::path::Path;
use std::process::{Command, Stdio};

use contracts::agent::Stray;

/// Programs that run the file named after them: their program name is that file's.
const INTERPRETERS: [&str; 7] = ["sh", "bash", "dash", "zsh", "node", "python", "python3"];

/// One row of `ps -o pid=,ppid=,comm=,args=`.
#[derive(Debug, PartialEq, Eq)]
struct Row<'a> {
    pid: u32,
    ppid: u32,
    comm: &'a str,
    args: &'a str,
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

/// A topology belongs to the borrowed snapshot; only published Strays outlive it.
pub(crate) struct Table<'a> {
    rows: Vec<Row<'a>>,
    children: Vec<usize>,
    parents: Vec<(u32, std::ops::Range<usize>)>,
    seen: Vec<bool>,
    pending: Vec<u32>,
    #[cfg(test)]
    edges: usize,
}

/// The rows of `table`; a row that is not `pid ppid comm args` is skipped.
pub(crate) fn parse(table: &str) -> Table<'_> {
    let mut rows: Vec<_> = table
        .lines()
        .filter_map(|line| {
            let (pid, rest) = line.trim_start().split_once(char::is_whitespace)?;
            let (ppid, rest) = rest.trim_start().split_once(char::is_whitespace)?;
            let rest = rest.trim_start();
            let (comm, args) = rest.split_once(char::is_whitespace).unwrap_or((rest, ""));
            Some(Row {
                pid: pid.parse().ok()?,
                ppid: ppid.parse().ok()?,
                comm,
                args: args.trim(),
            })
        })
        .collect();
    rows.sort_unstable_by_key(|row| row.pid);
    let mut children: Vec<_> = (0..rows.len()).collect();
    children.sort_unstable_by_key(|&index| rows.get(index).map(|row| row.ppid));
    #[cfg(test)]
    BUILDS.with(|count| count.set(count.get() + 1));
    let mut parents: Vec<(u32, std::ops::Range<usize>)> = Vec::with_capacity(rows.len());
    for (at, parent) in children
        .iter()
        .enumerate()
        .filter_map(|(at, &index)| Some((at, rows.get(index)?.ppid)))
    {
        if let Some((last, range)) = parents.last_mut()
            && *last == parent
        {
            range.end = at + 1;
        } else {
            parents.push((parent, at..at + 1));
        }
    }
    Table {
        seen: vec![false; rows.len()],
        pending: Vec::with_capacity(rows.len()),
        rows,
        children,
        parents,
        #[cfg(test)]
        edges: 0,
    }
}

fn base(path: &str) -> &str {
    Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(path)
}

fn is_program(row: &Row<'_>, programs: &[&str]) -> bool {
    let mut words = row.args.split_whitespace();
    let argv0 = words.next().map_or("", base);
    programs.contains(&base(row.comm))
        || programs.contains(&argv0)
        || (INTERPRETERS.contains(&argv0)
            && words
                .find(|word| !word.starts_with('-'))
                .is_some_and(|word| programs.contains(&base(word))))
}

/// Door-owned roots are excluded even when another owned root reaches them.
pub(crate) fn strays(
    table: &mut Table<'_>,
    marker: &str,
    terminals: &[u32],
    programs: &[&str],
) -> Vec<Stray> {
    table.seen.fill(false);
    table.pending.clear();
    #[cfg(test)]
    {
        table.edges = 0;
    }
    for (row, seen) in table.rows.iter().zip(table.seen.iter_mut()) {
        if row.args.contains(marker) {
            *seen = true;
            table.pending.push(row.pid);
        }
    }
    for &pid in terminals {
        if let Ok(index) = table.rows.binary_search_by_key(&pid, |row| row.pid)
            && let Some(seen) = table.seen.get_mut(index)
        {
            if *seen {
                continue;
            }
            *seen = true;
        }
        // Missing Terminal roots still own rows whose parent PID names them.
        table.pending.push(pid);
    }
    // Duplicate missing roots must not cause repeated edge visits either.
    table.pending.sort_unstable();
    table.pending.dedup();
    let mut found = Vec::new();
    while let Some(parent) = table.pending.pop() {
        let Ok(at) = table.parents.binary_search_by_key(&parent, |(pid, _)| *pid) else {
            continue;
        };
        let Some(kids) = table
            .parents
            .get(at)
            .and_then(|(_, range)| table.children.get(range.clone()))
        else {
            continue;
        };
        for &index in kids {
            #[cfg(test)]
            {
                table.edges += 1;
            }
            let (Some(seen), Some(child)) = (table.seen.get_mut(index), table.rows.get(index))
            else {
                continue;
            };
            if std::mem::replace(seen, true) {
                continue;
            }
            table.pending.push(child.pid);
            if is_program(child, programs) {
                found.push(Stray {
                    pid: child.pid,
                    command: child.args.to_owned(),
                });
            }
        }
    }
    found.sort_unstable_by_key(|stray| stray.pid);
    found
}

#[cfg(test)]
thread_local! { static BUILDS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) }; }

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
        let found = strays(&mut parse(TABLE), "/p/7.settings.json", &[], &["claude"]);

        let pids: Vec<_> = found.iter().map(|stray| stray.pid).collect();
        assert_eq!(pids, [101, 103]);
        assert_eq!(found[1].command, "claude -p hi");
    }

    #[test]
    fn f5_the_door_itself_and_a_row_outside_its_tree_are_not_strays() {
        let mut table = parse(TABLE);

        assert!(strays(&mut table, "/p/7.settings.json", &[], &["other"]).is_empty());
        assert!(strays(&mut table, "/p/8.settings.json", &[], &["claude"]).is_empty());
    }

    #[test]
    fn f5_a_row_that_is_not_a_row_is_skipped() {
        assert_eq!(parse("garbage\n\n  x y z\n 5 6 comm\n").rows.len(), 1);
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
            let region = stats_alloc::Region::new(crate::ALLOCATOR);
            let mut table = parse(&text);
            let prepared = region.change();
            for marker in &markers {
                std::hint::black_box(strays(&mut table, marker, &[], &["vendor"]));
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
        let mut table = parse(
            "100 1 vendor vendor marker\n101 100 vendor vendor\n200 1 vendor vendor\n201 200 vendor vendor\n300 1 vendor vendor\n301 300 vendor vendor",
        );
        assert_eq!(
            pids(strays(&mut table, "marker", &[101, 200], &["vendor"])),
            [201]
        );
    }

    #[test]
    fn r5636a_matching_keeps_pid_order() {
        let mut table = parse(
            "100 1 shell shell marker\n111 100 no no\n110 100 /bin/vendor unrelated\n109 100 no /opt/vendor\n108 100 sh sh -c /opt/vendor\n107 100 bash bash -x /opt/vendor\n106 100 dash dash /opt/vendor\n105 100 zsh zsh /opt/vendor\n104 100 node node --flag /opt/vendor\n103 100 python python -u /opt/vendor\n102 100 python3 python3 /opt/vendor\n101 100 node node other vendor",
        );
        assert_eq!(
            pids(strays(&mut table, "marker", &[], &["vendor"])),
            (102..=110).collect::<Vec<_>>()
        );
    }

    #[test]
    fn r5636a_sparse_and_cyclic_processes_terminate() {
        let mut table = parse(
            "4294967294 900 vendor vendor\n10 11 vendor vendor marker\n11 10 vendor vendor\n12 11 vendor vendor\n20 20 vendor vendor marker\n21 20 vendor vendor\n30 999 vendor vendor",
        );
        assert_eq!(
            pids(strays(&mut table, "marker", &[900, 11], &["vendor"])),
            [12, 21, 4294967294]
        );
    }

    #[test]
    fn r5636d_pid_reuse_uses_only_the_new_snapshot() {
        let mut first =
            parse("100 1 shell shell marker\n101 100 vendor vendor old\n102 101 vendor vendor");
        assert_eq!(
            pids(strays(&mut first, "marker", &[], &["vendor"])),
            [101, 102]
        );
        let mut second = parse(
            "100 1 shell shell marker\n101 9 vendor vendor new\n102 101 vendor vendor\n103 100 vendor vendor fresh",
        );
        let found = strays(&mut second, "marker", &[], &["vendor"]);
        assert_eq!(pids(found.clone()), [103]);
        assert_eq!(found[0].command, "vendor fresh");
    }
    #[test]
    fn r5636b_one_snapshot_indexes_once_for_one_or_ten_doors() {
        for doors in [1, 10] {
            let text = snapshot();
            BUILDS.set(0);
            let mut table = parse(&text);
            for door in 1..=doors {
                assert_eq!(
                    pids(strays(
                        &mut table,
                        &format!("marker-{door}-"),
                        &[],
                        &["vendor"]
                    )),
                    (door * 100 + 1..=door * 100 + 20).collect::<Vec<_>>()
                );
                assert_eq!(table.edges, 20);
            }
            assert_eq!(BUILDS.get(), 1);
        }
    }

    #[test]
    fn r5636b_each_reachable_edge_is_visited_once() {
        let mut table = parse(
            "4294967294 900 vendor vendor\n10 11 vendor vendor marker\n11 10 vendor vendor marker\n12 11 vendor vendor\n20 20 vendor vendor marker\n21 20 vendor vendor\n30 999 vendor vendor",
        );
        assert_eq!(
            pids(strays(&mut table, "marker", &[900, 900, 11], &["vendor"])),
            [12, 21, 4294967294]
        );
        assert_eq!(table.edges, 6);
    }
}
