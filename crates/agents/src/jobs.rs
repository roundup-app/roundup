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
        crate::rail::agent_id(id).is_ok_and(|id| {
            self.shared
                .rail()
                .node(id)
                .is_ok_and(|node| node.kind == contracts::agent::NodeKind::Workstream)
        })
    }

    /// DCR3: whether `job` is in the Reach of `door` (M7).
    pub fn in_reach(&self, door: &str, job: &str) -> bool {
        self.shared
            .reach(door)
            .is_ok_and(|reach| reach.contains(job))
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
            if rail.role(crate::rail::agent_id(&node.id)?)? != Some(SpawnRole::Job) {
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

    /// DCR1: on a quit, before any program ends, record each open Job that is mid-turn as cut
    /// off. A Job that reported, went idle without a report, or was stopped is finished.
    pub fn mark_cut_off(
        &self,
        reported_attempts: impl Fn(&str) -> Result<Vec<String>, RpcError>,
    ) -> Result<(), RpcError> {
        let cut: Vec<String> = self
            .open_jobs(reported_attempts)?
            .into_iter()
            .map(|job| job.id)
            .filter(|id| {
                matches!(
                    self.shared.runs().slot(id),
                    Some(Slot::Running(run)) if !run.ended()
                        && run.view().status.as_ref().is_some_and(|s| s.kind == Kind::Working)
                )
            })
            .collect();
        self.shared.rail().mark_cut_off(&cut)?;
        Ok(())
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
