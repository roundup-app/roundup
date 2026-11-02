//! A12a: an Agent's Terminal owner record survives the Daemon, and a reopened `Agents` attaches
//! it again instead of reporting the Agent `done`. Attaching launches nothing and sends no input.
use super::*;

use terminal::TerminalOwner as OwnerRecord;

/// One Agent's record: the Attempt it belongs to, and the owner verified at attachment.
#[derive(serde::Serialize, serde::Deserialize)]
struct Stored {
    attempt: String,
    owner: OwnerRecord,
    /// The socket the retained program's hooks and MCP inherited as `RUPD_SOCKET`.
    #[serde(default)]
    socket: Option<PathBuf>,
}

impl Agents {
    fn owner_file(&self, id: &str) -> PathBuf {
        self.dir.join("owners").join(format!("{id}.json"))
    }

    /// Save the owner behind client Terminal `terminal_id` for Agent `id`'s current Attempt.
    /// A Terminal the client owns directly has no record, and reopening reports its Agent `done`.
    pub(super) fn save_owner(&self, id: &str, terminal_id: &str) -> Result<(), RpcError> {
        let Some(owner) = self.shared.terminals.terminal_owner(terminal_id) else {
            return Ok(());
        };
        let attempt = self.shared.rail().node(id)?.attempt.unwrap_or_default();
        let file = self.owner_file(id);
        let body = serde_json::to_vec(&Stored {
            attempt,
            owner,
            socket: rpc::socket_path().ok(),
        })
        .map_err(RpcError::internal)?;
        std::fs::create_dir_all(file.parent().expect("owners dir")).map_err(RpcError::internal)?;
        std::fs::write(file, body).map_err(RpcError::internal)
    }

    /// Attach every saved owner whose Agent, Attempt, incarnation and program still match, and
    /// return the Agents it kept. A record whose owner is gone, exited, replaced or stale is
    /// dropped and its Agent stays `done` (A8). Call once after `Agents::open`.
    pub async fn reattach_owners(&self) -> Vec<String> {
        let mut kept = Vec::new();
        let Ok(entries) = std::fs::read_dir(self.dir.join("owners")) else {
            return kept;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Some(id) = path.file_stem().and_then(|s| s.to_str()).map(str::to_owned) else {
                continue;
            };
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
            match (rail.node(id), rail.conversation(id)) {
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
        let run = Run {
            yolo: false,
            startup_context: false,
            input_started: true,
            attempt: stored.attempt.clone(),
            status_revision: 1,
            closing: false,
            ended: false,
            adapter: ClaudeCode::starting(move || clock()),
            prompt: None,
            first_pending: false,
            first_completion: None,
            first_prompt: Some(FirstPrompt::Acknowledged),
            session_started: None,
            starred: false,
            steer: None,
            interrupt: None,
            named: true,
            terminal_id: spawned.id.clone(),
            cwd,
        };
        let placed = {
            let mut rail = self.shared.rail();
            let mut runs = self.shared.runs();
            if runs.contains_key(id) {
                false
            } else if rail.attach_terminal(id, &spawned.id).is_ok() {
                runs.insert(id.to_owned(), Slot::Running(run));
                true
            } else {
                false
            }
        };
        if !placed {
            return false;
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
