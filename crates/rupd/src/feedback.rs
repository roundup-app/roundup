//! FB3 to FB5 (`scenarios/feedback-report.md`): the Daemon adds its facts to a Feedback report, then
//! posts it with the owner's `gh` or keeps it in `<App data>/feedback/<id>/`. A report is saved
//! before `gh` runs, and its dir moves to `posted/` only after `gh` exited 0.

use base64::Engine;
use contracts::feedback::{RetryParams, SendParams, Sent};
use contracts::{Actor, ActorKind};
use rpc::{RpcError, code, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};

use crate::github::gh;
use crate::{Conn, Daemon};

const LOG_LINES: usize = 200;
const LOG_FILE: &str = "rupd.log";

/// One report at a time, so a retry racing a retry or a double press finds the first result.
static GATE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[derive(Serialize, Deserialize)]
struct Saved {
    text: String,
    body: String,
    target: String,
    cause: Option<String>,
}

fn is_token_line(line: &str) -> bool {
    let after = |marker: &str| {
        line.match_indices(marker).any(|(at, _)| {
            line[at + marker.len()..].starts_with(|c: char| c.is_ascii_alphanumeric())
        })
    };
    let pat = |kinds: &str| kinds.chars().any(|kind| after(&format!("gh{kind}_")));
    pat("pousr")
        || after("github_pat_")
        || after("Bearer ")
        || line.contains("GH_TOKEN=")
        || line.contains("GITHUB_TOKEN=")
}

/// FB3: the last `LOG_LINES` lines of `text`, each line holding a token replaced.
fn tail_redacted(text: &str) -> String {
    let lines: Vec<&str> = text.lines().collect();
    lines
        .iter()
        .skip(lines.len().saturating_sub(LOG_LINES))
        .map(|line| {
            if is_token_line(line) {
                "[redacted]"
            } else {
                line
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn valid_target(target: &str) -> Result<(), &'static str> {
    let target = target.trim();
    if target.is_empty() {
        return Err("the Feedback Issue setting is empty");
    }
    let rest = target.strip_prefix("https://github.com/");
    let ok = rest.is_some_and(|rest| {
        let parts: Vec<&str> = rest.split('/').collect();
        matches!(parts.as_slice(), [owner, repo, "issues", number]
            if !owner.is_empty()
                && !repo.is_empty()
                && !number.is_empty()
                && number.bytes().all(|b| b.is_ascii_digit()))
    });
    if ok {
        Ok(())
    } else {
        Err("the Feedback Issue setting is not an Issue URL")
    }
}

impl Daemon {
    /// `<App data>`: the parent of `projects/` when the Daemon's data dir is a Project's.
    fn app_data(&self) -> PathBuf {
        match self.data_dir.parent() {
            Some(projects) if projects.file_name().is_some_and(|name| name == "projects") => {
                projects.parent().unwrap_or(projects).to_path_buf()
            }
            _ => self.data_dir.clone(),
        }
    }

    /// FB3: the Daemon's own facts, ending with its log's last 200 lines.
    async fn daemon_facts(&self, selected: Option<&str>) -> String {
        let mut out = String::from("Daemon: up\n");
        let node = match selected {
            Some(id) => self
                .rail()
                .await
                .ok()
                .and_then(|rail| rail.into_iter().find(|n| n.id == id)),
            None => None,
        };
        match (selected, node) {
            (_, Some(node)) => {
                let status = node.status.map_or("none".to_string(), |s| {
                    format!("{:?} ({})", s.kind, s.label)
                });
                out.push_str(&format!(
                    "Selected: {} {:?}, state {status}\n",
                    node.name, node.kind
                ));
            }
            (Some(id), None) => out.push_str(&format!("Selected: {id}, not on the Rail\n")),
            (None, None) => out.push_str("Selected: none\n"),
        }
        let log = std::fs::read_to_string(self.app_data().join(LOG_FILE)).unwrap_or_default();
        out.push_str("\nDaemon log, last 200 lines:\n");
        out.push_str(&tail_redacted(&log));
        out
    }

    pub(crate) async fn feedback(
        &self,
        conn: &Conn,
        method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        let Actor { kind, .. } = &conn.actor;
        if *kind != ActorKind::User {
            return Err(RpcError::forbidden(format!(
                "{method} is the owner's own action"
            )));
        }
        let sent = if method == "feedback.send" {
            self.feedback_send(params(value)?).await?
        } else {
            self.feedback_retry(params(value)?).await?
        };
        rpc::reply(&sent)
    }

    async fn feedback_send(&self, p: SendParams) -> Result<Sent, RpcError> {
        let id = checked_id(&p.id)?;
        let shot = match p.shot.as_deref() {
            Some(shot) => Some(
                base64::engine::general_purpose::STANDARD
                    .decode(shot)
                    .map_err(|_| RpcError::new(code::INVALID_PARAMS, "shot is not base64"))?,
            ),
            None => None,
        };
        let _gate = GATE.lock().await;
        if let Some(first) = self.first_result(id) {
            return Ok(first);
        }
        let dir = self.app_data().join("feedback").join(id);
        if let Some(cause) = read_saved(&dir).and_then(|saved| saved.cause) {
            return Ok(Sent::Kept {
                dir: dir.to_string_lossy().into_owned(),
                cause,
            });
        }
        let facts = self.daemon_facts(p.selected.as_deref()).await;
        let saved = Saved {
            body: format!(
                "{}\n\n{}\n\n{facts}\n",
                p.text.trim_end(),
                p.facts.trim_end()
            ),
            text: p.text,
            target: p.target,
            cause: None,
        };
        std::fs::create_dir_all(&dir).map_err(RpcError::internal)?;
        if let Some(shot) = shot {
            std::fs::write(dir.join("shot.png"), shot).map_err(RpcError::internal)?;
        }
        write_saved(&dir, &saved)?;
        Ok(self.post(id, &dir, saved).await)
    }

    async fn feedback_retry(&self, p: RetryParams) -> Result<Sent, RpcError> {
        let id = checked_id(&p.id)?;
        let _gate = GATE.lock().await;
        if let Some(first) = self.first_result(id) {
            return Ok(first);
        }
        let dir = self.app_data().join("feedback").join(id);
        let mut saved = read_saved(&dir)
            .ok_or_else(|| RpcError::not_found(format!("no kept Feedback report {id}")))?;
        if let Some(target) = p.target {
            saved.target = target;
            write_saved(&dir, &saved)?;
        }
        Ok(self.post(id, &dir, saved).await)
    }

    /// FB5: a report that posted returns its comment; one kept and sent again returns its cause.
    fn first_result(&self, id: &str) -> Option<Sent> {
        let root = self.app_data().join("feedback");
        if let Ok(url) = std::fs::read_to_string(root.join("posted").join(id).join("url")) {
            return Some(Sent::Posted { url });
        }
        let dir = root.join(id);
        // A crash after `gh` exited 0 left its URL here: finish the move, run no `gh`.
        let url = std::fs::read_to_string(dir.join("url")).ok()?;
        self.move_posted(id, &dir);
        Some(Sent::Posted { url })
    }

    fn move_posted(&self, id: &str, dir: &Path) {
        let posted = self.app_data().join("feedback").join("posted");
        if std::fs::create_dir_all(&posted).is_ok() {
            let _ = std::fs::rename(dir, posted.join(id));
        }
    }

    async fn post(&self, id: &str, dir: &Path, mut saved: Saved) -> Sent {
        let result = match valid_target(&saved.target) {
            Err(cause) => Err(cause.to_string()),
            Ok(()) => {
                let shot = dir.join("shot.png");
                let shot = shot.to_string_lossy().into_owned();
                let mut args = vec!["issue", "comment", saved.target.trim(), "--body-file", "-"];
                if dir.join("shot.png").exists() {
                    args.extend(["--attach", &shot]);
                }
                gh(&self.project, &args, Some(&saved.body))
                    .await
                    .map_err(|err| err.message)
            }
        };
        match result {
            Ok(out) => {
                let url = out
                    .lines()
                    .rev()
                    .map(str::trim)
                    .find(|line| line.starts_with("https://"))
                    .unwrap_or(saved.target.trim())
                    .to_string();
                // The URL is on disk before the move: a crash between them posts nothing twice.
                let _ = std::fs::write(dir.join("url"), &url);
                self.move_posted(id, dir);
                Sent::Posted { url }
            }
            Err(cause) => {
                saved.cause = Some(cause.clone());
                let _ = write_saved(dir, &saved);
                Sent::Kept {
                    dir: dir.to_string_lossy().into_owned(),
                    cause,
                }
            }
        }
    }
}

fn checked_id(id: &str) -> Result<&str, RpcError> {
    let ok = !id.is_empty()
        && id.len() <= 64
        && id != "posted"
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
    if ok {
        Ok(id)
    } else {
        Err(RpcError::new(
            code::INVALID_PARAMS,
            "id must be 1 to 64 letters, digits, - or _",
        ))
    }
}

fn write_saved(dir: &Path, saved: &Saved) -> Result<(), RpcError> {
    let json = serde_json::to_string_pretty(saved).map_err(RpcError::internal)?;
    std::fs::write(dir.join("report.json"), json).map_err(RpcError::internal)
}

fn read_saved(dir: &Path) -> Option<Saved> {
    serde_json::from_str(&std::fs::read_to_string(dir.join("report.json")).ok()?).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::github::tests::{FAKE, fake_gh};
    use serde_json::json;

    const TARGET: &str = "https://github.com/o/r/issues/6163";

    struct Setup {
        bin: tempfile::TempDir,
        _data: tempfile::TempDir,
        daemon: Daemon,
        _project: tempfile::TempDir,
    }

    /// A Daemon whose `gh` is a fake running `body`; its argv and stdin are read from `bin`.
    fn setup(body: &str) -> Setup {
        let bin = tempfile::tempdir().unwrap();
        let project = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        FAKE.with(|f| *f.borrow_mut() = Some(fake_gh(bin.path(), body)));
        let daemon = Daemon::open_project(project.path(), data.path()).unwrap().0;
        Setup {
            bin,
            _data: data,
            daemon,
            _project: project,
        }
    }

    const OK: &str = "echo https://github.com/o/r/issues/6163#issuecomment-1";

    async fn call_as(
        daemon: &Daemon,
        actor: Actor,
        method: &str,
        params: Value,
    ) -> Result<Value, RpcError> {
        let (events, _) = tokio::sync::mpsc::unbounded_channel();
        let conn = Conn {
            actor,
            peer: None,
            events,
            output: None,
        };
        daemon.feedback(&conn, method, params).await
    }

    async fn call(daemon: &Daemon, method: &str, params: Value) -> Value {
        call_as(daemon, Actor::user(), method, params)
            .await
            .unwrap()
    }

    fn send(id: &str, shot: bool, target: &str) -> Value {
        let mut p =
            json!({"id": id, "text": "the Rail jumps", "facts": "App 1.0", "target": target});
        if shot {
            p["shot"] = json!("iVBORw0KGgo=");
        }
        p
    }

    fn argv(s: &Setup) -> String {
        std::fs::read_to_string(s.bin.path().join("gh.argv")).unwrap_or_default()
    }

    fn feedback(s: &Setup) -> std::path::PathBuf {
        s.daemon.app_data().join("feedback")
    }

    #[tokio::test]
    async fn fb4_send_runs_one_comment_with_the_body_on_stdin_and_the_shot_attached() {
        let s = setup(OK);
        let sent = call(&s.daemon, "feedback.send", send("r1", true, TARGET)).await;
        assert_eq!(sent["state"], "posted");
        assert_eq!(
            sent["url"],
            "https://github.com/o/r/issues/6163#issuecomment-1"
        );
        let argv = argv(&s);
        assert_eq!(argv.lines().count(), 1);
        assert!(argv.starts_with(&format!("issue comment {TARGET} --body-file - --attach ")));
        assert!(argv.trim_end().ends_with("shot.png"));
        let stdin = std::fs::read_to_string(s.bin.path().join("gh.stdin")).unwrap();
        assert!(stdin.starts_with("the Rail jumps\n\nApp 1.0\n\nDaemon: up\n"));
    }

    #[tokio::test]
    async fn fb4_no_shot_runs_no_attach() {
        let s = setup(OK);
        call(&s.daemon, "feedback.send", send("r1", false, TARGET)).await;
        assert!(!argv(&s).contains("--attach"));
    }

    #[tokio::test]
    async fn fb4_a_failure_names_gh_with_its_first_stderr_line() {
        let s = setup("echo 'HTTP 401: Bad credentials' >&2; echo second >&2; exit 1");
        let sent = call(&s.daemon, "feedback.send", send("r1", false, TARGET)).await;
        assert_eq!(sent["state"], "kept");
        assert_eq!(sent["cause"], "gh: HTTP 401: Bad credentials");
    }

    #[tokio::test]
    async fn fb4_no_token_variable_is_set_or_read() {
        let s = setup(&format!("env > \"$0.env\"; {OK}"));
        call(&s.daemon, "feedback.send", send("r1", false, TARGET)).await;
        let env = std::fs::read_to_string(s.bin.path().join("gh.env")).unwrap();
        for name in ["GH_TOKEN", "GITHUB_TOKEN"] {
            let seen = env.lines().any(|l| l.starts_with(&format!("{name}=")));
            assert_eq!(
                seen,
                std::env::var_os(name).is_some(),
                "{name} is the Daemon's own"
            );
        }
        let body = std::fs::read_to_string(s.bin.path().join("gh.stdin")).unwrap();
        assert!(!body.contains("GH_TOKEN=") && !body.contains("GITHUB_TOKEN="));
    }

    #[tokio::test]
    async fn fb4_an_agent_is_forbidden() {
        let s = setup(OK);
        let agent = Actor {
            kind: ActorKind::Agent,
            id: "a1".into(),
            parent: None,
        };
        let err = call_as(&s.daemon, agent, "feedback.send", send("r1", false, TARGET))
            .await
            .unwrap_err();
        assert_eq!(err.code, code::FORBIDDEN);
        assert_eq!(argv(&s), "");
        assert!(!feedback(&s).exists());
    }

    #[tokio::test]
    async fn fb5_a_missing_or_failing_gh_keeps_the_report_in_its_folder() {
        let s = setup("exit 1");
        FAKE.with(|f| *f.borrow_mut() = Some(s.bin.path().join("absent")));
        let sent = call(&s.daemon, "feedback.send", send("r1", true, TARGET)).await;
        assert_eq!(sent["state"], "kept");
        assert!(
            sent["cause"]
                .as_str()
                .unwrap()
                .starts_with("gh could not run")
        );
        let dir = feedback(&s).join("r1");
        assert_eq!(sent["dir"], dir.to_string_lossy().as_ref());
        let saved = read_saved(&dir).unwrap();
        assert_eq!(saved.text, "the Rail jumps");
        assert!(saved.body.contains("App 1.0") && saved.body.contains("Daemon: up"));
        assert!(dir.join("shot.png").exists());
    }

    #[tokio::test]
    async fn fb5_retry_posts_once_and_moves_the_folder() {
        let s = setup("exit 1");
        call(&s.daemon, "feedback.send", send("r1", false, TARGET)).await;
        FAKE.with(|f| *f.borrow_mut() = Some(fake_gh(s.bin.path(), OK)));
        let first = call(&s.daemon, "feedback.retry", json!({"id": "r1"})).await;
        assert_eq!(first["state"], "posted");
        assert!(!feedback(&s).join("r1").exists());
        let url = std::fs::read_to_string(feedback(&s).join("posted/r1/url")).unwrap();
        assert_eq!(first["url"], url.as_str());
        assert_eq!(argv(&s).lines().count(), 2);
    }

    #[tokio::test]
    async fn fb5_a_second_or_racing_retry_runs_no_gh() {
        let s = setup("exit 1");
        call(&s.daemon, "feedback.send", send("r1", false, TARGET)).await;
        FAKE.with(|f| *f.borrow_mut() = Some(fake_gh(s.bin.path(), &format!("sleep 0.2; {OK}"))));
        let retry = json!({"id": "r1"});
        let (a, b) = tokio::join!(
            call(&s.daemon, "feedback.retry", retry.clone()),
            call(&s.daemon, "feedback.retry", retry.clone()),
        );
        let c = call(&s.daemon, "feedback.retry", retry).await;
        assert_eq!(a, b);
        assert_eq!(a, c);
        assert_eq!(argv(&s).lines().count(), 2, "one failed send, one post");
    }

    #[tokio::test]
    async fn fb5_a_double_send_posts_once() {
        let s = setup(&format!("sleep 0.2; {OK}"));
        let (a, b) = tokio::join!(
            call(&s.daemon, "feedback.send", send("r1", false, TARGET)),
            call(&s.daemon, "feedback.send", send("r1", false, TARGET)),
        );
        assert_eq!(a, b);
        assert_eq!(argv(&s).lines().count(), 1);
    }

    #[tokio::test]
    async fn fb5_a_crash_after_posting_before_the_move_does_not_post_twice() {
        let s = setup("exit 1");
        call(&s.daemon, "feedback.send", send("r1", false, TARGET)).await;
        // gh exited 0 and the URL was written; the process died before the move.
        std::fs::write(
            feedback(&s).join("r1/url"),
            "https://github.com/o/r/issues/6163#issuecomment-9",
        )
        .unwrap();
        let retried = call(&s.daemon, "feedback.retry", json!({"id": "r1"})).await;
        assert_eq!(
            retried["url"],
            "https://github.com/o/r/issues/6163#issuecomment-9"
        );
        assert_eq!(argv(&s).lines().count(), 1);
        assert!(feedback(&s).join("posted/r1").exists());
    }

    #[tokio::test]
    async fn fb6_the_url_is_the_comment_target() {
        let s = setup("exit 1");
        call(&s.daemon, "feedback.send", send("r1", false, "")).await;
        FAKE.with(|f| *f.borrow_mut() = Some(fake_gh(s.bin.path(), OK)));
        let other = "https://github.com/x/y/issues/7";
        call(
            &s.daemon,
            "feedback.retry",
            json!({"id": "r1", "target": other}),
        )
        .await;
        assert!(argv(&s).starts_with(&format!("issue comment {other} ")));
    }

    #[tokio::test]
    async fn fb6_an_empty_target_keeps_without_running_gh() {
        let s = setup(OK);
        let empty = call(&s.daemon, "feedback.send", send("r1", false, " ")).await;
        let invalid = call(
            &s.daemon,
            "feedback.send",
            send("r2", false, "https://github.com/o/r/pull/3"),
        )
        .await;
        assert_eq!(empty["state"], "kept");
        assert!(empty["cause"].as_str().unwrap().contains("empty"));
        assert!(
            invalid["cause"]
                .as_str()
                .unwrap()
                .contains("not an Issue URL")
        );
        assert_eq!(argv(&s), "");
    }

    #[tokio::test]
    async fn fb3_the_body_holds_the_selected_node_and_the_log_tail_with_a_token_redacted() {
        let s = setup(OK);
        let log: String = (1..=300)
            .map(|n| {
                if n == 250 {
                    "token ghp_abcdef123456".to_string()
                } else {
                    format!("line {n}")
                }
            })
            .collect::<Vec<_>>()
            .join("\n");
        std::fs::write(s.daemon.app_data().join(LOG_FILE), log).unwrap();
        let line = json!({"id":1,"method":"rail.createWorkstream","params":{"name":"Home"}});
        let workstream = crate::tests::ask(&s.daemon, &line.to_string()).await["result"].clone();
        let mut p = send("r1", false, TARGET);
        p["selected"] = workstream["id"].clone();
        call(&s.daemon, "feedback.send", p).await;
        let body = std::fs::read_to_string(s.bin.path().join("gh.stdin")).unwrap();
        assert!(body.contains("Selected: Home Workstream"), "{body}");
        assert!(body.contains("line 300") && body.contains("line 101"));
        assert!(!body.contains("line 100\n") && !body.contains("ghp_"));
        assert!(body.contains("[redacted]"));
    }
}
