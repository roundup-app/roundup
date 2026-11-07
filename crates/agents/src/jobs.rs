use super::*;
use contracts::agent::SpawnRole;

/// DCL9: a Job that has not reported in its current Attempt.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OpenJob {
    pub id: String,
    pub name: String,
    pub attempt: String,
}

/// DCL9: the one stop fact of a Job that went idle without reporting. `id` names the Job and its
/// Attempt, so a supervisor that offers it again on a later pass or after a reopen offers the same
/// fact.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct JobStop {
    pub id: String,
    pub agent: String,
    pub attempt: String,
}

impl Agents {
    /// DCL8: whether `id` is a Door (a Workstream), the one receiver whose Start carries the snapshot.
    pub fn is_door(&self, id: &str) -> bool {
        self.shared
            .rail()
            .node(id)
            .is_ok_and(|node| node.kind == contracts::agent::NodeKind::Workstream)
    }

    /// DCL9: every Job whose current Attempt has no report, as the Door's open-Job snapshot.
    /// `reported_attempts` gives the Attempt of each retained report of an Agent; a question
    /// is no report, and a report of an earlier Attempt does not close this one. Reads stored
    /// records only: it starts nothing.
    pub fn open_jobs(
        &self,
        reported_attempts: impl Fn(&str) -> Result<Vec<String>, RpcError>,
    ) -> Result<Vec<OpenJob>, RpcError> {
        let rail = self.shared.rail();
        let mut open = Vec::new();
        for node in rail.tree()? {
            if rail.role(&node.id)? != Some(SpawnRole::Job) {
                continue;
            }
            let attempt = node.attempt.as_deref().unwrap_or_default().to_owned();
            if !reported_attempts(&node.id)?.contains(&attempt) {
                open.push(OpenJob {
                    id: node.id,
                    name: node.name,
                    attempt,
                });
            }
        }
        Ok(open)
    }

    /// DCL9: what an idle `id` leaves the Door. A Job without a report of its current Attempt
    /// is a stop fact; a Consult's idle is rest, and so is an Agent that has no role.
    pub fn idle_stop(
        &self,
        id: &str,
        reported_attempts: impl Fn(&str) -> Result<Vec<String>, RpcError>,
    ) -> Result<Option<JobStop>, RpcError> {
        Ok(self
            .open_jobs(reported_attempts)?
            .into_iter()
            .find(|job| job.id == id)
            .map(|job| JobStop {
                id: format!("{}:{}:unreported", job.id, job.attempt),
                agent: job.id,
                attempt: job.attempt,
            }))
    }
}
