//! A12a: an Agent's Terminal owner record survives the Daemon, and a reopened `Agents` attaches
//! it again instead of reporting the Agent `done`. Attaching launches nothing and sends no input.
use super::*;

use terminal::TerminalOwner as OwnerRecord;

/// One Agent's record: the Attempt it belongs to, and the owner verified at attachment.
#[derive(serde::Serialize, serde::Deserialize)]
struct Stored {
    attempt: Ordinal,
    #[serde(default)]
    input_started: bool,
    #[serde(default)]
    inbox: Option<PathBuf>,
    owner: OwnerRecord,
    /// The socket the retained program's hooks and MCP inherited as `RUPD_SOCKET`.
    #[serde(default)]
    socket: Option<PathBuf>,
    /// DCL3c: the background work open when the Daemon last looked.
    #[serde(default)]
    background: Option<claude_code::background::Retained>,
}

impl Agents {
    /// Save the owner behind client Terminal `terminal_id` for Agent `id`'s current Attempt.
    /// A Terminal the client owns directly has no record, and reopening reports its Agent `done`.
    pub(super) fn save_owner(&self, id: &str, terminal_id: &str) -> Result<(), RpcError> {
        let Some(owner) = self.shared.terminals.terminal_owner(terminal_id)? else {
            return Ok(());
        };
        let Some(attempt) = self.shared.rail().node(crate::rail::agent_id(id)?)?.attempt else {
            return Ok(());
        };
        let file = self.shared.owner_file(id);
        let body = serde_json::to_vec(&Stored {
            attempt,
            input_started: false,
            inbox: Some(self.launcher.socket_path(id).map_err(RpcError::internal)?),
            owner,
            socket: rpc::socket_path().ok(),
            background: None,
        })
        .map_err(RpcError::internal)?;
        let dir = file
            .parent()
            .ok_or_else(|| RpcError::internal("owners file has no directory"))?;
        std::fs::create_dir_all(dir).map_err(RpcError::internal)?;
        std::fs::write(file, body).map_err(RpcError::internal)
    }

    /// Attach every saved owner whose Agent, Attempt, incarnation and program still match, and
    /// return the Agents it kept. A record whose owner is gone, exited, replaced or stale is
    /// dropped and its Agent stays `done` (A8). Call once after `Agents::open`.
    pub async fn reattach_owners(&self) -> Vec<String> {
        let mut kept = Vec::new();
        let forked = self.forked;
        let Ok(entries) = std::fs::read_dir(self.dir.join("owners")) else {
            return kept;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Some(id) = path.file_stem().and_then(|s| s.to_str()).map(str::to_owned) else {
                continue;
            };
            // FOP5978b: a Fork joins no Terminal of the live App and drops the records.
            if forked {
                let _ = std::fs::remove_file(&path);
                continue;
            }
            let stored = std::fs::read(&path)
                .ok()
                .and_then(|body| serde_json::from_slice::<Stored>(&body).ok());
            let attached = match stored {
                Some(stored) => self.reattach(&id, stored).await,
                None => false,
            };
            if attached {
                kept.push(id);
            } else {
                let _ = std::fs::remove_file(&path);
            }
        }
        kept
    }

    /// The sockets the kept owners' programs inherited as `RUPD_SOCKET` (S1, S3): the reopened
    /// Daemon also answers there, so their hooks and MCP reach the reopened Project unchanged.
    pub fn retained_sockets(&self) -> Vec<PathBuf> {
        if self.forked {
            return Vec::new();
        }
        let Ok(entries) = std::fs::read_dir(self.dir.join("owners")) else {
            return Vec::new();
        };
        let mut sockets: Vec<PathBuf> = entries
            .flatten()
            .filter_map(|entry| std::fs::read(entry.path()).ok())
            .filter_map(|body| serde_json::from_slice::<Stored>(&body).ok())
            .filter_map(|stored| stored.socket)
            .collect();
        sockets.sort();
        sockets.dedup();
        sockets
    }

    async fn reattach(&self, id: &str, stored: Stored) -> bool {
        let (node, conversation) = {
            let rail = self.shared.rail();
            match (
                crate::rail::agent_id(id).and_then(|id| rail.node(id)),
                crate::rail::agent_id(id).and_then(|id| rail.conversation(id)),
            ) {
                (Ok(node), Ok(conversation)) => (node, conversation),
                _ => return false,
            }
        };
        if node.kind != NodeKind::Agent || node.attempt.as_deref() != Some(stored.attempt.as_str())
        {
            return false;
        }
        let Ok(spawned) = self.shared.terminals.reattach_owner(&stored.owner).await else {
            return false;
        };
        let cwd = conversation.map_or_else(
            || self.project_dir().to_string_lossy().into_owned(),
            |(_, cwd)| cwd,
        );
        let clock = Arc::clone(&self.shared.clock);
        let mut fold = Fold::new(claude_code::starting(move || clock()));
        fold.observe(Observation::Finished(
            crate::rail_view::finished_of(&self.shared.rail(), id).unwrap_or_default(),
        ));
        if let Some(kept) = stored.background {
            fold.observe(Observation::Resumed(kept));
        }
        let run = Run::reattached(
            fold,
            stored.attempt.clone(),
            spawned.id.clone(),
            cwd,
            stored.input_started,
        );
        let placed = {
            let mut rail = self.shared.rail();
            let mut runs = self.shared.runs();
            if runs.agent(id).is_some() {
                false
            } else if crate::rail::agent_id(id)
                .and_then(|id| rail.attach_terminal(id, &spawned.id))
                .is_ok()
            {
                runs.put(id, Slot::Running(run));
                true
            } else {
                false
            }
        };
        if !placed {
            return false;
        }
        if let Some(inbox) = &stored.inbox {
            self.launcher.reattach_inbox(id, inbox);
        }
        self.shared.watch_channel(id, &stored.attempt);
        tokio::spawn(watch(
            Arc::clone(&self.shared),
            id.to_owned(),
            stored.attempt,
            spawned.events,
        ));
        true
    }
}

impl Shared {
    fn owner_file(&self, id: &str) -> PathBuf {
        self.rail_view
            .data_dir
            .join("owners")
            .join(format!("{id}.json"))
    }

    /// Keep admission beside the verified owner, fenced to its original Attempt.
    pub(super) fn save_input_started(&self, id: &str, attempt: &str) -> Result<(), RpcError> {
        self.update_owner(id, attempt, |stored| {
            !std::mem::replace(&mut stored.input_started, true)
        })
    }

    /// U6260b: whether the conversation `id` resumes already received the user's input, per its
    /// owner record, whichever Attempt wrote it. No record, or an unreadable one, says no.
    pub(super) fn owner_input_started(&self, id: &str) -> bool {
        std::fs::read(self.owner_file(id))
            .ok()
            .and_then(|body| serde_json::from_slice::<Stored>(&body).ok())
            .is_some_and(|stored| stored.input_started)
    }

    /// DCL3c: keep the open background work beside the verified owner, fenced to its Attempt.
    pub(super) fn save_background(
        &self,
        id: &str,
        attempt: &str,
        background: Option<claude_code::background::Retained>,
    ) -> Result<(), RpcError> {
        self.update_owner(id, attempt, |stored| {
            stored.background != background && {
                stored.background = background;
                true
            }
        })
    }

    /// Rewrite the owner record of `id` when `change` reports a change; no record, or one of
    /// another Attempt, stays as it is.
    fn update_owner(
        &self,
        id: &str,
        attempt: &str,
        change: impl FnOnce(&mut Stored) -> bool,
    ) -> Result<(), RpcError> {
        let path = self.owner_file(id);
        let body = match std::fs::read(&path) {
            Ok(body) => body,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(RpcError::internal(error)),
        };
        let mut stored: Stored = serde_json::from_slice(&body).map_err(RpcError::internal)?;
        if stored.attempt != attempt || !change(&mut stored) {
            return Ok(());
        }
        let mut file = tempfile::NamedTempFile::new_in(
            path.parent()
                .ok_or_else(|| RpcError::internal("owners file has no directory"))?,
        )
        .map_err(RpcError::internal)?;
        serde_json::to_writer(&mut file, &stored).map_err(RpcError::internal)?;
        file.persist(&path).map_err(RpcError::internal)?;
        Ok(())
    }
}
