//! C7684: where the lines a Worktree changed repeat in the repo. Line hashing, no model: each
//! line becomes its token hash, so indentation and trailing spaces do not matter, and a run of
//! `MIN_LINES` lines with `MIN_TOKENS` tokens that another place holds again is one Spot. Reads
//! only, with no lock an Agent's own git call needs (`--no-optional-locks`, a private lock).

use std::collections::HashMap;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use contracts::agent::{ScanSpots, Spot, SpotPlace, SpotSource};
use rpc::RpcError;

use super::{Git, Worktree, WorktreeError, failed};

/// The fewest consecutive lines, after blank and punctuation-only lines are dropped, that count.
const MIN_LINES: usize = 8;
/// The fewest tokens those lines hold in all.
const MIN_TOKENS: usize = 40;
const MAX_FILES: usize = 5000;
const MAX_BYTES: u64 = 1 << 20;
const BUDGET: Duration = Duration::from_secs(5);

struct Line {
    no: u32,
    hash: u64,
    tokens: usize,
}

struct File {
    path: String,
    lines: Vec<Line>,
    /// Changed line ranges, 1-based inclusive; empty for an unchanged file.
    changed: Vec<(u32, u32)>,
}

impl Git {
    /// The Spots for `worktree`'s working tree against its merge base, scanned over the files git
    /// lists in it. A cancelled scan returns what it has, incomplete.
    pub fn repeat_scan(
        &self,
        worktree: &Worktree,
        cancel: &AtomicBool,
    ) -> Result<ScanSpots, RpcError> {
        if !worktree.path.is_dir() {
            return Err(WorktreeError::Missing(worktree.path.display().to_string()).into());
        }
        let git = self.reader();
        let dir = &worktree.path;
        let base = git
            .run(dir, &["merge-base", &worktree.base, "HEAD"])
            .map_err(failed)?;
        let patch = git
            .run(
                dir,
                &[
                    "--no-optional-locks",
                    "-c",
                    "core.quotepath=false",
                    "diff",
                    "--no-color",
                    "--no-ext-diff",
                    "--no-textconv",
                    "-U0",
                    &base,
                ],
            )
            .map_err(failed)?;
        let mut changed = changed_ranges(&patch);
        let list = |extra: &[&str]| {
            let args = [
                &[
                    "--no-optional-locks",
                    "ls-files",
                    "-z",
                    "--exclude-standard",
                ],
                extra,
            ];
            git.run(dir, &args.concat()).map_err(failed)
        };
        for path in list(&["--others"])?.split('\0').filter(|p| !p.is_empty()) {
            changed.insert(path.to_owned(), vec![(1, u32::MAX)]);
        }
        let all = list(&["--cached", "--others"])?;
        let mut paths: Vec<&str> = all
            .split('\0')
            .filter(|path| !path.is_empty() && scannable(path))
            .collect();
        paths.sort_unstable();
        paths.dedup();
        // Changed files first, so a stop at the bound still scans what the user changed.
        paths.sort_by_key(|path| !changed.contains_key(*path));

        let started = Instant::now();
        let mut complete = paths.len() <= MAX_FILES;
        let mut files = Vec::new();
        for path in paths.into_iter().take(MAX_FILES) {
            if cancel.load(Ordering::Relaxed) || started.elapsed() > BUDGET {
                complete = false;
                break;
            }
            let Some(lines) = git.read_lines(&dir.join(path)) else {
                continue;
            };
            files.push(File {
                path: path.to_owned(),
                lines,
                changed: changed.get(path).cloned().unwrap_or_default(),
            });
        }
        let mut spots = Vec::new();
        let windows = windows(&files);
        for file in files.iter().filter(|file| !file.changed.is_empty()) {
            if cancel.load(Ordering::Relaxed) {
                complete = false;
                break;
            }
            spots.extend(find(file, &files, &windows));
        }
        spots.sort_by(|a: &Spot, b| (&a.path, a.start).cmp(&(&b.path, b.start)));
        Ok(ScanSpots { spots, complete })
    }

    fn read_lines(&self, path: &Path) -> Option<Vec<Line>> {
        let len = std::fs::symlink_metadata(path).ok()?;
        if !len.is_file() || len.len() > MAX_BYTES {
            return None;
        }
        let bytes = std::fs::read(path).ok()?;
        self.scan_reads
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        if bytes.contains(&0) {
            return None;
        }
        let text = String::from_utf8_lossy(&bytes);
        if text
            .lines()
            .take(5)
            .any(|l| l.contains("@generated") || l.contains("DO NOT EDIT"))
        {
            return None;
        }
        Some(
            text.lines()
                .enumerate()
                .filter_map(|(at, line)| {
                    let (hash, tokens) = tokens(line)?;
                    Some(Line {
                        no: at as u32 + 1,
                        hash,
                        tokens,
                    })
                })
                .collect(),
        )
    }

    /// How many files the scans of this Git have read.
    pub fn scan_reads(&self) -> usize {
        self.scan_reads.load(Ordering::Relaxed)
    }
}

/// The path is one a scan may read: not under `.roundup/`, not generated or a lock file.
fn scannable(path: &str) -> bool {
    let name = path.rsplit('/').next().unwrap_or(path);
    !(path.starts_with(".roundup/")
        || path.split('/').any(|part| part == "generated")
        || name.contains(".min.")
        || name.ends_with(".lock")
        || name.ends_with("-lock.json")
        || name.ends_with("-lock.yaml"))
}

/// The token hash and count of `line`; `None` when it holds no letter or digit.
fn tokens(line: &str) -> Option<(u64, usize)> {
    let mut hasher = DefaultHasher::new();
    let (mut count, mut word, mut alnum) = (0, false, false);
    for ch in line.chars() {
        let part = ch.is_alphanumeric() || ch == '_';
        alnum |= part;
        if part {
            if !word {
                count += 1;
            }
            ch.hash(&mut hasher);
        } else if !ch.is_whitespace() {
            count += 1;
            ch.hash(&mut hasher);
        } else if word {
            ' '.hash(&mut hasher);
        }
        word = part;
    }
    alnum.then(|| (hasher.finish(), count))
}

/// The `+` ranges of each file in a `-U0` patch; a deleted file has none.
fn changed_ranges(patch: &str) -> HashMap<String, Vec<(u32, u32)>> {
    let mut out: HashMap<String, Vec<(u32, u32)>> = HashMap::new();
    let mut current: Option<String> = None;
    for line in patch.lines() {
        if let Some(path) = line.strip_prefix("+++ ") {
            current = path.strip_prefix("b/").map(str::to_owned);
        } else if let (Some(rest), Some(path)) = (line.strip_prefix("@@ "), &current) {
            let plus = rest.split(' ').find_map(|part| part.strip_prefix('+'));
            let mut nums = plus.unwrap_or("").split(',').map(|n| n.parse::<u32>().ok());
            let (Some(Some(start)), count) = (nums.next(), nums.next().flatten().unwrap_or(1))
            else {
                continue;
            };
            if count > 0 {
                out.entry(path.clone())
                    .or_default()
                    .push((start, start + count - 1));
            }
        }
    }
    out
}

/// Each run of `MIN_LINES` lines holding `MIN_TOKENS` tokens, by hash, to where it starts.
fn windows(files: &[File]) -> HashMap<u64, Vec<(usize, usize)>> {
    let mut map: HashMap<u64, Vec<(usize, usize)>> = HashMap::new();
    for (at, file) in files.iter().enumerate() {
        for (start, run) in file.lines.windows(MIN_LINES).enumerate() {
            if run.iter().map(|line| line.tokens).sum::<usize>() >= MIN_TOKENS {
                map.entry(window_hash(run)).or_default().push((at, start));
            }
        }
    }
    map
}

fn window_hash(run: &[Line]) -> u64 {
    let mut hasher = DefaultHasher::new();
    run.iter().for_each(|line| line.hash.hash(&mut hasher));
    hasher.finish()
}

/// The Spots for one changed file: its runs that touch a changed line and repeat elsewhere,
/// each with the first other place by path then line, extended to the run's whole length.
fn find(file: &File, files: &[File], windows: &HashMap<u64, Vec<(usize, usize)>>) -> Vec<Spot> {
    let touches = |lo: u32, hi: u32| file.changed.iter().any(|&(s, e)| s <= hi && e >= lo);
    let mut spots = Vec::new();
    let mut i = 0;
    while let Some(run) = file.lines.get(i..i + MIN_LINES) {
        let (Some(first), Some(last)) = (run.first(), run.last()) else {
            break;
        };
        let found = if touches(first.no, last.no) {
            windows.get(&window_hash(run)).and_then(|places| {
                places
                    .iter()
                    .filter_map(|&(at, j)| {
                        let other = files.get(at)?;
                        let (mine, theirs) = (file.lines.get(i..)?, other.lines.get(j..)?);
                        let mut limit = mine.len().min(theirs.len());
                        if std::ptr::eq(other, file) {
                            limit = limit.min(i.abs_diff(j));
                        }
                        let len = mine
                            .iter()
                            .zip(theirs)
                            .take(limit)
                            .take_while(|(a, b)| a.hash == b.hash)
                            .count();
                        if len < MIN_LINES {
                            return None;
                        }
                        let place = SpotPlace {
                            path: other.path.clone(),
                            start: theirs.first()?.no,
                            end: theirs.get(len - 1)?.no,
                        };
                        Some((place, mine.get(len - 1)?.no, len))
                    })
                    .min_by(|a, b| (&a.0.path, a.0.start).cmp(&(&b.0.path, b.0.start)))
            })
        } else {
            None
        };
        let Some((other, end, len)) = found else {
            i += 1;
            continue;
        };
        spots.push(Spot {
            source: SpotSource::Repeats,
            path: file.path.clone(),
            start: first.no,
            end,
            message: None,
            other: Some(other),
            stale: false,
        });
        i += len;
    }
    spots
}
