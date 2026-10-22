//! U3078d-h: explicit Resume of unfinished work. Reconciliation reads the retained evidence and
//! changes nothing; resuming accepts one decision and one successor Message through the Message
//! holder's one write. No Model call, program start or restart happens here.
use contracts::ActorKind;
use contracts::deliverable::Resolution;
use contracts::message::*;
use messages::continuation::{self, Continue};
use rpc::RpcError;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use crate::{Conn, Daemon};

const CHECK_RECEIPT: &str = "Read the authoritative receipt for this exact target and version (the user can authorize a source with `rup message resolve-result`); never issue the effect again to find out";

fn action_id(agent: &str, report: &ResultReport) -> String {
    let identity = json!([
        agent,
        report.order_revision,
        report.instruction.revision,
        report.request.target.id,
        report.request.target.revision,
        report.request.output.id,
        report.request.next,
    ]);
    Sha256::digest(identity.to_string().as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn block(
    report: &ResultReport,
    cause: impl Into<String>,
    action: impl Into<String>,
) -> ContinuationBlock {
    ContinuationBlock {
        report: report.report.clone(),
        target: report.request.target.clone(),
        cause: cause.into(),
        action: action.into(),
    }
}

impl Daemon {
    async fn progress_of(&self, conn: &Conn, id: &str) -> Result<Progress, RpcError> {
        let value = self
            .evidence_call(
                conn,
                "message.progress",
                json!({"project":self.project,"id":id}),
                0,
            )
            .await?;
        serde_json::from_value(value).map_err(RpcError::internal)
    }

    pub(crate) async fn reconcile(
        &self,
        conn: &Conn,
        p: &ProgressParams,
    ) -> Result<Reconciliation, RpcError> {
        let messages = self
            .sender
            .get()
            .ok_or_else(|| RpcError::internal("Message holder is unavailable"))?;
        let progress = self.progress_of(conn, &p.id).await?;
        let mut out = Reconciliation {
            agent: p.id.clone(),
            actions: Vec::new(),
            blocked: Vec::new(),
            context: Vec::new(),
            pending_checks: Vec::new(),
        };
        for (index, result) in progress.results.iter().enumerate() {
            let report = &result.report;
            let target = report.request.target.clone();
            let resolved = result.observations.iter().rev().find_map(|o| match o {
                ResultObservation::Resolved {
                    source, evidence, ..
                } => Some((source, evidence)),
                _ => None,
            });
            let passed = result
                .observations
                .iter()
                .any(|o| matches!(o, ResultObservation::Passed { .. }));
            let unavailable = matches!(result.availability, Resolution::Unavailable { .. });
            let superseded = progress.results[index + 1..]
                .iter()
                .any(|later| later.report.request.target.id == target.id);
            let confirmed = if let Some((_, evidence)) = resolved {
                Some(format!("authoritative receipt {}", evidence.revision))
            } else if let Some(accepted) = result.acceptances.first() {
                Some(format!("accepted by the user: {}", accepted.evidence))
            } else if passed {
                Some("its declared check passed".to_string())
            } else {
                None
            };
            if let Some(confirmed) = confirmed
                && !unavailable
                && !(report.request.state == ResultState::UnknownEffect
                    && !matches!(resolved, Some((_, e)) if matches!(e.outcome, ResultOutcome::Completed)))
            {
                out.context.push(ContinuationContext {
                    report: report.report.clone(),
                    target: target.clone(),
                    current: result.current,
                    confirmed,
                });
            }
            if report.request.state == ResultState::UnknownEffect {
                match resolved.map(|(source, e)| (source, &e.outcome)) {
                    None => out.blocked.push(block(
                        report,
                        "the effect was issued without an authoritative acknowledgement, so it may have happened",
                        CHECK_RECEIPT,
                    )),
                    Some((_, ResultOutcome::Completed)) => {}
                    Some((source, _)) if result.current => {
                        let mut action = self.continuation_action(messages, &p.id, report)?;
                        let seen = format!(
                            "authoritative receipt {source} shows it was not performed; read it again before you issue it"
                        );
                        action.next = if report.request.next.trim().is_empty() {
                            seen
                        } else {
                            format!("{seen}: {}", report.request.next)
                        };
                        out.actions.push(action);
                    }
                    Some(_) => {}
                }
                continue;
            }
            if unavailable {
                out.blocked.push(block(
                    report,
                    "the published output is unavailable and is never replaced by current bytes",
                    "Inspect the exact published result; republish it or accept that it is gone",
                ));
            }
            if !result.current {
                if !superseded && !report.request.next.trim().is_empty() {
                    out.blocked.push(block(
                        report,
                        "the instruction or target changed since this report, so it is history, not progress on the current work",
                        "Ask the Agent to report against the current instruction",
                    ));
                }
                continue;
            }
            if !passed {
                out.pending_checks.push(target);
            }
            if !report.request.next.trim().is_empty() {
                out.actions
                    .push(self.continuation_action(messages, &p.id, report)?);
            }
        }
        Ok(out)
    }

    fn continuation_action(
        &self,
        messages: &messages::Messages,
        agent: &str,
        report: &ResultReport,
    ) -> Result<ContinuationAction, RpcError> {
        let id = action_id(agent, report);
        let covered = messages.continuation_of(&id)?;
        Ok(ContinuationAction {
            report: report.report.clone(),
            target: report.request.target.clone(),
            output: report.request.output.id.clone(),
            instruction: report.instruction.revision.clone(),
            next: report.request.next.clone(),
            decision: covered.map(|c| c.decision.or(c.firing).unwrap_or_default()),
            id,
        })
    }

    pub(crate) async fn resume_call(
        &self,
        conn: &Conn,
        method: &str,
        args: Value,
    ) -> Result<Value, RpcError> {
        if method == "message.reconcileWork" {
            let p: ProgressParams = rpc::params(args)?;
            return rpc::reply(&self.reconcile(conn, &p).await?);
        }
        let p: ResumeWorkParams = rpc::params(args)?;
        if conn.actor.kind != ActorKind::User {
            return Err(RpcError::forbidden(
                "only the user may choose to resume unfinished work",
            ));
        }
        if p.request.trim().is_empty() || p.request.len() > 256 {
            return Err(RpcError::new(
                rpc::code::INVALID_PARAMS,
                "request is empty or too long",
            ));
        }
        let messages = self
            .sender
            .get()
            .ok_or_else(|| RpcError::internal("Message holder is unavailable"))?;
        let payload = json!({"id":p.id,"action":p.action}).to_string();
        let decided = |decision: continuation::Decision, reconciliation| ResumeWork {
            decision: Some(ContinuationDecision {
                id: decision.id,
                request: decision.request,
                actions: decision.actions,
                message: decision.message,
            }),
            reconciliation,
        };
        let progress = ProgressParams {
            project: p.project.clone(),
            id: p.id.clone(),
        };
        if self.project.to_string_lossy() != p.project {
            return Err(RpcError::forbidden("work belongs to another Project"));
        }
        if !self.rail().await?.iter().any(|n| n.id == p.id) {
            return Err(RpcError::not_found(
                "the Agent is gone; recovery never substitutes another Agent, even one with the same name",
            ));
        }
        let reconciliation = self.reconcile(conn, &progress).await?;
        if let Some((decision, _)) = messages.requested_decision(&p.id, &p.request, &payload)? {
            return rpc::reply(&decided(decision, reconciliation));
        }
        let mut chosen: Vec<&ContinuationAction> = reconciliation.actions.iter().collect();
        if let Some(action) = &p.action {
            chosen.retain(|a| &a.id == action);
            if chosen.is_empty() {
                return Err(RpcError::not_found("no such unfinished action"));
            }
        }
        if chosen.is_empty() {
            return rpc::reply(&ResumeWork {
                decision: None,
                reconciliation,
            });
        }
        let open: Vec<&ContinuationAction> = chosen
            .iter()
            .copied()
            .filter(|a| a.decision.is_none())
            .collect();
        let accepting = if open.is_empty() { &chosen } else { &open };
        let request = Continue {
            agent: p.id.clone(),
            request: p.request.clone(),
            payload,
            actions: accepting.iter().map(|a| a.id.clone()).collect(),
            body: successor_body(accepting, &reconciliation),
            evidence: serde_json::to_string(&reconciliation).map_err(RpcError::internal)?,
        };
        match messages.continue_work(request).await {
            Ok((decision, _)) => rpc::reply(&decided(decision, reconciliation)),
            Err(error) => Err(RpcError::new(
                error.code,
                format!(
                    "resume was not accepted: {}; nothing was claimed, retry with the same request id {}",
                    error.message, p.request
                ),
            )),
        }
    }
}

fn successor_body(actions: &[&ContinuationAction], r: &Reconciliation) -> String {
    let at = |t: &ResultTarget| format!("{}@{}", t.id, t.revision);
    let mut body = String::from("The user chose to resume this unfinished work.\n\nUnfinished:\n");
    for a in actions {
        body += &format!("- {} (output {}): {}\n", at(&a.target), a.output, a.next);
    }
    if !r.context.is_empty() {
        body += "\nConfirmed and finished; do not redo:\n";
        for c in &r.context {
            body += &format!(
                "- {}: {}{}\n",
                at(&c.target),
                c.confirmed,
                if c.current {
                    ""
                } else {
                    " (an older version; it verifies nothing about a newer one)"
                }
            );
        }
    }
    if !r.pending_checks.is_empty() {
        body += "\nChecks still pending; they stay pending until their own evidence arrives:\n";
        for t in &r.pending_checks {
            body += &format!("- {}\n", at(t));
        }
    }
    let unknown: Vec<&ContinuationBlock> = r
        .blocked
        .iter()
        .filter(|b| b.action == CHECK_RECEIPT)
        .collect();
    if !unknown.is_empty() {
        body +=
            "\nUncertain external effects; never issue these again, check their receipts first:\n";
        for b in unknown {
            body += &format!("- {}: {}\n", at(&b.target), b.cause);
        }
    }
    body
}

pub(crate) fn is_resume_method(method: &str) -> bool {
    matches!(method, "message.reconcileWork" | "message.resumeWork")
}
