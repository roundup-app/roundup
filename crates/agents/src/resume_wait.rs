//! U6248b: after Claude Code ends a turn on `overloaded`, `rate_limit` or `server_error`, roundup
//! resumes the Agent after 1, 4 and 16 minutes (jittered). The table here holds each waiting
//! Agent's step; the Daemon sends the Message when `take_due` names it.

use std::collections::HashMap;
use std::time::Duration;

use backon::{BackoffBuilder, ExponentialBuilder};
use contracts::{Kind, Status};

use super::*;

/// Resumes roundup sends before the failure shows as `error`.
const RESUMES: usize = 3;

/// The Message a resume sends, through the ordinary delivery path.
pub const RESUME_BODY: &str =
    "Your last turn was cut off by a Claude service error. Please continue where you left off.";

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Resume {
    /// The U5151b cause of the failure.
    pub(crate) cause: &'static str,
    /// Resume Messages sent so far.
    pub(crate) sent: usize,
    /// When the next resume is due; `None` once the third was sent, which is the exhausted state.
    pub(crate) at: Option<i64>,
    /// A resume was sent and its turn has not started yet.
    awaiting: bool,
    /// A turn started by a resume is running.
    running: bool,
}

/// How long after `now` resume number `sent` (from 0) waits: 1, 4, 16 min, full jitter, capped.
fn delay_ms(sent: usize, now: i64) -> i64 {
    ExponentialBuilder::default()
        .with_min_delay(Duration::from_secs(60))
        .with_factor(4.0)
        .with_max_delay(Duration::from_secs(16 * 60))
        .with_max_times(RESUMES)
        .with_jitter()
        .with_jitter_seed(now as u64)
        .build()
        .nth(sent)
        .map_or(0, |d| d.as_millis() as i64)
}

impl Resume {
    /// What the Rail row shows: `at` while a resume waits, `None` once exhausted.
    pub(crate) fn view(&self) -> contracts::agent::ResumeWait {
        contracts::agent::ResumeWait { at: self.at }
    }
}

/// Folds one raw (adapter) Status into `table` for `id`; whether the entry changed.
pub(crate) fn fold(
    table: &mut HashMap<String, Resume>,
    id: &str,
    status: &Status,
    now: i64,
) -> bool {
    match status.kind {
        Kind::Error => match claude_code::transient_cause(&status.label) {
            None => table.remove(id).is_some(),
            Some(cause) => match table.get_mut(id) {
                None => {
                    let at = Some(now + delay_ms(0, now));
                    table.insert(
                        id.to_owned(),
                        Resume {
                            cause,
                            sent: 0,
                            at,
                            awaiting: false,
                            running: false,
                        },
                    );
                    true
                }
                Some(entry) if entry.running || entry.awaiting => {
                    entry.running = false;
                    entry.awaiting = false;
                    true
                }
                Some(_) => false,
            },
        },
        Kind::Working => match table.get_mut(id) {
            Some(entry) if entry.awaiting => {
                entry.awaiting = false;
                entry.running = true;
                false
            }
            Some(entry) if entry.running => false,
            // A turn nobody here asked for started: the rest of the resumes are cancelled.
            Some(_) => table.remove(id).is_some(),
            None => false,
        },
        _ => table.remove(id).is_some(),
    }
}

/// Marks every resume due at `now` as sent and names its Agent. A resume never fires while its
/// turn runs.
pub(crate) fn take_due(table: &mut HashMap<String, Resume>, now: i64) -> Vec<String> {
    let mut due = Vec::new();
    for (id, entry) in table.iter_mut() {
        let Some(at) = entry.at else { continue };
        if at > now || entry.running || entry.awaiting {
            continue;
        }
        entry.sent += 1;
        entry.awaiting = true;
        entry.at = (entry.sent < RESUMES).then(|| now + delay_ms(entry.sent, now));
        due.push(id.clone());
    }
    due
}

impl Shared {
    pub(super) fn resume_of(&self, id: &str) -> Option<Resume> {
        self.resumes.lock().expect("resumes lock").get(id).cloned()
    }
}

impl Agents {
    /// U6248b: the Agents whose next resume is due; each is sent the resume Message by the caller.
    pub fn take_due_resumes(&self) -> Vec<String> {
        let due = take_due(
            &mut self.shared.resumes.lock().expect("resumes lock"),
            (self.shared.clock)(),
        );
        if !due.is_empty() {
            self.shared
                .bus
                .emit(Actor::daemon(), EventData::RailChanged);
        }
        due
    }

    /// U6248b: how long until the earliest waiting resume is due, on the Agents' clock.
    pub fn until_next_resume(&self) -> Option<Duration> {
        let table = self.shared.resumes.lock().expect("resumes lock");
        let at = table
            .values()
            .filter(|e| !e.running && !e.awaiting)
            .filter_map(|e| e.at)
            .min()?;
        Some(Duration::from_millis(
            (at - (self.shared.clock)()).max(0) as u64
        ))
    }

    /// U6248b, U6248c: the resume state of `id`, if it has one.
    pub fn resume_wait(&self, id: &str) -> Option<contracts::agent::ResumeWait> {
        self.shared.resume_of(id).map(|r| r.view())
    }
}

/// U6248b: an `error` Status whose resume waits reads `blocked` with its cause; an exhausted one
/// (its third resume failed) and every other Kind keep their own.
pub(super) fn resuming(status: &Status, resume: Option<&Resume>) -> Status {
    match (status.kind, resume) {
        (
            Kind::Error,
            Some(Resume {
                cause,
                at,
                awaiting,
                ..
            }),
        ) if at.is_some() || *awaiting => Status {
            kind: Kind::Blocked,
            label: (*cause).to_owned(),
            since: status.since,
            finished: status.finished.clone(),
        },
        _ => status.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MIN: i64 = 60_000;

    fn status(kind: Kind, label: &str) -> Status {
        Status {
            kind,
            label: label.into(),
            since: 0,
            finished: "0".into(),
        }
    }

    fn overloaded() -> Status {
        status(
            Kind::Error,
            "Claude is overloaded; wait, then send a message to retry.",
        )
    }

    #[test]
    fn u6248b_roundup_resumes_after_a_transient_stop_failure() {
        let mut table = HashMap::new();
        assert!(fold(&mut table, "a", &overloaded(), 0));
        let first = table["a"].at.expect("waiting");
        assert!((MIN..=2 * MIN).contains(&first), "1 min, jittered");
        assert!(take_due(&mut table, first - 1).is_empty());
        let shown = resuming(&overloaded(), table.get("a"));
        assert_eq!(
            (shown.kind, shown.label.as_str()),
            (Kind::Blocked, "Claude is overloaded")
        );

        // The first resume is sent once; the next waits 4 minutes.
        assert_eq!(take_due(&mut table, first), ["a"]);
        assert!(
            take_due(&mut table, first).is_empty(),
            "one Message per step"
        );
        let second = table["a"].at.expect("waiting");
        assert!((first + 4 * MIN..=first + 8 * MIN).contains(&second));

        // Its turn starts and fails again: the schedule goes on.
        assert!(!fold(
            &mut table,
            "a",
            &status(Kind::Working, "working"),
            first
        ));
        assert!(
            take_due(&mut table, second).is_empty(),
            "none while a turn runs"
        );
        assert!(fold(&mut table, "a", &overloaded(), first + 1));
        assert_eq!(take_due(&mut table, second), ["a"]);
        let third = table["a"].at.expect("waiting");
        assert!((second + 16 * MIN..=second + 32 * MIN).contains(&third));
        fold(&mut table, "a", &status(Kind::Working, "working"), second);
        fold(&mut table, "a", &overloaded(), second + 1);
        assert_eq!(take_due(&mut table, third), ["a"]);

        // After the third resume the row is exhausted: `error`, with Resume.
        assert_eq!(table["a"].at, None);
        assert!(take_due(&mut table, i64::MAX).is_empty(), "never a fourth");
        assert!(!fold(
            &mut table,
            "a",
            &status(Kind::Working, "working"),
            third
        ));
        assert!(fold(&mut table, "a", &overloaded(), third + 1));
        assert_eq!(resuming(&overloaded(), table.get("a")).kind, Kind::Error);
    }

    #[test]
    fn u6248b_a_turn_a_stop_or_a_user_cancels_the_rest() {
        for cancel in [Kind::Working, Kind::Idle, Kind::Done] {
            let mut table = HashMap::new();
            fold(&mut table, "a", &overloaded(), 0);
            assert!(fold(&mut table, "a", &status(cancel, "x"), 1));
            assert!(take_due(&mut table, i64::MAX).is_empty());
        }
    }

    #[test]
    fn u6248b_other_stop_failures_are_errors_at_once() {
        let mut table = HashMap::new();
        let failed = status(
            Kind::Error,
            "Claude could not sign in; open its Terminal, sign in, then retry.",
        );
        assert!(!fold(&mut table, "a", &failed, 0));
        assert!(table.is_empty());
        assert!(take_due(&mut table, i64::MAX).is_empty());
        assert_eq!(resuming(&failed, table.get("a")).kind, Kind::Error);
    }
}
