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
    first_line_hiding(stderr, secret_values())
}

fn secret_values() -> Vec<String> {
    std::env::vars()
        .filter(|(name, value)| {
            let name = name.to_ascii_uppercase();
            value.len() >= 4
                && ["TOKEN", "SECRET", "KEY", "PASSWORD", "AUTH"]
                    .iter()
                    .any(|word| name.contains(word))
        })
        .map(|(_, value)| value)
        .collect()
}

fn first_line_hiding(stderr: &str, secrets: Vec<String>) -> String {
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
    run(&program(), dir, args, stdin).await
}

/// The `gh` on the Daemon's `PATH`; a test names a fake on its own thread.
fn program() -> std::ffi::OsString {
    #[cfg(test)]
    if let Some(fake) = tests::FAKE.with(|fake| fake.borrow().clone()) {
        return fake.into();
    }
    "gh".into()
}

/// `program` is `gh` itself; a test names a fake.
async fn run(
    program: &std::ffi::OsStr,
    dir: &std::path::Path,
    args: &[&str],
    stdin: Option<&str>,
) -> Result<String, RpcError> {
    let mut child = tokio::process::Command::new(program)
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::os::unix::fs::PermissionsExt;

    thread_local! {
        pub(super) static FAKE: std::cell::RefCell<Option<std::path::PathBuf>> = const { std::cell::RefCell::new(None) };
    }

    const PR_JSON: &str = r#"{"number":7,"url":"https://github.com/o/r/pull/7","title":"T","body":"B","state":"OPEN","isDraft":true,"autoMergeRequest":null,"headRefOid":"abc","mergedAt":null}"#;

    /// A Daemon whose Project folder is `project` and whose `gh` is a fake that prints `view` for
    /// `pr view` and `issue view`; returns the fake's folder to read its argv.
    fn daemon_with_gh(view: &str) -> (tempfile::TempDir, tempfile::TempDir, Daemon) {
        let bin = tempfile::tempdir().unwrap();
        let project = tempfile::tempdir().unwrap();
        let fake = fake_gh(
            bin.path(),
            &format!("[ \"$2\" = view ] && echo '{view}'; exit 0"),
        );
        FAKE.with(|f| *f.borrow_mut() = Some(fake));
        let daemon = crate::tests::daemon_in(project.path());
        (bin, project, daemon)
    }

    async fn call(daemon: &Daemon, method: &str, params: Value) -> Result<Value, RpcError> {
        let (events, _) = tokio::sync::mpsc::unbounded_channel();
        let mut conn = Conn {
            actor: Actor::user(),
            peer: None,
            events,
            output: None,
        };
        daemon.github(&mut conn, method, params).await
    }

    fn argv(bin: &tempfile::TempDir) -> String {
        std::fs::read_to_string(bin.path().join("gh.argv")).unwrap_or_default()
    }

    #[tokio::test]
    async fn a5168a_pr_get_runs_one_view_and_parses_every_field() {
        let (bin, _project, daemon) = daemon_with_gh(PR_JSON);
        let pr = call(&daemon, "github.prGet", json!({"number": 7}))
            .await
            .unwrap();
        assert_eq!(pr["state"], "open");
        assert_eq!(pr["draft"], true);
        assert_eq!(pr["autoMerge"], false);
        assert_eq!(pr["head"], "abc");
        assert_eq!(pr["mergedAt"], Value::Null);
        assert_eq!(argv(&bin).lines().count(), 1);
        assert!(argv(&bin).starts_with("pr view 7 --json"));
    }

    #[tokio::test]
    async fn a5168a_issue_get_parses_labels_and_state_reason() {
        let json = r#"{"number":3,"url":"u","title":"T","body":"B","state":"CLOSED","labels":[{"name":"wontfix"}],"stateReason":"NOT_PLANNED"}"#;
        let (_bin, _project, daemon) = daemon_with_gh(json);
        let issue = call(&daemon, "github.issueGet", json!({"number": 3}))
            .await
            .unwrap();
        assert_eq!(issue["state"], "closed");
        assert_eq!(issue["labels"], json!(["wontfix"]));
        assert_eq!(issue["stateReason"], "NOT_PLANNED");
    }

    #[tokio::test]
    async fn a5168b_set_body_sends_the_body_on_stdin_and_returns_the_new_state() {
        let (bin, _project, daemon) = daemon_with_gh(PR_JSON);
        let pr = call(
            &daemon,
            "github.prSetBody",
            json!({"number": 7, "body": "new $(x) body"}),
        )
        .await
        .unwrap();
        assert_eq!(pr["number"], 7);
        assert!(argv(&bin).starts_with("pr edit 7 --body-file -"));
        assert!(argv(&bin).contains("pr view 7"));
    }

    #[tokio::test]
    async fn a5168b_an_empty_body_runs_no_gh() {
        let (bin, _project, daemon) = daemon_with_gh(PR_JSON);
        let err = call(
            &daemon,
            "github.prSetBody",
            json!({"number": 7, "body": ""}),
        )
        .await
        .unwrap_err();
        assert_eq!(err.code, code::INVALID_PARAMS);
        assert_eq!(argv(&bin), "");
    }

    #[tokio::test]
    async fn a5168b_ready_and_auto_merge_run_their_one_command() {
        let (bin, _project, daemon) = daemon_with_gh(PR_JSON);
        call(&daemon, "github.prReady", json!({"number": 7}))
            .await
            .unwrap();
        call(&daemon, "github.prAutoMerge", json!({"number": 7}))
            .await
            .unwrap();
        let lines = argv(&bin);
        assert_eq!(lines.matches("pr ready 7").count(), 1);
        assert_eq!(lines.matches("pr merge 7 --auto --merge").count(), 1);
    }

    #[tokio::test]
    async fn a5168b_a_repeat_runs_no_write() {
        let json = PR_JSON
            .replace("\"isDraft\":true", "\"isDraft\":false")
            .replace(
                "\"autoMergeRequest\":null",
                "\"autoMergeRequest\":{\"mergeMethod\":\"MERGE\"}",
            );
        let (bin, _project, daemon) = daemon_with_gh(&json);
        call(&daemon, "github.prReady", json!({"number": 7}))
            .await
            .unwrap();
        let pr = call(&daemon, "github.prAutoMerge", json!({"number": 7}))
            .await
            .unwrap();
        assert_eq!(pr["autoMerge"], true);
        assert!(!argv(&bin).contains("pr ready"));
        assert!(!argv(&bin).contains("pr merge"));
    }

    #[tokio::test]
    async fn a5168b_a_closed_pr_is_a_conflict_and_runs_no_write() {
        let (bin, _project, daemon) = daemon_with_gh(&PR_JSON.replace("OPEN", "MERGED"));
        for method in ["github.prReady", "github.prAutoMerge"] {
            let err = call(&daemon, method, json!({"number": 7}))
                .await
                .unwrap_err();
            assert_eq!(err.code, code::CONFLICT);
        }
        assert!(!argv(&bin).contains("pr ready"));
        assert!(!argv(&bin).contains("pr merge"));
    }

    /// A fake `gh` that records its argv, directory and stdin, then runs `body`.
    fn fake_gh(dir: &std::path::Path, body: &str) -> std::path::PathBuf {
        let script = dir.join("gh");
        std::fs::write(
            &script,
            format!(
                "#!/bin/sh\necho \"$@\" >> \"$0.argv\"\npwd > \"$0.cwd\"\ncat > \"$0.stdin\" < /dev/stdin\n{body}\n"
            ),
        )
        .unwrap();
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
        script
    }

    #[tokio::test]
    async fn a5168d_gh_runs_in_the_project_folder_with_its_argv() {
        let bin = tempfile::tempdir().unwrap();
        let project = tempfile::tempdir().unwrap();
        let fake = fake_gh(bin.path(), "echo '{}'");
        run(
            fake.as_ref(),
            project.path(),
            &["pr", "edit", "7", "--body-file", "-"],
            Some("hello"),
        )
        .await
        .unwrap();
        let read = |name: &str| std::fs::read_to_string(bin.path().join(name)).unwrap();
        assert_eq!(read("gh.argv").trim(), "pr edit 7 --body-file -");
        assert_eq!(read("gh.stdin"), "hello");
        let cwd = std::fs::canonicalize(project.path()).unwrap();
        assert_eq!(read("gh.cwd").trim(), cwd.to_str().unwrap());
    }

    #[tokio::test]
    async fn a5168c_a_non_zero_exit_returns_the_first_stderr_line() {
        let bin = tempfile::tempdir().unwrap();
        let fake = fake_gh(
            bin.path(),
            "echo 'gh: not logged in' >&2; echo second >&2; exit 1",
        );
        let err = run(fake.as_ref(), bin.path(), &["pr", "view", "1"], None)
            .await
            .unwrap_err();
        assert_eq!(err.code, code::INTERNAL);
        assert_eq!(err.message, "gh: gh: not logged in");
    }

    #[tokio::test]
    async fn a5168c_a_missing_gh_names_gh() {
        let empty = tempfile::tempdir().unwrap();
        let absent = empty.path().join("gh");
        let err = run(absent.as_ref(), empty.path(), &["pr", "view", "1"], None)
            .await
            .unwrap_err();
        assert_eq!(err.code, code::INTERNAL);
        assert!(
            err.message.starts_with("gh could not run"),
            "{}",
            err.message
        );
    }

    #[tokio::test]
    async fn a5168c_garbage_output_is_an_error_not_a_panic() {
        let Err(err) = parse::<RawPr>("<html>") else {
            panic!("garbage parsed");
        };
        assert_eq!(err.code, code::INTERNAL);
        assert!(err.message.contains("gh"));
    }

    #[test]
    fn a5168c_the_error_holds_no_environment_value() {
        let line = first_line_hiding(
            &format!("bad credentials ghp_secretvalue123 {}", "x".repeat(300)),
            vec!["ghp_secretvalue123".into()],
        );
        assert!(!line.contains("ghp_secretvalue123"));
        assert!(line.len() <= LINE_MAX);
    }

    #[test]
    fn a5168a_a_bad_number_runs_no_gh() {
        for bad in [0, -3] {
            assert_eq!(number(bad).unwrap_err().code, code::INVALID_PARAMS);
        }
        assert_eq!(number(5).unwrap(), "5");
    }
}
