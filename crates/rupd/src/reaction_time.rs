//! NR6 (`scenarios/named-reactions.md`): a reaction's one explicit instant. The saved `at` carries its own
//! UTC offset, so the instant is fixed when it is saved and a later zone or DST change cannot move it.
//! Tokio's deadline is monotonic and blind to wall-clock steps, so every wake reads the wall clock again
//! and `judge` decides; a deadline that woke early is re-armed.
use std::sync::Arc;
use std::time::Duration;

use contracts::reaction::{Condition, LatePolicy, PreviewParams, Reaction, State};
use rpc::RpcError;
use rusqlite::params;
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use crate::reaction::Reactions;

/// A wake within this long of the instant is on time; later is a missed instant.
const ON_TIME: Duration = Duration::from_secs(5);
/// The longest sleep, so a forward step of the wall clock is noticed within a minute.
const RECHECK: Duration = Duration::from_secs(60);

fn invalid(text: impl Into<String>) -> RpcError {
    RpcError::new(rpc::code::INVALID_PARAMS, text)
}

/// `at` parsed, only when it is the exact text a preview gives: RFC 3339 that formats back to itself.
pub(crate) fn canonical(at: &str) -> Result<OffsetDateTime, RpcError> {
    let parsed = OffsetDateTime::parse(at, &Rfc3339).map_err(|_| {
        invalid("at must be a date, time and UTC offset such as 2026-10-21T09:00:00+01:00")
    })?;
    if parsed.format(&Rfc3339).ok().as_deref() != Some(at) {
        return Err(invalid("at must be the text `reaction.preview` returns"));
    }
    Ok(parsed)
}

fn shaped(text: &str, pattern: &str) -> bool {
    text.len() == pattern.len()
        && text.bytes().zip(pattern.bytes()).all(|(c, p)| match p {
            b'9' => c.is_ascii_digit(),
            _ => c == p,
        })
}

/// NR6: the resolved instant for a typed date, time and offset. No zone name, no natural language and
/// no recurrence is understood; each refuses.
pub(crate) fn preview(p: &PreviewParams) -> Result<contracts::reaction::Preview, RpcError> {
    if !shaped(&p.date, "9999-99-99") {
        return Err(invalid("date must be YYYY-MM-DD"));
    }
    let time = match p.time.len() {
        5 if shaped(&p.time, "99:99") => format!("{}:00", p.time),
        8 if shaped(&p.time, "99:99:99") => p.time.clone(),
        _ => return Err(invalid("time must be HH:MM or HH:MM:SS")),
    };
    let signed = p
        .offset
        .strip_prefix(['+', '-'])
        .is_some_and(|rest| shaped(rest, "99:99"));
    if p.offset != "Z" && !signed {
        return Err(invalid(
            "an explicit UTC offset (Z, +HH:MM or -HH:MM) is required: a local time without one can be ambiguous or not exist",
        ));
    }
    let at = format!("{}T{}{}", p.date, time, p.offset);
    let resolved =
        OffsetDateTime::parse(&at, &Rfc3339).map_err(|_| invalid("no such date and time"))?;
    let format = |value: OffsetDateTime| value.format(&Rfc3339).map_err(RpcError::internal);
    Ok(contracts::reaction::Preview {
        at: format(resolved)?,
        utc: format(resolved.to_offset(time::UtcOffset::UTC))?,
        offset: p.offset.clone(),
    })
}

/// What the wall clock says to do with an instant.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Verdict {
    /// Not yet: sleep this long, then read the clock again.
    Wait(Duration),
    /// Accept the firing; `late` when the instant was missed.
    Fire { late: bool },
    /// Missed with the `skip` policy: fire nothing.
    Skip,
    /// At or after expiry: fire nothing.
    Expired,
}

pub(crate) fn judge(
    at: OffsetDateTime,
    expires: OffsetDateTime,
    late: LatePolicy,
    now: OffsetDateTime,
) -> Verdict {
    if now >= expires {
        return Verdict::Expired;
    }
    if now < at {
        let left = (at - now).unsigned_abs();
        return Verdict::Wait(left.min(RECHECK));
    }
    if (now - at).unsigned_abs() <= ON_TIME {
        return Verdict::Fire { late: false };
    }
    match late {
        LatePolicy::OnceBeforeExpiry => Verdict::Fire { late: true },
        LatePolicy::Skip => Verdict::Skip,
    }
}

/// Fires, skips and expires the instant reactions of one Project, from its saved definitions.
pub(crate) struct Timer {
    reactions: Arc<Reactions>,
    agents: Arc<agents::Agents>,
    messages: Arc<messages::Messages>,
    clock: Arc<dyn Fn() -> OffsetDateTime + Send + Sync>,
}

impl Timer {
    pub(crate) fn new(
        reactions: Arc<Reactions>,
        agents: Arc<agents::Agents>,
        messages: Arc<messages::Messages>,
    ) -> Self {
        Self {
            reactions,
            agents,
            messages,
            clock: Arc::new(OffsetDateTime::now_utc),
        }
    }

    /// Runs until the Daemon ends. Opening starts no Agent: a firing is one Message under the normal rules.
    pub(crate) async fn run(self) {
        loop {
            let wait = self.settle().await.unwrap_or(RECHECK);
            tokio::select! {
                () = tokio::time::sleep_until(tokio::time::Instant::now() + wait) => {}
                () = self.reactions.changed.notified() => {}
            }
        }
    }

    /// Reads the wall clock for each pending instant and acts on its verdict. Returns how long until the
    /// next one needs a look, or `None` when nothing waits.
    pub(crate) async fn settle(&self) -> Option<Duration> {
        let mut next: Option<Duration> = None;
        for saved in self.reactions.pending() {
            let Condition::Instant { at, late } = &saved.condition else {
                continue;
            };
            let (Ok(at), Ok(expires)) = (
                OffsetDateTime::parse(at, &Rfc3339),
                OffsetDateTime::parse(&saved.expires_at, &Rfc3339),
            ) else {
                continue;
            };
            // Read again here: the time a verdict rests on is the time of acceptance.
            let now = (self.clock)();
            match judge(at, expires, *late, now) {
                Verdict::Wait(left) => next = Some(next.map_or(left, |n| n.min(left))),
                Verdict::Expired => self
                    .reactions
                    .mark(&saved.id, "expired: no firing at or after expires_at"),
                Verdict::Skip => self.reactions.mark(
                    &saved.id,
                    "skipped: the instant was missed and the late policy is skip",
                ),
                Verdict::Fire { late } => self.fire(&saved, at, now, late).await,
            }
        }
        next
    }

    async fn fire(&self, saved: &Reaction, at: OffsetDateTime, now: OffsetDateTime, late: bool) {
        let at_text = match &saved.condition {
            Condition::Instant { at, .. } => at.as_str(),
            _ => "",
        };
        let stamp = |value: OffsetDateTime| value.format(&Rfc3339).unwrap_or_default();
        let evidence = serde_json::json!({
            "source": "instant",
            "at": at_text,
            "utc": stamp(at.to_offset(time::UtcOffset::UTC)),
            "observed": stamp(now.to_offset(time::UtcOffset::UTC)),
            "late": late,
        });
        let refuse = |why: RpcError| {
            let db = self
                .reactions
                .db
                .lock()
                .expect("reaction database poisoned");
            let _ = db.execute(
                "UPDATE reactions SET record = json_set(record,
                   '$.observation.health', 'acceptance-failed',
                   '$.observation.cause', ?2,
                   '$.observation.recovery', ?3,
                   '$.observation.evidence', ?4) WHERE id = ?1",
                params![
                    saved.id,
                    why.message,
                    "remove the acceptance failure; the timer retries on its next wake or Project reopen, applying the saved late policy and expiry",
                    evidence.to_string(),
                ],
            );
        };
        if let Err(why) = self.agents.guard_reach(&saved.actor, &saved.target, true) {
            return refuse(why);
        }
        let fired = self
            .messages
            .fire_reaction(messages::reaction::Fire {
                reaction: saved.id.clone(),
                operation: "instant".into(),
                to: saved.target.clone(),
                body: saved.instruction.clone(),
                evidence: evidence.to_string(),
                matched: true,
            })
            .await;
        match fired {
            Ok(_) => self
                .reactions
                .mark(&saved.id, if late { "fired late" } else { "fired" }),
            Err(why) => refuse(why),
        }
    }
}

impl Reactions {
    /// Active instant reactions whose watch has not ended.
    fn pending(&self) -> Vec<Reaction> {
        let db = self.db.lock().expect("reaction database poisoned");
        let Ok(mut stmt) = db.prepare(
            "SELECT record FROM reactions
             WHERE json_extract(record, '$.state') = 'active'
               AND json_extract(record, '$.condition.kind') = 'instant'
               AND (json_extract(record, '$.observation.health') IN ('not-observing', 'waiting', 'acceptance-failed')
                    OR json_extract(record, '$.observation.health') LIKE 'refused:%')
               AND NOT EXISTS (SELECT 1 FROM reaction_firings WHERE reaction = reactions.id)",
        ) else {
            return Vec::new();
        };
        stmt.query_map([], |r| r.get::<_, String>(0))
            .map(|rows| {
                rows.flatten()
                    .filter_map(|record| serde_json::from_str::<Reaction>(record.as_str()).ok())
                    .filter(|saved| saved.state == State::Active)
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Records why a watch ended, in the saved definition's observation.
    fn mark(&self, id: &str, health: &str) {
        let db = self.db.lock().expect("reaction database poisoned");
        let _ = db.execute(
            "UPDATE reactions SET record = json_set(record, '$.observation.health', ?2,
                '$.observation.cause', NULL, '$.observation.recovery', NULL) WHERE id = ?1",
            params![id, health],
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t(text: &str) -> OffsetDateTime {
        OffsetDateTime::parse(text, &Rfc3339).unwrap()
    }

    fn at(now: OffsetDateTime, late: LatePolicy) -> Verdict {
        judge(
            t("2026-10-21T09:00:00+01:00"),
            t("2026-10-21T12:00:00+01:00"),
            late,
            now,
        )
    }

    #[test]
    fn nr6_preview_refuses_a_non_ascii_offset() {
        for offset in ["é", "é0:00", "+é:00", "+0é:00", ""] {
            let refused = preview(&PreviewParams {
                date: "2026-10-21".into(),
                time: "09:00".into(),
                offset: offset.into(),
            });
            assert!(refused.is_err(), "{offset:?}");
        }
    }

    #[test]
    fn nr6_resolved_time_clock_changes_and_missed_policy() {
        let once = LatePolicy::OnceBeforeExpiry;
        // Early: never accepted, and a wall-clock step back re-arms with the longer wait.
        assert_eq!(
            at(t("2026-10-21T07:59:50Z"), once),
            Verdict::Wait(Duration::from_secs(10))
        );
        assert_eq!(at(t("2026-10-21T06:00:00Z"), once), Verdict::Wait(RECHECK));
        // The same instant under another offset is the same instant: a zone change moves nothing.
        assert_eq!(
            at(t("2026-10-21T03:00:00-05:00"), once),
            Verdict::Fire { late: false }
        );
        // A deadline that woke on time fires on time under either policy.
        assert_eq!(
            at(t("2026-10-21T08:00:01Z"), LatePolicy::Skip),
            Verdict::Fire { late: false }
        );
        // A missed instant (resume, or a forward step) follows its policy once, before expiry only.
        assert_eq!(
            at(t("2026-10-21T08:30:00Z"), once),
            Verdict::Fire { late: true }
        );
        assert_eq!(
            at(t("2026-10-21T08:30:00Z"), LatePolicy::Skip),
            Verdict::Skip
        );
        assert_eq!(at(t("2026-10-21T11:00:00Z"), once), Verdict::Expired);
        assert_eq!(at(t("2026-10-22T00:00:00Z"), once), Verdict::Expired);
    }
}
