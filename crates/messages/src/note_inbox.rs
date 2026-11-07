//! The seam to an Agent's Claude inbox: what `message` asks of it and what `Agents` answers.

use agents::claude_code::inbox::Entry;
use contracts::agent::Inbox;

use super::*;

/// What the adapter exposes for an Agent's Claude inbox; the Daemon passes `Agents`.
#[async_trait]
pub trait NoteInbox: Send + Sync {
    /// B51: check the inbox of `agent` and show the outcome on the Rail.
    async fn check(&self, agent: &str) -> Inbox;
    /// A5556: automatic entries wait for first input; authenticated user entries may start it.
    fn admits(&self, _agent: &str, _from: &Actor) -> bool {
        true
    }
    /// Account for the authenticated sender only after physical delivery.
    fn submitted(&self, _agent: &str, _from: &Actor) {}
    /// B5763b: the receiving session, preserved when the Daemon reopens.
    fn session(&self, _agent: &str) -> Option<String> {
        None
    }
    /// B5763b: exact Adapter-rendered peer content, including labels and question identity.
    fn content(&self, _agent: &str, entry: &Entry) -> String {
        entry.content("", "")
    }
    /// B5763c: last admitted entry in the current peer transcript, for history recovery.
    fn previous(&self, _agent: &str) -> Result<Option<String>, Inbox> {
        Ok(None)
    }
    /// DCL8: the Jobs of `reported`-less Attempts, as `id (name), attempt` lines, for the open-Job
    /// snapshot a Door's batch carries. `reported` gives the Attempts an Agent has reported.
    fn open_jobs(
        &self,
        _agent: &str,
        _reported: &dyn Fn(&str) -> Result<Vec<String>, RpcError>,
    ) -> Vec<(String, String, String)> {
        Vec::new()
    }
    /// B50: write `notes` as entries; the answer names the failed state.
    fn write(&self, agent: &str, notes: &[Entry]) -> Result<(), Inbox>;
}

#[async_trait]
impl NoteInbox for agents::Agents {
    async fn check(&self, agent: &str) -> Inbox {
        self.inbox_check(agent)
    }

    fn admits(&self, agent: &str, from: &Actor) -> bool {
        from.kind == contracts::ActorKind::User || self.input_started(agent)
    }

    fn submitted(&self, agent: &str, from: &Actor) {
        if from.kind == contracts::ActorKind::User {
            self.admit_input(agent);
        }
    }

    fn session(&self, agent: &str) -> Option<String> {
        self.inbox_session(agent)
    }

    fn content(&self, agent: &str, entry: &Entry) -> String {
        self.inbox_content(agent, entry)
    }

    fn previous(&self, agent: &str) -> Result<Option<String>, Inbox> {
        self.inbox_previous(agent)
    }

    fn open_jobs(
        &self,
        agent: &str,
        reported: &dyn Fn(&str) -> Result<Vec<String>, RpcError>,
    ) -> Vec<(String, String, String)> {
        // DCL8: only a Door's batch carries the snapshot.
        if !self.is_door(agent) {
            return Vec::new();
        }
        agents::Agents::open_jobs(self, reported)
            .unwrap_or_default()
            .into_iter()
            .map(|job| (job.id, job.name, job.attempt))
            .collect()
    }

    fn write(&self, agent: &str, notes: &[Entry]) -> Result<(), Inbox> {
        self.inbox_write(agent, notes)
    }
}
