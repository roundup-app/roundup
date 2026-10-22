//! A35: the Rail supplies membership; the Adapter owns conversations and Git owns file selection.

use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::time::Duration;

use checkpoints::{File, FileContent, Mark, Marks, RecordMarks};
use contracts::agent::NodeKind;
use rpc::{RpcError, code};

use crate::Agents;

#[async_trait::async_trait]
impl RecordMarks for Agents {
    fn iteration(&self, workstream: &str) -> Result<u32, RpcError> {
        let node = self.shared.rail().node(workstream)?;
        if node.kind != NodeKind::Workstream {
            return Err(RpcError::new(code::INVALID_PARAMS, "not a Workstream"));
        }
        Ok(node.iteration.unwrap_or(1))
    }

    async fn record(&self, workstream: &str) -> Result<Option<Marks>, RpcError> {
        let (iteration, members) = self.mark_sources(workstream)?;
        let mut agents = Vec::new();
        let mut complete = true;
        for source in &members {
            let Some((id, cwd)) = &source.conversation else {
                complete = false;
                continue;
            };
            let conversation = self
                .launcher
                .record_conversation(Path::new(cwd), id)
                .map_err(|err| match self.rail_name(&source.agent) {
                    Ok(name) => RpcError::internal(format!(
                        "cannot record Mark for Agent {name}: {}",
                        err.message
                    )),
                    Err(error) => error,
                })?;
            agents.push(Mark {
                agent: source.agent.clone(),
                cwd: cwd.clone(),
                worktree: source.worktree.clone(),
                conversation,
                files: Vec::new(),
            });
        }
        // M10 cards still work before any conversation exists. Verify all saved files above,
        // so an unsaved Agent never hides a different Agent's recording failure.
        if !complete {
            return Ok(None);
        }
        for mark in &mut agents {
            mark.files = files(Path::new(&mark.worktree)).await?;
        }
        if self.mark_sources(workstream)? != (iteration, members) {
            return Err(RpcError::new(
                code::CONFLICT,
                "Workstream changed while recording Marks",
            ));
        }
        Ok(Some(Marks { iteration, agents }))
    }
}

#[derive(PartialEq, Eq)]
struct MarkSource {
    agent: String,
    worktree: String,
    conversation: Option<(String, String)>,
}

impl Agents {
    fn mark_sources(&self, workstream: &str) -> Result<(u32, Vec<MarkSource>), RpcError> {
        let rail = self.shared.rail();
        let iteration = rail.node(workstream)?.iteration.unwrap_or(1);
        let nodes = rail.tree()?;
        let mut members = Vec::new();
        for node in &nodes {
            let mut at = Some(node.id.as_str());
            while let Some(id) = at {
                if id == workstream {
                    members.push(MarkSource {
                        agent: node.id.clone(),
                        worktree: node.worktree.as_ref().map_or_else(
                            || self.shared.project_dir.to_string_lossy().into_owned(),
                            |tree| tree.path.clone(),
                        ),
                        conversation: rail.conversation(&node.id)?,
                    });
                    break;
                }
                let ancestor = nodes.iter().find(|n| n.id == id);
                if ancestor.is_some_and(|n| n.kind == NodeKind::Workstream) {
                    break;
                }
                at = ancestor.and_then(|n| n.parent.as_deref());
            }
        }
        Ok((iteration, members))
    }
}

async fn files(root: &Path) -> Result<Vec<File>, RpcError> {
    let directory = working_directory(root)?;
    let mut command = tokio::process::Command::new("git");
    command
        .current_dir(root)
        .args([
            "ls-files",
            "-z",
            "--cached",
            "--others",
            "--exclude-standard",
        ])
        .kill_on_drop(true);
    let output = tokio::time::timeout(Duration::from_secs(30), command.output())
        .await
        .map_err(|_| RpcError::internal("git file selection timed out"))?
        .map_err(RpcError::internal)?;
    if !output.status.success() {
        return Err(RpcError::internal(String::from_utf8_lossy(&output.stderr)));
    }
    let mut paths: Vec<_> = output
        .stdout
        .split(|b| *b == 0)
        .filter(|p| !p.is_empty())
        .collect();
    paths.sort_unstable();
    paths.dedup();
    let mut files = Vec::new();
    for path in paths {
        if let Some(content) = read_file(&directory, path)? {
            files.push(File {
                path: path.to_vec(),
                content,
            });
        }
    }
    Ok(files)
}

use rustix::fs::{self, AtFlags, Mode, OFlags};
use std::collections::BTreeMap;
use std::ffi::OsStr;
use std::io::{Read, Write};
use std::os::fd::OwnedFd;

fn working_directory(root: &Path) -> Result<OwnedFd, RpcError> {
    fs::open(
        root,
        OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW,
        Mode::empty(),
    )
    .map_err(RpcError::internal)
}

fn components(path: &[u8]) -> Result<Vec<&OsStr>, RpcError> {
    let parts: Vec<_> = path.split(|b| *b == b'/').collect();
    if parts.iter().any(|p| {
        p.is_empty()
            || *p == b"."
            || *p == b".."
            || p.contains(&0)
            || p.eq_ignore_ascii_case(b".git")
    }) {
        return Err(RpcError::internal("unsafe Mark file path"));
    }
    Ok(parts.into_iter().map(OsStr::from_bytes).collect())
}

// Each directory is opened without following symlinks, and subsequent operations use its fd.
fn parent<'a>(
    root: &OwnedFd,
    path: &'a [u8],
    restore: bool,
) -> Result<Option<(OwnedFd, &'a OsStr)>, RpcError> {
    let parts = components(path)?;
    let mut dir = fs::openat(root, ".", OFlags::RDONLY | OFlags::DIRECTORY, Mode::empty())
        .map_err(RpcError::internal)?;
    for part in &parts[..parts.len() - 1] {
        let flags = OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW;
        match fs::openat(&dir, *part, flags, Mode::empty()) {
            Ok(next) => dir = next,
            Err(err)
                if [
                    rustix::io::Errno::NOENT,
                    rustix::io::Errno::NOTDIR,
                    rustix::io::Errno::LOOP,
                ]
                .contains(&err) =>
            {
                if !restore {
                    return Ok(None);
                }
                remove(&dir, part)?;
                fs::mkdirat(&dir, *part, Mode::from_raw_mode(0o755)).map_err(RpcError::internal)?;
                dir = fs::openat(&dir, *part, flags, Mode::empty()).map_err(RpcError::internal)?;
            }
            Err(err) => return Err(RpcError::internal(err)),
        }
    }
    Ok(Some((dir, parts[parts.len() - 1])))
}

fn read_file(root: &OwnedFd, path: &[u8]) -> Result<Option<FileContent>, RpcError> {
    let Some((dir, name)) = parent(root, path, false)? else {
        return Ok(None);
    };
    let meta = match fs::statat(&dir, name, AtFlags::SYMLINK_NOFOLLOW) {
        Ok(meta) => meta,
        Err(rustix::io::Errno::NOENT) => return Ok(None),
        Err(err) => return Err(RpcError::internal(err)),
    };
    match fs::FileType::from_raw_mode(meta.st_mode) {
        fs::FileType::Symlink => Ok(Some(FileContent::Symlink {
            target: fs::readlinkat(&dir, name, Vec::new())
                .map_err(RpcError::internal)?
                .as_bytes()
                .to_vec(),
        })),
        fs::FileType::RegularFile => {
            let fd = fs::openat(
                &dir,
                name,
                OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK,
                Mode::empty(),
            )
            .map_err(RpcError::internal)?;
            let mut file = std::fs::File::from(fd);
            let meta = file.metadata().map_err(RpcError::internal)?;
            if !meta.is_file() {
                return Err(RpcError::internal(
                    "working file changed type during comparison",
                ));
            }
            let mut bytes = Vec::new();
            file.read_to_end(&mut bytes).map_err(RpcError::internal)?;
            Ok(Some(FileContent::Regular {
                bytes,
                executable: meta.permissions().mode() & 0o111 != 0,
            }))
        }
        fs::FileType::Directory => Ok(None),
        _ => Err(RpcError::internal("unsupported working file type")),
    }
}

fn remove(dir: &OwnedFd, name: &OsStr) -> Result<(), RpcError> {
    match fs::unlinkat(dir, name, AtFlags::empty()) {
        Ok(()) | Err(rustix::io::Errno::NOENT) => Ok(()),
        Err(rustix::io::Errno::ISDIR) | Err(rustix::io::Errno::PERM) => {
            // Only empty directories may be removed; ignored files always block replacement.
            let child = fs::openat(
                dir,
                name,
                OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW,
                Mode::empty(),
            )
            .map_err(RpcError::internal)?;
            remove_empty_directories(&child)?;
            fs::unlinkat(dir, name, AtFlags::REMOVEDIR).map_err(RpcError::internal)
        }
        Err(err) => Err(RpcError::internal(err)),
    }
}

fn remove_empty_directories(dir: &OwnedFd) -> Result<(), RpcError> {
    let entries = fs::Dir::read_from(dir).map_err(RpcError::internal)?;
    for entry in entries {
        let entry = entry.map_err(RpcError::internal)?;
        let name = entry.file_name();
        if name.to_bytes() == b"." || name.to_bytes() == b".." {
            continue;
        }
        if name.to_bytes().eq_ignore_ascii_case(b".git") {
            return Err(RpcError::internal(
                "Git directory blocks working-file restoration",
            ));
        }
        let child = fs::openat(
            dir,
            name,
            OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW,
            Mode::empty(),
        )
        .map_err(RpcError::internal)?;
        remove_empty_directories(&child)?;
        fs::unlinkat(dir, name, AtFlags::REMOVEDIR).map_err(RpcError::internal)?;
    }
    Ok(())
}

/// Read-only comparison of working files with one Agent's Mark, returning sorted raw path bytes.
/// The coordinator owns authorization and must stop writers before comparison/restoration.
pub async fn changed_files(mark: &Mark) -> Result<Vec<Vec<u8>>, RpcError> {
    let current = files(Path::new(&mark.worktree)).await?;
    let recorded = recorded_files(mark)?;
    let current: BTreeMap<_, _> = current
        .iter()
        .map(|f| (f.path.as_slice(), &f.content))
        .collect();
    let mut paths: Vec<_> = recorded.keys().chain(current.keys()).copied().collect();
    paths.sort_unstable();
    paths.dedup();
    Ok(paths
        .into_iter()
        .filter(|p| recorded.get(p) != current.get(p))
        .map(<[u8]>::to_vec)
        .collect())
}

fn recorded_files(mark: &Mark) -> Result<BTreeMap<&[u8], &FileContent>, RpcError> {
    let mut recorded = BTreeMap::new();
    for file in &mark.files {
        components(&file.path)?;
        if recorded
            .insert(file.path.as_slice(), &file.content)
            .is_some()
        {
            return Err(RpcError::internal("duplicate Mark file path"));
        }
    }
    for path in recorded.keys() {
        for (i, b) in path.iter().enumerate() {
            if *b == b'/' && recorded.contains_key(&path[..i]) {
                return Err(RpcError::internal("Mark file is also a parent directory"));
            }
        }
    }
    Ok(recorded)
}

/// Restore one authorized Agent's working files. The #808 coordinator selects authorized Marks
/// and stops writers first; this operation grants no consent and changes no Git state.
/// Errors retain completed file operations; retrying the same Mark finishes restoration.
/// Nonempty directories (including ignored children) block replacement with an error.
pub async fn restore_files(mark: &Mark) -> Result<(), RpcError> {
    let recorded = recorded_files(mark)?;
    let current = files(Path::new(&mark.worktree)).await?;
    let root = working_directory(Path::new(&mark.worktree))?;
    for file in current
        .iter()
        .rev()
        .filter(|f| !recorded.contains_key(f.path.as_slice()))
    {
        if let Some((dir, name)) = parent(&root, &file.path, false)? {
            remove(&dir, name)?;
        }
    }
    for (path, content) in recorded {
        if read_file(&root, path)?.as_ref() == Some(content) {
            continue;
        }
        let (dir, name) = parent(&root, path, true)?
            .ok_or_else(|| RpcError::internal("missing working directory"))?;
        remove(&dir, name)?;
        match content {
            FileContent::Regular { bytes, executable } => {
                let mode = Mode::from_raw_mode(if *executable { 0o755 } else { 0o644 });
                let fd = fs::openat(
                    &dir,
                    name,
                    OFlags::WRONLY | OFlags::CREATE | OFlags::EXCL | OFlags::NOFOLLOW,
                    mode,
                )
                .map_err(RpcError::internal)?;
                // Replacing the inode also avoids modifying hardlinked files outside the Worktree.
                let mut file = std::fs::File::from(fd);
                file.write_all(bytes).map_err(RpcError::internal)?;
                fs::fchmod(&file, mode).map_err(RpcError::internal)?;
            }
            FileContent::Symlink { target } => {
                fs::symlinkat(OsStr::from_bytes(target), &dir, name).map_err(RpcError::internal)?
            }
        }
    }
    Ok(())
}

/// Progress for one authorized Mark's lifecycle Resume. Keep this value for retries in the
/// same Daemon; a completed value never launches another Attempt. The coordinator owns Mark
/// validity, per-Workstream serialization, Takeover consent and Proof before constructing it.
pub struct MarkResume {
    mark: Mark,
    prompt: Option<String>,
    progress: ResumeProgress,
}

enum ResumeProgress {
    Recorded,
    Copied(String),
    Resuming {
        copy: String,
        pending: tokio::task::JoinHandle<Result<contracts::agent::RailNode, RpcError>>,
    },
    Acknowledged(Box<contracts::agent::RailNode>),
}

impl MarkResume {
    pub fn new(mark: Mark, first_prompt: Option<String>) -> Self {
        Self {
            mark,
            prompt: first_prompt,
            progress: ResumeProgress::Recorded,
        }
    }

    async fn acknowledge(&mut self) -> Result<contracts::agent::RailNode, RpcError> {
        let ResumeProgress::Resuming { copy, pending } = &mut self.progress else {
            unreachable!("only a selected launch awaits its task")
        };
        let outcome = pending.await.expect("selected Resume task panicked");
        self.progress = ResumeProgress::Copied(copy.clone());
        let node = outcome?;
        self.progress = ResumeProgress::Acknowledged(Box::new(node.clone()));
        Ok(node)
    }
}

impl Agents {
    /// Stop as `agent.stop` does and Resume a shortened copy, completing only at the matching
    /// Attempt's SessionStart. Launch/ack errors leave it stopped and retain the copy for retry.
    /// An optional first prompt uses the existing first-Steer reservation before idle is
    /// published. This grants no rewind authorization and neither changes nor clears Takeover;
    /// #808 must validate consent/Proof and end an authorized Takeover before calling.
    pub async fn resume_mark(
        &self,
        ctx: &rpc::Ctx,
        resume: &mut MarkResume,
    ) -> Result<contracts::agent::RailNode, RpcError> {
        self.resume_mark_with(ctx, resume, crate::RailPublication::Immediate, false)
            .await
    }

    async fn resume_mark_with(
        &self,
        ctx: &rpc::Ctx,
        resume: &mut MarkResume,
        publication: crate::RailPublication,
        stopped: bool,
    ) -> Result<contracts::agent::RailNode, RpcError> {
        if let ResumeProgress::Acknowledged(node) = &resume.progress {
            return Ok((**node).clone());
        }
        if matches!(resume.progress, ResumeProgress::Resuming { .. }) {
            return resume.acknowledge().await;
        }
        let mark = &resume.mark;
        // A timeout or a caller dropped after promotion can lose its result. The copy and SessionStart
        // records that acknowledgement even when the caller did not receive its result.
        if let ResumeProgress::Copied(copy) = &resume.progress {
            let acknowledged = {
                let rail = self.shared.rail();
                let runs = self.shared.runs();
                rail.conversation(&mark.agent)?.as_ref() == Some(&(copy.clone(), mark.cwd.clone()))
                    && matches!(runs.get(&mark.agent), Some(crate::Slot::Running(run)) if run.session_started)
            };
            if acknowledged {
                let node = self.shared.node(&mark.agent)?;
                resume.progress = ResumeProgress::Acknowledged(Box::new(node.clone()));
                return Ok(node);
            }
        }
        {
            let rail = self.shared.rail();
            let node = rail.node(&mark.agent)?;
            let root = node.worktree.as_ref().map_or_else(
                || self.shared.project_dir.to_string_lossy().into_owned(),
                |tree| tree.path.clone(),
            );
            if root != mark.worktree
                || rail.conversation(&mark.agent)?.as_ref().map(|(_, cwd)| cwd) != Some(&mark.cwd)
            {
                return Err(RpcError::conflict(
                    "Mark does not belong to this Agent's working directory",
                ));
            }
        }
        if !stopped {
            self.shared
                .end_with(
                    ctx.actor.clone(),
                    &mark.agent,
                    crate::Ending::Stop,
                    publication,
                )
                .await?;
        }
        if matches!(resume.progress, ResumeProgress::Recorded) {
            let copy = self
                .launcher
                .copy_conversation(Path::new(&mark.cwd), &mark.conversation)?;
            resume.progress = ResumeProgress::Copied(copy);
        }
        let ResumeProgress::Copied(copy) = &resume.progress else {
            unreachable!("acknowledged Resume returned above")
        };
        if publication == crate::RailPublication::Coordinator {
            // The selected launch owns its timeout even if its caller is interrupted. Keeping
            // the task in progress lets retry await that same launch instead of launching twice.
            let agents = Agents {
                shared: std::sync::Arc::clone(&self.shared),
                dir: self.dir.clone(),
                launcher: self.launcher.clone(),
            };
            let ctx = rpc::Ctx {
                actor: ctx.actor.clone(),
                bus: ctx.bus.clone(),
                touches: std::sync::Arc::clone(&ctx.touches),
            };
            let (id, cwd, copy, prompt) = (
                mark.agent.clone(),
                mark.cwd.clone(),
                copy.clone(),
                resume.prompt.clone(),
            );
            let launch_copy = copy.clone();
            let pending = tokio::spawn(async move {
                agents
                    .resume_conversation(
                        &ctx,
                        &id,
                        crate::RESUME_ACK_BOUND,
                        Some((&launch_copy, &cwd)),
                        prompt,
                        publication,
                        None,
                        None,
                    )
                    .await
            });
            resume.progress = ResumeProgress::Resuming { copy, pending };
            return resume.acknowledge().await;
        }
        let node = self
            .resume_conversation(
                ctx,
                &mark.agent,
                crate::RESUME_ACK_BOUND,
                Some((copy, &mark.cwd)),
                resume.prompt.clone(),
                publication,
                None,
                None,
            )
            .await?;
        resume.progress = ResumeProgress::Acknowledged(Box::new(node.clone()));
        Ok(node)
    }
}

/// Selected Mark lifecycle work for an authorized coordinator. Keep this value across failures
/// and interrupted calls. `stop_marks` stops writers before the coordinator restores files;
/// `resume_marks` acknowledges every Resume and reserved first prompt. Neither publishes Rail
/// events. The coordinator owns Proof, Takeover consent, Mark validity, serialization and the
/// single completion announcement; constructing this value grants none of them.
pub struct Resume {
    retained: Vec<MarkResume>,
    later: Vec<String>,
    retirement_order: Option<Vec<String>>,
    stopped: std::collections::BTreeSet<String>,
    retired: std::collections::BTreeSet<String>,
    ending: Option<tokio::task::JoinHandle<Result<(), RpcError>>>,
}

impl Resume {
    pub fn new(retained: Vec<MarkResume>, later: Vec<String>) -> Self {
        Self {
            retained,
            later,
            retirement_order: None,
            stopped: Default::default(),
            retired: Default::default(),
            ending: None,
        }
    }
}

impl Agents {
    /// Stop selected retained Agents and retire selected later Agents deepest first, keeping
    /// Worktrees and branches. Status events still publish. Completed steps do not repeat on
    /// retry; unrelated and ordinary lifecycle calls retain their own Rail announcements.
    pub async fn stop_marks(&self, ctx: &rpc::Ctx, resume: &mut Resume) -> Result<(), RpcError> {
        if resume.retirement_order.is_none() {
            let tree = self.shared.tree()?;
            let mut selected = std::collections::BTreeSet::new();
            for id in resume
                .retained
                .iter()
                .map(|r| &r.mark.agent)
                .chain(&resume.later)
            {
                if !selected.insert(id) {
                    return Err(RpcError::new(
                        code::INVALID_PARAMS,
                        "duplicate selected Agent",
                    ));
                }
                let node =
                    tree.iter()
                        .find(|n| &n.id == id)
                        .ok_or_else(|| match self.rail_name(id) {
                            Ok(name) => RpcError::not_found(name),
                            Err(error) => error,
                        })?;
                if resume.later.contains(id) && node.kind != NodeKind::Agent {
                    return Err(RpcError::new(code::INVALID_PARAMS, "cannot retire a Door"));
                }
            }
            let depth = |id: &str| {
                let mut depth = 0;
                let mut at = tree
                    .iter()
                    .find(|n| n.id == id)
                    .and_then(|n| n.parent.as_deref());
                while let Some(id) = at {
                    depth += 1;
                    at = tree
                        .iter()
                        .find(|n| n.id == id)
                        .and_then(|n| n.parent.as_deref());
                }
                depth
            };
            let mut order = resume.later.clone();
            order.sort_by_key(|id| std::cmp::Reverse(depth(id)));
            resume.retirement_order = Some(order);
        }
        for retained in &resume.retained {
            let id = &retained.mark.agent;
            if resume.stopped.contains(id) {
                continue;
            }
            let pending = resume.ending.get_or_insert_with(|| {
                let shared = std::sync::Arc::clone(&self.shared);
                let (actor, id) = (ctx.actor.clone(), id.clone());
                tokio::spawn(async move {
                    shared
                        .end_with(
                            actor,
                            &id,
                            crate::Ending::Stop,
                            crate::RailPublication::Coordinator,
                        )
                        .await
                })
            });
            let outcome = pending.await.expect("selected stop task panicked");
            resume.ending = None;
            outcome?;
            resume.stopped.insert(id.clone());
        }
        for id in resume.retirement_order.as_ref().expect("selected above") {
            if resume.retired.contains(id) {
                continue;
            }
            let pending = resume.ending.get_or_insert_with(|| {
                let shared = std::sync::Arc::clone(&self.shared);
                let (actor, id) = (ctx.actor.clone(), id.clone());
                tokio::spawn(async move {
                    shared
                        .end_with(
                            actor,
                            &id,
                            crate::Ending::Retire,
                            crate::RailPublication::Coordinator,
                        )
                        .await
                })
            });
            let outcome = pending.await.expect("selected retirement task panicked");
            resume.ending = None;
            outcome?;
            resume.retired.insert(id.clone());
        }
        Ok(())
    }

    /// Resume selected Marks without Rail publication, returning only after matching
    /// SessionStart and reserved first-prompt acknowledgements. Call `stop_marks` first; the
    /// coordinator may restore files between these calls. Keep the same Resume for retries.
    pub async fn resume_marks(&self, ctx: &rpc::Ctx, resume: &mut Resume) -> Result<(), RpcError> {
        if resume.retirement_order.is_none()
            || resume.stopped.len() != resume.retained.len()
            || resume.retired.len() != resume.later.len()
        {
            return Err(RpcError::conflict("selected Agents have not stopped"));
        }
        for retained in &mut resume.retained {
            let node = self
                .resume_mark_with(ctx, retained, crate::RailPublication::Coordinator, true)
                .await?;
            if retained.prompt.is_some() {
                let acknowledged = async {
                    loop {
                        {
                            let runs = self.shared.runs();
                            match runs.get(&node.id) {
                                Some(crate::Slot::Running(run))
                                    if Some(&run.attempt) == node.attempt.as_ref() =>
                                {
                                    if matches!(
                                        run.first_prompt,
                                        Some(crate::FirstPrompt::Acknowledged)
                                    ) {
                                        return Ok(());
                                    }
                                    if run.ended
                                        || run
                                            .adapter
                                            .status()
                                            .is_some_and(|s| s.kind == contracts::Kind::Error)
                                    {
                                        return Err(RpcError::conflict(
                                            "reserved first prompt was not accepted",
                                        ));
                                    }
                                }
                                _ => {
                                    return Err(RpcError::conflict(
                                        "reserved first prompt lost its Attempt",
                                    ));
                                }
                            }
                        }
                        tokio::time::sleep(Duration::from_millis(20)).await;
                    }
                };
                tokio::time::timeout(
                    self.shared.steer_bound + self.shared.steer_bound,
                    acknowledged,
                )
                .await
                .map_err(|_| RpcError::conflict("reserved first prompt was not acknowledged"))??;
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{claude_code::Launcher, tests::Watched};

    #[tokio::test]
    async fn a2703a_errors_use_rail_names() {
        let watched = Watched::named();
        let dir = watched._dir.path();
        watched
            .shared
            .rail()
            .save_conversation(
                "7013",
                "12345678-1234-4234-8234-123456789abc",
                dir.to_str().unwrap(),
            )
            .unwrap();
        let agents = Agents {
            shared: watched.shared.clone(),
            dir: dir.to_owned(),
            launcher: Launcher::new("false", dir.join("config"), dir.join("rup"), None),
        };
        let error = agents.record("7013").await.unwrap_err();
        assert!(
            error.message.contains("sad") && !error.message.contains("7013"),
            "{error}"
        );
        let bus = rpc::Bus::new();
        let ctx = rpc::Ctx {
            actor: contracts::Actor::user(),
            bus,
            touches: std::sync::Arc::new(
                provenance::Touches::open(&dir.join("touches.db")).unwrap(),
            ),
        };
        let error = agents
            .stop_marks(&ctx, &mut Resume::new(vec![], vec!["8013".into()]))
            .await
            .unwrap_err();
        assert!(
            error.message.contains("an Agent that is gone") && !error.message.contains("8013"),
            "{error}"
        );
    }
}
