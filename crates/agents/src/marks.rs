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
                .map_err(|err| {
                    RpcError::internal(format!(
                        "cannot record Mark for Agent {}: {}",
                        source.agent, err.message
                    ))
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
        let relative = Path::new(std::ffi::OsStr::from_bytes(path));
        let mut parent = relative.parent();
        let mut present = true;
        while let Some(directory) = parent.filter(|p| !p.as_os_str().is_empty()) {
            match std::fs::symlink_metadata(root.join(directory)) {
                Ok(meta) if meta.is_dir() => {}
                Ok(_) => {
                    present = false;
                    break;
                }
                Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                    present = false;
                    break;
                }
                Err(err) => return Err(RpcError::internal(err)),
            }
            parent = directory.parent();
        }
        // A replaced parent directory makes its tracked children absent; its symlink is a file
        // in its own right. Never read the symlink's target outside the Worktree.
        if !present {
            continue;
        }
        let full = root.join(relative);
        let meta = match std::fs::symlink_metadata(&full) {
            Ok(meta) => meta,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => continue, // A deleted tracked file is absent at the Mark.
            Err(err) => return Err(RpcError::internal(err)),
        };
        let content = if meta.file_type().is_symlink() {
            FileContent::Symlink {
                target: std::fs::read_link(full)
                    .map_err(RpcError::internal)?
                    .as_os_str()
                    .as_bytes()
                    .to_vec(),
            }
        } else if meta.is_file() {
            FileContent::Regular {
                bytes: std::fs::read(full).map_err(RpcError::internal)?,
                executable: meta.permissions().mode() & 0o111 != 0,
            }
        } else {
            return Err(RpcError::internal(format!(
                "cannot record working file {}",
                full.display()
            )));
        };
        files.push(File {
            path: path.to_vec(),
            content,
        });
    }
    Ok(files)
}
