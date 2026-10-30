//! A5168a to A5168d: the GitHub tools. Each runs the `gh` on the Daemon's `PATH` in the Project's
//! folder with the Daemon's own environment, so the owner's login decides what it may do.

use contracts::github::{Issue, Number, Pr, SetBodyParams, State};
use contracts::{Actor, ActorKind};
use rpc::{RpcError, code, params};
use serde::Deserialize;
use serde_json::Value;
use std::process::Stdio;
use tokio::io::AsyncWriteExt;

use crate::{Conn, Daemon};

const LINE_MAX: usize = 200;
const PR_FIELDS: &str = "number,url,title,body,state,isDraft,autoMergeRequest,headRefOid,mergedAt";
const ISSUE_FIELDS: &str = "number,url,title,body,state,labels,stateReason";

fn number(value: i32) -> Result<String, RpcError> {
    if value < 1 {
        return Err(RpcError::new(
            code::INVALID_PARAMS,
            "number must be a positive integer",
        ));
    }
    Ok(value.to_string())
}

/// A5168c: `gh`'s first stderr line, at most 200 bytes, with the value of any secret-looking
/// environment variable and any header line left out.
fn first_line(stderr: &str) -> String {
    let secrets: Vec<String> = std::env::vars()
        .filter(|(name, value)| {
            let name = name.to_ascii_uppercase();
            value.len() >= 4
                && ["TOKEN", "SECRET", "KEY", "PASSWORD", "AUTH"]
                    .iter()
                    .any(|word| name.contains(word))
        })
        .map(|(_, value)| value)
        .collect();
    let mut line = stderr
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("no message")
        .to_string();
    for secret in secrets {
        line = line.replace(&secret, "***");
    }
    if line.to_ascii_lowercase().contains("authorization") {
        line = "a header was reported".into();
    }
    let mut end = line.len().min(LINE_MAX);
    while !line.is_char_boundary(end) {
        end -= 1;
    }
    line.truncate(end);
    line
}

async fn gh(dir: &std::path::Path, args: &[&str], stdin: Option<&str>) -> Result<String, RpcError> {
    let mut child = tokio::process::Command::new("gh")
        .args(args)
        .current_dir(dir)
        .stdin(if stdin.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|err| {
            RpcError::internal(format!(
                "gh could not run: {}",
                first_line(&err.to_string())
            ))
        })?;
    if let (Some(text), Some(mut pipe)) = (stdin, child.stdin.take()) {
        let _ = pipe.write_all(text.as_bytes()).await;
    }
    let out = tokio::time::timeout(std::time::Duration::from_secs(60), child.wait_with_output())
        .await
        .map_err(|_| RpcError::internal("gh did not answer within 60 s"))?
        .map_err(|err| {
            RpcError::internal(format!("gh failed: {}", first_line(&err.to_string())))
        })?;
    if out.status.success() {
        return Ok(String::from_utf8_lossy(&out.stdout).into_owned());
    }
    let line = first_line(&String::from_utf8_lossy(&out.stderr));
    let lower = line.to_ascii_lowercase();
    if lower.contains("could not resolve to") || lower.contains("no pull requests found") {
        return Err(RpcError::not_found(format!("gh: {line}")));
    }
    Err(RpcError::internal(format!("gh: {line}")))
}

fn parse<T: for<'de> Deserialize<'de>>(text: &str) -> Result<T, RpcError> {
    serde_json::from_str(text).map_err(|_| {
        RpcError::internal(format!(
            "gh printed output that is not JSON: {}",
            first_line(text)
        ))
    })
}

fn state(raw: &str) -> Result<State, RpcError> {
    match raw.to_ascii_uppercase().as_str() {
        "OPEN" => Ok(State::Open),
        "CLOSED" => Ok(State::Closed),
        "MERGED" => Ok(State::Merged),
        other => Err(RpcError::internal(format!(
            "gh reported the state {other:?}"
        ))),
    }
}

#[derive(Deserialize)]
struct RawPr {
    number: u32,
    url: String,
    title: String,
    #[serde(default)]
    body: String,
    state: String,
    #[serde(rename = "isDraft", default)]
    is_draft: bool,
    #[serde(rename = "autoMergeRequest", default)]
    auto_merge: Option<Value>,
    #[serde(rename = "headRefOid", default)]
    head: String,
    #[serde(rename = "mergedAt", default)]
    merged_at: Option<String>,
}

#[derive(Deserialize)]
struct RawLabel {
    name: String,
}

#[derive(Deserialize)]
struct RawIssue {
    number: u32,
    url: String,
    title: String,
    #[serde(default)]
    body: String,
    state: String,
    #[serde(default)]
    labels: Vec<RawLabel>,
    #[serde(rename = "stateReason", default)]
    state_reason: Option<String>,
}

impl Daemon {
    async fn pr_now(&self, number: &str) -> Result<Pr, RpcError> {
        let raw: RawPr = parse(
            &gh(
                &self.project,
                &["pr", "view", number, "--json", PR_FIELDS],
                None,
            )
            .await?,
        )?;
        Ok(Pr {
            number: raw.number,
            url: raw.url,
            title: raw.title,
            body: raw.body,
            state: state(&raw.state)?,
            draft: raw.is_draft,
            auto_merge: raw.auto_merge.is_some_and(|value| !value.is_null()),
            head: raw.head,
            merged_at: raw.merged_at.filter(|at| !at.is_empty()),
        })
    }

    async fn issue_now(&self, number: &str) -> Result<Issue, RpcError> {
        let raw: RawIssue = parse(
            &gh(
                &self.project,
                &["issue", "view", number, "--json", ISSUE_FIELDS],
                None,
            )
            .await?,
        )?;
        Ok(Issue {
            number: raw.number,
            url: raw.url,
            title: raw.title,
            body: raw.body,
            state: state(&raw.state)?,
            labels: raw.labels.into_iter().map(|label| label.name).collect(),
            state_reason: raw.state_reason.filter(|reason| !reason.is_empty()),
        })
    }

    /// A5168a, A5168b: a Door (or the user) calls these; no other Agent does.
    pub(crate) async fn github(
        &self,
        conn: &Conn,
        method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        let Actor { kind, .. } = &conn.actor;
        if *kind == ActorKind::Agent {
            self.require_door(&conn.actor).await?;
        }
        match method {
            "github.prSetBody" => {
                let p: SetBodyParams = params(value)?;
                let n = number(p.number)?;
                if p.body.is_empty() {
                    return Err(RpcError::new(
                        code::INVALID_PARAMS,
                        "body must not be empty",
                    ));
                }
                gh(
                    &self.project,
                    &["pr", "edit", &n, "--body-file", "-"],
                    Some(&p.body),
                )
                .await?;
                rpc::reply(&self.pr_now(&n).await?)
            }
            "github.prReady" | "github.prAutoMerge" => {
                let n = number(params::<Number>(value)?.number)?;
                let before = self.pr_now(&n).await?;
                let ready = method == "github.prReady";
                if before.state != State::Open {
                    return Err(RpcError::conflict(format!(
                        "PR {n} is {:?}, so it cannot be changed",
                        before.state
                    )));
                }
                if (ready && !before.draft) || (!ready && before.auto_merge) {
                    return rpc::reply(&before);
                }
                let args: &[&str] = if ready {
                    &["pr", "ready", &n]
                } else {
                    &["pr", "merge", &n, "--auto", "--merge"]
                };
                gh(&self.project, args, None).await?;
                rpc::reply(&self.pr_now(&n).await?)
            }
            "github.issueGet" => rpc::reply(
                &self
                    .issue_now(&number(params::<Number>(value)?.number)?)
                    .await?,
            ),
            _ => rpc::reply(
                &self
                    .pr_now(&number(params::<Number>(value)?.number)?)
                    .await?,
            ),
        }
    }
}
