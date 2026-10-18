//! G2542e: the warm-launch observer. Real Node, Rust and Python dependency roots of at least
//! 10,000 ignored files in each of two enrolled directories; twenty sequential assignments to
//! one target commit, each timed from the start request to the launched process's first
//! successful smoke test. Installer shims and (on Linux) inotify watches on every dependency
//! root observe the process and filesystem boundaries. The report goes to `G2542E_REPORT_DIR`
//! (default: a temporary directory) and to stderr. See `docs/prepared-observer.md`.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

use agents::worktree::Git;
use serde_json::json;

use crate::common::Fixture;
use crate::prepared_support::*;

const FILES: usize = 10_000;
const ASSIGNMENTS: usize = 20;
const LIMIT_MS: u128 = 5000;

fn tool(command: &str) -> String {
    let output = Command::new("sh").args(["-c", command]).output().unwrap();
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .chain(String::from_utf8_lossy(&output.stderr).lines())
        .next()
        .unwrap_or("unavailable")
        .trim()
        .to_owned()
}

fn files_under(root: &Path) -> Vec<PathBuf> {
    let mut found = Vec::new();
    let mut pending = vec![root.to_owned()];
    while let Some(dir) = pending.pop() {
        for entry in std::fs::read_dir(&dir).unwrap() {
            let path = entry.unwrap().path();
            if std::fs::symlink_metadata(&path).unwrap().is_dir() {
                pending.push(path);
            } else {
                found.push(path);
            }
        }
    }
    found.sort();
    found
}

/// Nearest-rank percentile of `sorted`: the ceil(p * n)th value, counting from one.
fn nearest_rank(sorted: &[u128], percent: usize) -> u128 {
    sorted[(percent * sorted.len()).div_ceil(100) - 1]
}

#[cfg(target_os = "linux")]
mod watch {
    use std::mem::MaybeUninit;
    use std::os::fd::OwnedFd;
    use std::path::Path;

    use rustix::fs::inotify::{self, CreateFlags, WatchFlags};

    /// Kernel notifications of any create, write, rename, unlink or attribute change under the
    /// given roots (their directories and files).
    pub struct Watcher(OwnedFd);

    impl Watcher {
        pub fn new(roots: &[&Path]) -> Self {
            let fd = inotify::init(CreateFlags::CLOEXEC | CreateFlags::NONBLOCK).unwrap();
            let mask = WatchFlags::CREATE
                | WatchFlags::DELETE
                | WatchFlags::MODIFY
                | WatchFlags::CLOSE_WRITE
                | WatchFlags::ATTRIB
                | WatchFlags::MOVED_FROM
                | WatchFlags::MOVED_TO
                | WatchFlags::DELETE_SELF
                | WatchFlags::MOVE_SELF;
            for root in roots {
                let mut pending = vec![root.to_path_buf()];
                while let Some(path) = pending.pop() {
                    inotify::add_watch(&fd, &path, mask).unwrap();
                    if path.is_dir() {
                        for entry in std::fs::read_dir(&path).unwrap() {
                            let entry = entry.unwrap().path();
                            if std::fs::symlink_metadata(&entry).unwrap().is_dir() {
                                pending.push(entry);
                            }
                        }
                    }
                }
            }
            Self(fd)
        }

        /// The events since the last call.
        pub fn drain(&self) -> Vec<String> {
            let mut buffer = [MaybeUninit::<u8>::uninit(); 8192];
            let mut reader = inotify::Reader::new(&self.0, &mut buffer);
            let mut events = Vec::new();
            while let Ok(event) = reader.next() {
                events.push(format!("{:?} {:?}", event.events(), event.file_name()));
            }
            events
        }
    }
}

#[tokio::test]
async fn g2542e_warm_launch_observer() {
    let logs = tempfile::tempdir().unwrap();
    let installs = logs.path().join("installs");
    let marker = logs.path().join("smoke-ok");
    let shims = installer_shims(logs.path(), &installs);
    let path = format!("export PATH='{}':\"$PATH\"", shims.display());
    let smoke = smoke_all();
    let script = format!(
        "{path}; {smoke} && echo ok >> '{}'; exec sleep 60",
        marker.display()
    );
    let f = Fixture::in_git_project(&script, Git::from_env());
    commit_sources(f.dir.path());
    let dirs = [parked_dir(f.dir.path(), "a"), parked_dir(f.dir.path(), "b")];
    for dir in &dirs {
        prepare_all(dir, FILES);
    }
    let roots: Vec<PathBuf> = dirs
        .iter()
        .flat_map(|dir| IGNORED.iter().map(|name| dir.join(name)))
        .collect();
    let counts: Vec<_> = dirs
        .iter()
        .map(|dir| {
            let by_root: Vec<(String, usize)> = IGNORED
                .iter()
                .map(|name| (name.to_string(), files_under_or_file(&dir.join(name))))
                .collect();
            let total: usize = by_root.iter().map(|(_, n)| n).sum();
            assert!(
                total >= FILES,
                "{} holds {total} ignored files",
                dir.display()
            );
            json!({"dir": dir, "ignored_files": total, "by_root": by_root})
        })
        .collect();
    let before: Vec<_> = dirs.iter().map(|dir| ignored_snapshot(dir)).collect();
    let readiness = format!("{path}; {smoke}");
    enroll(&f, &[&dirs[0], &dirs[1]], &readiness, 30_000)
        .await
        .unwrap();
    #[cfg(target_os = "linux")]
    let watcher = {
        let paths: Vec<&Path> = roots.iter().map(PathBuf::as_path).collect();
        watch::Watcher::new(&paths)
    };

    // The watcher sees what it is there to see: a write, a create and an unlink in a watched root.
    #[cfg(target_os = "linux")]
    {
        let probe = tempfile::tempdir().unwrap();
        std::fs::write(probe.path().join("seen"), "a").unwrap();
        let probe_watcher = watch::Watcher::new(&[probe.path()]);
        std::fs::write(probe.path().join("seen"), "b").unwrap();
        std::fs::write(probe.path().join("created"), "c").unwrap();
        std::fs::remove_file(probe.path().join("seen")).unwrap();
        assert!(
            probe_watcher.drain().len() >= 3,
            "the watcher reports changes"
        );
    }

    let mut timings = Vec::new();
    let mut used = [0usize; 2];
    for round in 0..ASSIGNMENTS {
        // Outside the timing: alternate which prepared directory is first in line.
        let order = if round % 2 == 0 { [0, 1] } else { [1, 0] };
        enroll(&f, &[&dirs[order[0]], &dirs[order[1]]], &readiness, 30_000)
            .await
            .unwrap();
        #[cfg(target_os = "linux")]
        let _ = watcher.drain();

        let start = Instant::now();
        let node = f.spawn(None, None).await.unwrap();
        let took = loop {
            if std::fs::read_to_string(&marker).map_or(0, |t| t.lines().count()) > round {
                break start.elapsed();
            }
            assert!(start.elapsed() < Duration::from_secs(60), "no smoke result");
            tokio::time::sleep(Duration::from_millis(2)).await;
        };
        timings.push(took.as_millis());
        let assigned = PathBuf::from(&node.worktree.as_ref().unwrap().path);
        used[usize::from(assigned == dirs[1])] += 1;

        #[cfg(target_os = "linux")]
        assert_eq!(
            watcher.drain(),
            Vec::<String>::new(),
            "round {round}: dependency roots changed"
        );
        assert!(!installs.exists(), "round {round}: an installer ran");
        f.call("rail.remove", serde_json::json!({"id": node.id}))
            .await
            .unwrap();
    }

    let after: Vec<_> = dirs.iter().map(|dir| ignored_snapshot(dir)).collect();
    assert_eq!(
        after, before,
        "dependency roots are byte-for-byte and inode-for-inode as prepared"
    );
    let mut sorted = timings.clone();
    sorted.sort_unstable();
    let p95 = nearest_rank(&sorted, 95);
    let identities: Vec<String> = dirs
        .iter()
        .enumerate()
        .map(|(index, dir)| {
            let lines: Vec<String> = after[index]
                .iter()
                .map(|(p, id)| format!("{} {id}", p.strip_prefix(dir).unwrap().display()))
                .collect();
            lines.join("\n")
        })
        .collect();
    let report = json!({
        "os": tool("uname -srm"),
        "filesystem": tool(&format!("stat -f -c %T '{}' 2>/dev/null || mount | grep -m1 ' on / '", dirs[0].display())),
        "tools": {
            "node": tool("node --version"),
            "python": tool("python3 --version"),
            "rustc": tool("rustc --version"),
            "cargo": tool("cargo --version"),
            "git": tool("git --version"),
        },
        "fixture": counts,
        "files_per_directory_minimum": FILES,
        "assignments_per_directory": used,
        "timings_ms": timings,
        "p95_nearest_rank_ms": p95,
        "limit_ms": LIMIT_MS,
        "installer_calls": 0,
        "dependency_root_events": 0,
        "filesystem_observer": if cfg!(target_os = "linux") { "inotify on every dependency directory and file, before and after each timed assignment" } else { "snapshot of device, inode, size, mtime and ctime only; no kernel event observer on this OS" },
        "defender": "unverified: Linux success proves reuse, not Defender latency",
    });
    let out = std::env::var_os("G2542E_REPORT_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| logs.path().join("report"));
    std::fs::create_dir_all(&out).unwrap();
    std::fs::write(
        out.join("report.json"),
        serde_json::to_string_pretty(&report).unwrap(),
    )
    .unwrap();
    for (index, text) in identities.iter().enumerate() {
        std::fs::write(out.join(format!("identities-{index}.txt")), text).unwrap();
    }
    eprintln!("G2542E {}", serde_json::to_string(&report).unwrap());
    assert!(used[0] > 0 && used[1] > 0, "both directories were assigned");
    assert!(
        p95 <= LIMIT_MS,
        "p95 {p95} ms over {LIMIT_MS} ms: {timings:?}"
    );
}

fn files_under_or_file(path: &Path) -> usize {
    if path.is_dir() {
        files_under(path).len()
    } else {
        1
    }
}
