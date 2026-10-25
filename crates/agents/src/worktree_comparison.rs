//! Worktree comparison reads against the branch merge base, without changing files.

use std::io::Read;
use std::path::Path;

use contracts::agent::{ChangedFile, ChangedFiles, ChangedStatus};
use rpc::{RpcError, code};

use super::{Git, Worktree, failed, invalid};

impl Git {
    /// U2539a: the files the Worktree's working tree differs in from the merge base of its branch
    /// and its Base, outside `.roundup/`, sorted by path. Runs no command that writes.
    pub fn changed_files(&self, worktree: &Worktree) -> Result<ChangedFiles, RpcError> {
        if !worktree.path.is_dir() {
            return Err(RpcError::new(
                code::NOT_FOUND,
                format!("worktree_missing: {}", worktree.path.display()),
            ));
        }
        let dir = &worktree.path;
        let base = self.comparison_base(worktree)?;
        let diff = [
            "--no-optional-locks",
            "diff",
            "--no-color",
            "--no-ext-diff",
            "-M",
        ];
        let names = self
            .run(dir, &[&diff[..], &["-z", "--name-status", &base]].concat())
            .map_err(failed)?;
        let patch = self
            .run(dir, &[&diff[..], &["-U0", &base]].concat())
            .map_err(failed)?;
        let counts = self
            .run(dir, &[&diff[..], &["--numstat", &base]].concat())
            .map_err(failed)?;
        // Git quotes unusual paths without -z, so each count record occupies one line even for a rename.
        // Counts also classify a pure binary rename, whose patch has no binary marker or hunk.
        let mut binary = counts.lines().map(|row| row.starts_with("-\t-\t"));
        // All outputs use the same ordered diff queue, one record per name-status entry.
        let mut sections = patch.split("\ndiff --git ").map(first_changed_line);
        let mut fields = names.split('\0').filter(|field| !field.is_empty());
        let mut files = Vec::new();
        while let Some(mut file) = changed_name(&mut fields) {
            let line = sections.next().flatten();
            let is_binary = binary.next().unwrap_or(false);
            file.line = if file.status == ChangedStatus::Deleted || is_binary {
                None
            } else {
                line
            };
            files.push(file);
        }
        let untracked = self
            .run(
                dir,
                &[
                    "--no-optional-locks",
                    "ls-files",
                    "-z",
                    "--others",
                    "--exclude-standard",
                ],
            )
            .map_err(failed)?;
        for path in untracked.split('\0').filter(|path| !path.is_empty()) {
            files.push(ChangedFile {
                path: path.to_owned(),
                status: ChangedStatus::Untracked,
                line: untracked_line(&dir.join(path)),
                from: None,
            });
        }
        files.retain(|file| !file.path.starts_with(".roundup/"));
        files.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(ChangedFiles { files })
    }

    fn comparison_base(&self, worktree: &Worktree) -> Result<String, RpcError> {
        self.run(&worktree.path, &["merge-base", &worktree.base, "HEAD"])
            .map_err(failed)
    }

    /// U2540a: the same merge base as changed_files, paired with exact current bytes.
    pub fn compare_file(
        &self,
        worktree: &Worktree,
        path: &str,
    ) -> Result<contracts::agent::FileComparison, RpcError> {
        use contracts::agent::FileComparison;
        // Validate and open before Git: no untracked-content sniffing may follow an escaping link.
        let current = read_worktree_file(&worktree.path, path)?;
        let base = self.comparison_base(worktree)?;
        let names = self
            .run(
                &worktree.path,
                &[
                    "--no-optional-locks",
                    "diff",
                    "--no-ext-diff",
                    "--no-textconv",
                    "-M",
                    "--name-status",
                    "-z",
                    &base,
                ],
            )
            .map_err(failed)?;
        let mut fields = names.split('\0').filter(|s| !s.is_empty());
        let mut status = None;
        let mut old_path = path.to_owned();
        while let Some(file) = changed_name(&mut fields) {
            if file.path == path {
                status = Some(file.status);
                old_path = file.from.unwrap_or_else(|| path.to_owned());
            }
        }
        // Literal pathspec prevents a filename containing Git magic from selecting other blobs.
        validate_comparison_path(&old_path)?;
        let entry = self
            .run(
                &worktree.path,
                &[
                    "--literal-pathspecs",
                    "ls-tree",
                    "-z",
                    &base,
                    "--",
                    &old_path,
                ],
            )
            .map_err(failed)?;
        let old = if entry.is_empty() {
            None
        } else {
            let metadata = entry
                .split('\t')
                .next()
                .ok_or_else(|| failed("invalid tree entry"))?;
            let mut words = metadata.split_whitespace();
            let mode = words.next();
            let kind = words.next();
            let oid = words
                .next()
                .ok_or_else(|| failed("missing blob revision"))?;
            if kind != Some("blob") || mode == Some("120000") {
                return Err(invalid("unsafe_path", "not a regular Base file"));
            }
            let size: u64 = self
                .run(&worktree.path, &["cat-file", "-s", oid])
                .map_err(failed)?
                .parse()
                .map_err(failed)?;
            if size > CONTENT_LIMIT {
                return Err(failed("comparison content exceeds 4 MiB"));
            }
            let output = self
                .output(&worktree.path, &["cat-file", "blob", oid], None)
                .map_err(failed)?;
            if !output.status.success() {
                return Err(failed("cannot read Base blob"));
            }
            Some(output.stdout)
        };
        if status.is_none() && old.is_none() && current.is_some() {
            status = Some(ChangedStatus::Untracked);
        }
        if old.is_none() && current.is_none() {
            return Err(RpcError::new(code::NOT_FOUND, "file_missing"));
        }
        Ok(FileComparison {
            base,
            old_path,
            new_path: path.to_owned(),
            status,
            old: file_content(old),
            new: file_content(current),
        })
    }
}

/// The new-side first line of the first hunk of one `git diff -U0` section; `None` for a binary
/// file, 1 for a change with no hunk (a pure rename or mode change).
fn first_changed_line(section: &str) -> Option<u32> {
    if section
        .lines()
        .any(|line| line.starts_with("Binary files "))
    {
        return None;
    }
    let Some(hunk) = section.lines().find(|line| line.starts_with("@@ ")) else {
        return Some(1);
    };
    let new_side = hunk.split_whitespace().find(|part| part.starts_with('+'))?;
    let start = new_side.trim_start_matches('+').split(',').next()?;
    Some(start.parse::<u32>().ok()?.max(1))
}

/// 1 for a text file, `None` for a binary one (a NUL in its first 8000 bytes) or one that cannot be read.
fn untracked_line(path: &Path) -> Option<u32> {
    let mut head = Vec::new();
    std::fs::File::open(path)
        .ok()?
        .take(8000)
        .read_to_end(&mut head)
        .ok()?;
    (!head.contains(&0)).then_some(1)
}

const CONTENT_LIMIT: u64 = 4 * 1024 * 1024;

fn validate_comparison_path(path: &str) -> Result<(), RpcError> {
    if path.is_empty()
        || path.split('/').any(|part| {
            part.is_empty() || part == "." || part == ".." || part == ".git" || part == ".roundup"
        })
        || Path::new(path).is_absolute()
        || path.contains('\0')
    {
        return Err(invalid("unsafe_path", "expected a relative Worktree file"));
    }
    Ok(())
}

fn read_worktree_file(root: &Path, path: &str) -> Result<Option<Vec<u8>>, RpcError> {
    use rustix::fs::{Mode, OFlags, open, openat};
    validate_comparison_path(path)?;
    let flags = OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK;
    let mut directory = open(root, flags | OFlags::DIRECTORY, Mode::empty())
        .map_err(|err| RpcError::new(code::NOT_FOUND, format!("worktree_missing: {err}")))?;
    let mut parts = path.split('/').peekable();
    while let Some(part) = parts.next() {
        let last = parts.peek().is_none();
        let opened = openat(
            &directory,
            part,
            if last {
                flags
            } else {
                flags | OFlags::DIRECTORY
            },
            Mode::empty(),
        );
        let fd = match opened {
            Ok(fd) => fd,
            Err(rustix::io::Errno::NOENT) => return Ok(None),
            Err(err) => return Err(invalid("unsafe_path", err)),
        };
        if !last {
            directory = fd;
            continue;
        }
        let file = std::fs::File::from(fd);
        if !file.metadata().map_err(failed)?.is_file() {
            return Err(invalid("unsafe_path", "not a regular file"));
        }
        let mut bytes = Vec::new();
        file.take(CONTENT_LIMIT + 1)
            .read_to_end(&mut bytes)
            .map_err(failed)?;
        if u64::try_from(bytes.len()).map_err(failed)? > CONTENT_LIMIT {
            return Err(failed("comparison content exceeds 4 MiB"));
        }
        return Ok(Some(bytes));
    }
    Err(invalid("unsafe_path", "missing file"))
}

fn file_content(bytes: Option<Vec<u8>>) -> contracts::agent::FileContent {
    use contracts::agent::FileContent;
    use sha2::{Digest, Sha256};
    let Some(bytes) = bytes else {
        return FileContent::Absent {
            revision: "absent".into(),
        };
    };
    let revision = format!("sha256:{:x}", Sha256::digest(&bytes));
    if bytes.contains(&0) {
        return FileContent::Binary { revision };
    }
    match String::from_utf8(bytes) {
        Ok(text) => FileContent::Text { revision, text },
        Err(_) => FileContent::Binary { revision },
    }
}

/// Both readers consume Git's same NUL-delimited name-status records.
fn changed_name<'a>(fields: &mut impl Iterator<Item = &'a str>) -> Option<ChangedFile> {
    let letter = fields.next()?;
    let from = if letter.starts_with('R') || letter.starts_with('C') {
        Some(fields.next()?.to_owned())
    } else {
        None
    };
    let path = fields.next()?.to_owned();
    let status = match letter.as_bytes()[0] {
        b'A' => ChangedStatus::Added,
        b'D' => ChangedStatus::Deleted,
        b'R' | b'C' => ChangedStatus::Renamed,
        _ => ChangedStatus::Modified,
    };
    Some(ChangedFile {
        path,
        status,
        line: None,
        from,
    })
}
