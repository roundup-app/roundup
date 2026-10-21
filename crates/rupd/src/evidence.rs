//! U3078: authenticated public reports and passive exact-version source observation.
use contracts::ActorKind;
use contracts::agent::{Instructions, RailNode};
use contracts::deliverable::{Deliverable, PublishedTarget, Resolution, UnavailableCause};
use contracts::message::*;
use rpc::{Module, RpcError};
use serde_json::{Value, json};

use crate::{Conn, Daemon};

fn unknown(cause: impl Into<String>) -> ResultObservation {
    ResultObservation::Unknown {
        cause: cause.into(),
        action:
            "Inspect the exact published result and authoritative source; for an uncertain effect, have the user select a read-only receipt source and retry resolution"
                .into(),
    }
}

impl Daemon {
    async fn result_instructions(
        &self,
        conn: &Conn,
        p: &ProgressParams,
    ) -> Result<Instructions, RpcError> {
        if p.project != self.project.to_string_lossy() {
            return Err(RpcError::forbidden("result belongs to another Project"));
        }
        let value = self
            .agents
            .call(
                &self.ctx(conn.actor.clone()),
                "agent.instructions",
                json!({"id":p.id}),
            )
            .await?;
        serde_json::from_value(value).map_err(RpcError::internal)
    }

    async fn result_availability(
        &self,
        conn: &Conn,
        report: &ResultReport,
    ) -> Result<Resolution, RpcError> {
        let read = self
            .deliverable_call(conn, "deliverable.resolve", json!(report.request.output))
            .await;
        match read {
            Ok(value) => serde_json::from_value(value).map_err(RpcError::internal),
            Err(error) if error.code == rpc::code::NOT_FOUND => Ok(Resolution::Unavailable {
                cause: UnavailableCause::MissingRevision,
            }),
            Err(error) if error.code == rpc::code::FORBIDDEN => Ok(Resolution::Unavailable {
                cause: UnavailableCause::AccessRevoked,
            }),
            Err(error) => Err(error),
        }
    }

    pub(crate) async fn evidence_call(
        &self,
        conn: &Conn,
        method: &str,
        args: Value,
        now: i64,
    ) -> Result<Value, RpcError> {
        let messages = self
            .sender
            .get()
            .ok_or_else(|| RpcError::internal("Message holder is unavailable"))?;
        let p = match method {
            "message.progress" => rpc::params::<ProgressParams>(args.clone())?,
            "message.report" => {
                let p: ReportParams = rpc::params(args.clone())?;
                ProgressParams {
                    project: p.project,
                    id: p.id,
                }
            }
            "message.acceptResult" => {
                let p: AcceptResultParams = rpc::params(args.clone())?;
                ProgressParams {
                    project: p.project,
                    id: p.id,
                }
            }
            "message.resolveResult" => {
                let p: ResolveResultParams = rpc::params(args.clone())?;
                if conn.actor.kind != ActorKind::User {
                    return Err(RpcError::forbidden(
                        "only the user may authorize an external resolution source",
                    ));
                }
                ProgressParams {
                    project: p.project,
                    id: p.id,
                }
            }
            "message.verifyResult" => {
                let p: ResultId = rpc::params(args.clone())?;
                ProgressParams {
                    project: p.project,
                    id: p.id,
                }
            }
            _ => return Err(RpcError::method_not_found(method)),
        };
        let instructions = self.result_instructions(conn, &p).await?;
        let reports = messages.result_reports(&p.id)?;
        let mut unresolved = Vec::new();
        for report in &reports {
            if report.request.state == ResultState::UnknownEffect
                && !messages
                    .result_observations(&report.report)?
                    .iter()
                    .any(|o| matches!(o, ResultObservation::Resolved { .. }))
            {
                unresolved.push(report);
            }
        }
        if method == "message.progress" {
            let present = self.rail().await?.iter().any(|n| n.id == p.id);
            let mut results = Vec::new();
            for (index, report) in reports.iter().enumerate() {
                let pending = unresolved.iter().any(|r| r.report == report.report);
                let blocked = unresolved
                    .iter()
                    .any(|r| r.request.target.id == report.request.target.id);
                let current = pending
                    || (!blocked
                        && present
                        && instructions.current == report.order_revision
                        && !reports[index + 1..]
                            .iter()
                            .any(|later| later.request.target.id == report.request.target.id));
                results.push(ResultProgress {
                    report: report.clone(),
                    current,
                    acceptances: messages.result_acceptances(&report.report)?,
                    observations: messages.result_observations(&report.report)?,
                    availability: self.result_availability(conn, report).await?,
                });
            }
            return rpc::reply(&Progress {
                instructions,
                results,
            });
        }
        if method == "message.report" {
            let p: ReportParams = rpc::params(args)?;
            // Identity flags are not authority: only the live vendor process tree can report.
            let peer = conn.peer.and_then(|pid| self.agents.agent_of_peer(pid));
            if conn.actor.kind != ActorKind::Agent
                || peer.as_deref() != Some(&p.id)
                || conn.actor.id != p.id
            {
                return Err(RpcError::forbidden(
                    "only the authenticated Agent may report its own Attempt",
                ));
            }
            for (name, value, bound) in [
                ("key", p.key.as_str(), 256),
                ("result", p.result.as_str(), 8192),
                ("target", p.target.id.as_str(), 1024),
                ("target revision", p.target.revision.as_str(), 1024),
            ] {
                if value.trim().is_empty() || value.len() > bound {
                    return Err(RpcError::new(
                        rpc::code::INVALID_PARAMS,
                        format!("{name} is empty or too long"),
                    ));
                }
            }
            if p.next.len() > 8192 {
                return Err(RpcError::new(
                    rpc::code::INVALID_PARAMS,
                    "next action is too long",
                ));
            }
            let delivery = instructions
                .deliveries
                .iter()
                .find(|d| d.id == p.delivery)
                .ok_or_else(|| RpcError::not_found("instruction delivery is absent"))?;
            let node: RailNode = self
                .rail()
                .await?
                .into_iter()
                .find(|n| n.id == p.id)
                .ok_or_else(|| RpcError::not_found("reporting Agent is gone"))?;
            if node.attempt.as_deref() != Some(&delivery.attempt)
                || delivery.state != contracts::agent::InstructionState::Submitted
            {
                return Err(RpcError::conflict(
                    "report does not name a submitted instruction in this Attempt",
                ));
            }
            if let Some(previous) = reports.iter().find(|r| r.request.key == p.key) {
                let mut replay = previous.clone();
                replay.request = p;
                replay.author = conn.actor.clone();
                replay.attempt = delivery.attempt.clone();
                return rpc::reply(&messages.record_result(replay)?);
            }
            let index = instructions
                .revisions
                .iter()
                .position(|r| r.revision == delivery.revision)
                .ok_or_else(|| RpcError::not_found("instruction revision is absent"))?;
            let instruction = instructions.revisions[index].clone();
            let order_revision = instructions.revisions[..=index]
                .iter()
                .rev()
                .find(|r| matches!(r.instruction, contracts::agent::Instruction::Order { .. }))
                .map(|r| r.revision.clone());
            let publication: Deliverable = serde_json::from_value(
                self.deliverable_call(conn, "deliverable.get", json!(p.output))
                    .await?,
            )
            .map_err(RpcError::internal)?;
            if publication.maker != conn.actor {
                return Err(RpcError::forbidden("output belongs to another maker"));
            }
            let report = messages.record_result(ResultReport {
                report: String::new(),
                author: conn.actor.clone(),
                attempt: delivery.attempt.clone(),
                home: instructions.home,
                order_revision,
                request: p,
                instruction,
                publication,
            })?;
            return rpc::reply(&report);
        }
        let report_id = args["report"].as_str().unwrap_or_default();
        let report = reports
            .iter()
            .find(|r| r.report == report_id)
            .ok_or_else(|| RpcError::not_found("result report is absent"))?;
        if method == "message.acceptResult" {
            let p: AcceptResultParams = rpc::params(args)?;
            if conn.actor.kind != ActorKind::User {
                return Err(RpcError::forbidden("only the user may accept a result"));
            }
            if p.evidence.trim().is_empty() || p.evidence.len() > 8192 {
                return Err(RpcError::new(
                    rpc::code::INVALID_PARAMS,
                    "acceptance evidence is empty or too long",
                ));
            }
            let acceptance = ResultAcceptance {
                actor: conn.actor.clone(),
                evidence: p.evidence,
            };
            messages.accept_result(&report.report, &acceptance)?;
            return rpc::reply(&acceptance);
        }
        if method == "message.resolveResult" {
            if report.request.state != ResultState::UnknownEffect {
                return Err(RpcError::conflict(
                    "external resolution requires an unknown-effect report",
                ));
            }
            let p: ResolveResultParams = rpc::params(args)?;
            let observation = read_resolution(&p.source, report, &conn.actor, now).await;
            messages.observe_result(&report.report, &observation)?;
            return rpc::reply(&observation);
        }
        if let Some(resolved) = messages
            .result_observations(&report.report)?
            .into_iter()
            .rev()
            .find(|o| matches!(o, ResultObservation::Resolved { .. }))
        {
            return rpc::reply(&resolved);
        }
        let availability = self.result_availability(conn, report).await?;
        let observation = self.observe_result(conn, report, &availability).await;
        let observation = if matches!(observation, ResultObservation::Passed { .. })
            && unresolved
                .iter()
                .any(|r| r.request.target.id == report.request.target.id)
        {
            unknown("an unresolved external effect requires authoritative exact-version resolution")
        } else {
            observation
        };
        messages.observe_result(&report.report, &observation)?;
        rpc::reply(&observation)
    }

    async fn observe_result(
        &self,
        conn: &Conn,
        report: &ResultReport,
        availability: &Resolution,
    ) -> ResultObservation {
        if let Resolution::Unavailable { cause } = availability {
            let cause = match cause {
                UnavailableCause::MissingRevision => "the published revision is missing or removed",
                UnavailableCause::IntegrityFailure => {
                    "the retained bytes failed their integrity check"
                }
                UnavailableCause::AccessRevoked => "access to the published revision was revoked",
                UnavailableCause::SourceUnknown => "the publication source is unknown",
                UnavailableCause::MaterializationFailed => {
                    "the exact published revision could not be opened"
                }
            };
            return unknown(cause);
        }
        match &report.request.check {
            ResultCheck::Publication { sha256 } => {
                if report.request.state == ResultState::UnknownEffect {
                    return unknown(
                        "publication integrity cannot establish whether an external effect happened",
                    );
                }
                match availability {
                    Resolution::Retained { sha256: actual, .. } if actual == sha256 => {
                        ResultObservation::Passed {
                            revision: actual.clone(),
                        }
                    }
                    _ => unknown(
                        "the declared digest does not match retained bytes, or the target is external",
                    ),
                }
            }
            ResultCheck::PrChecks {
                repository,
                number,
                head,
            } => {
                let url = format!("https://{repository}/pull/{number}");
                if report.request.target.revision != *head
                    || !matches!(&report.publication.target, PublishedTarget::External {url:actual,..} if actual == &url)
                {
                    return unknown(
                        "the declared PR/head does not name this exact target/output version",
                    );
                }
                let read = crate::reaction_checks::read(
                    &self.agents,
                    &self.ctx(conn.actor.clone()),
                    &report.request.id,
                )
                .await;
                match crate::reaction_checks::decide(head, repository, *number, &read) {
                    crate::reaction_checks::Verdict::Match => {
                        let Some(revision) =
                            read.ok().and_then(|r| r.evidence).and_then(|e| e.revision)
                        else {
                            return unknown("the authoritative check has no observation revision");
                        };
                        ResultObservation::Passed { revision }
                    }
                    crate::reaction_checks::Verdict::Invalidate(cause)
                    | crate::reaction_checks::Verdict::Wait(cause) => unknown(cause),
                }
            }
            ResultCheck::Unsupported { source } => {
                unknown(format!("unsupported authoritative source: {source}"))
            }
        }
    }
}

/// GET only: checking an uncertain effect must never issue it again or follow a redirect to one.
async fn read_resolution(
    source: &str,
    report: &ResultReport,
    authorizer: &contracts::Actor,
    now: i64,
) -> ResultObservation {
    let Ok(url) = url::Url::parse(source) else {
        return unknown("the authoritative source URL is invalid");
    };
    let loopback = match url.host() {
        Some(url::Host::Ipv4(ip)) => ip.is_loopback(),
        Some(url::Host::Ipv6(ip)) => ip.is_loopback(),
        _ => false,
    };
    if source.len() > 4096
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
        || !(url.scheme() == "https" || (url.scheme() == "http" && loopback))
    {
        return unknown(
            "use an HTTPS receipt source without embedded credentials or fragments (literal loopback HTTP is supported)",
        );
    }
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .redirect(reqwest::redirect::Policy::none())
        .no_proxy()
        .build()
    {
        Ok(client) => client,
        Err(_) => return unknown("the authoritative source reader could not start"),
    };
    let mut response = match client
        .get(url)
        .header("Cache-Control", "no-cache")
        .send()
        .await
    {
        Ok(response) if response.status().is_success() => response,
        Ok(response) => {
            return unknown(format!(
                "the authoritative source returned HTTP {}",
                response.status()
            ));
        }
        Err(_) => {
            return unknown(
                "the authoritative source was unavailable or did not answer within five seconds",
            );
        }
    };
    let mut bytes = Vec::new();
    loop {
        match response.chunk().await {
            Ok(Some(chunk)) if bytes.len() + chunk.len() <= 65536 => {
                bytes.extend_from_slice(&chunk)
            }
            Ok(Some(_)) => return unknown("the authoritative receipt exceeds 64 KiB"),
            Ok(None) => break,
            Err(_) => return unknown("the authoritative receipt could not be read completely"),
        }
    }
    let Ok(evidence) = serde_json::from_slice::<ResultResolution>(&bytes) else {
        return unknown("the authoritative source did not return a supported receipt");
    };
    if evidence.target != report.request.target {
        return unknown("the authoritative receipt names another target or version");
    }
    if evidence.revision.trim().is_empty() || evidence.revision.len() > 1024 {
        return unknown("the authoritative receipt has no usable source revision");
    }
    if evidence.observed_at < now.saturating_sub(60) || evidence.observed_at > now.saturating_add(5)
    {
        return unknown(
            "the authoritative receipt is stale or its observation time is in the future",
        );
    }
    if let ResultOutcome::Inconclusive { cause } = &evidence.outcome {
        return unknown(format!("the authoritative source is inconclusive: {cause}"));
    }
    ResultObservation::Resolved {
        source: source.into(),
        authorizer: authorizer.clone(),
        evidence,
    }
}
