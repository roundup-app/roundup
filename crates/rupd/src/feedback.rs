//! U7210c to U7210e (`scenarios/send-feedback.md`): the Daemon files the owner's feedback as an
//! Issue with the owner's `gh`, and tells the dialog whether `gh` can.

use base64::Engine;
use contracts::ActorKind;
use contracts::feedback::{Check, Filed, Gh, SendParams};
use rpc::{RpcError, code};

use crate::github::gh;
use crate::{Conn, Daemon};

const REPO: &str = "roundup-app/roundup";
/// The first `gh` whose `issue create` has `--attach`.
const ATTACH_SINCE: semver::Version = semver::Version::new(2, 103, 0);
const TITLE_CHARS: usize = 70;
const SHOT_ALT: &str = "The roundup window";

/// U7210c: the first line of `text` that is not blank, trimmed and cut to 70 characters.
fn title(text: &str) -> Option<String> {
    let line = text.lines().map(str::trim).find(|line| !line.is_empty())?;
    Some(
        line.chars()
            .take(TITLE_CHARS)
            .collect::<String>()
            .trim_end()
            .to_owned(),
    )
}

/// U7210d: whether the `gh --version` text names `gh` 2.103 or newer.
fn attaches(version: &str) -> bool {
    version
        .split_whitespace()
        .nth(2)
        .and_then(|number| semver::Version::parse(number).ok())
        .is_some_and(|number| number >= ATTACH_SINCE)
}

impl Daemon {
    fn owner_only(conn: &Conn, method: &str) -> Result<(), RpcError> {
        if conn.actor.kind != ActorKind::User {
            return Err(RpcError::forbidden(format!(
                "{method} is the owner's own action"
            )));
        }
        Ok(())
    }

    /// U7210e: the `gh --version` text, or `None` when `gh` cannot run.
    async fn gh_version(&self) -> Option<String> {
        gh(&self.project, &["--version"], None).await.ok()
    }

    pub(crate) async fn check_feedback(&self, conn: &mut Conn) -> Result<Check, RpcError> {
        Self::owner_only(conn, "feedback.check")?;
        let version = self.gh_version().await;
        let state = match &version {
            None => Gh::Missing,
            Some(_) if gh(&self.project, &["auth", "status"], None).await.is_ok() => Gh::Ready,
            Some(_) => Gh::SignedOut,
        };
        Ok(Check {
            gh: state,
            attach: version.as_deref().is_some_and(attaches),
            herdr_core: self.machine_core.version().await,
        })
    }

    pub(crate) async fn send_feedback(
        &self,
        conn: &mut Conn,
        p: SendParams,
    ) -> Result<Filed, RpcError> {
        Self::owner_only(conn, "feedback.send")?;
        let title = title(&p.text)
            .ok_or_else(|| RpcError::new(code::INVALID_PARAMS, "text must not be blank"))?;
        let body = format!("{}\n\n{}\n", p.text.trim_end(), p.versions.trim());
        let png = match p.shot.as_deref() {
            Some(shot) if self.gh_version().await.as_deref().is_some_and(attaches) => Some(
                base64::engine::general_purpose::STANDARD
                    .decode(shot)
                    .map_err(|_| RpcError::new(code::INVALID_PARAMS, "shot is not base64"))?,
            ),
            _ => None,
        };
        // Alive until `gh` has read the file.
        let dir = tempfile::tempdir().map_err(RpcError::internal)?;
        let attach = match png {
            Some(png) => {
                let path = dir.path().join("window.png");
                std::fs::write(&path, png).map_err(RpcError::internal)?;
                Some(format!("{}#{SHOT_ALT}", path.display()))
            }
            None => None,
        };
        let mut args = vec![
            "issue",
            "create",
            "--repo",
            REPO,
            "--title",
            &title,
            "--body-file",
            "-",
        ];
        if let Some(attach) = &attach {
            args.extend(["--attach", attach]);
        }
        let out = gh(&self.project, &args, Some(&body)).await?;
        let url = out
            .lines()
            .rev()
            .map(str::trim)
            .find(|line| line.starts_with("https://"))
            .ok_or_else(|| RpcError::internal("gh printed no Issue URL"))?;
        let number = url
            .rsplit('/')
            .next()
            .and_then(|last| last.parse().ok())
            .ok_or_else(|| RpcError::internal("gh printed an Issue URL without a number"))?;
        Ok(Filed {
            number,
            url: url.to_owned(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::github::tests::{FAKE, fake_gh};
    use contracts::Actor;
    use serde_json::Value;
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
        let mut conn = Conn {
            actor,
            peer: None,
            events,
            output: None,
        };
        daemon.route(&mut conn, method, params).await
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

/// The tests of U7210c to U7210e; the earlier Feedback report's `mod tests` above retires with it.
#[cfg(test)]
mod u7210_tests {
    use super::*;
    use crate::github::tests::{FAKE, fake_gh};
    use crate::machines::Core;
    use contracts::Actor;
    use serde_json::{Value, json};

    const VERSIONS: &str = "roundup 1.0 (abc123) · herdr-core 0.1.20 · macOS 26.1";
    const PNG: &[u8] = b"\x89PNG\r\n\x1a\n";

    struct Setup {
        bin: tempfile::TempDir,
        _data: tempfile::TempDir,
        daemon: Daemon,
        _project: tempfile::TempDir,
    }

    /// A signed-in `gh` of `version` that files Issue 7300 and keeps the file `--attach` names.
    fn gh_of(version: &str) -> String {
        format!(
            r#"case "$1" in
--version) echo "gh version {version} (2026-11-05)";;
auth) echo "Logged in";;
*) for a in "$@"; do case "$a" in *window.png#*) cp "${{a%%#*}}" "$0.shot";; esac; done
echo https://github.com/o/r/issues/7300;;
esac"#
        )
    }

    /// A Daemon whose `gh` is a fake running `body` and whose herdr-core is missing; the fake's
    /// argv and stdin are read from `bin`.
    fn setup(body: &str) -> Setup {
        let bin = tempfile::tempdir().unwrap();
        let project = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        FAKE.with(|f| *f.borrow_mut() = Some(fake_gh(bin.path(), body)));
        let mut daemon = Daemon::open_project(project.path(), data.path()).unwrap().0;
        daemon.machine_core = Core::new(|| Box::pin(async { Err(herdr::Error::Missing) }));
        Setup {
            bin,
            _data: data,
            daemon,
            _project: project,
        }
    }

    async fn call_as(
        daemon: &Daemon,
        actor: Actor,
        method: &str,
        params: Value,
    ) -> Result<Value, RpcError> {
        let (events, _) = tokio::sync::mpsc::unbounded_channel();
        let mut conn = Conn {
            actor,
            peer: None,
            events,
            output: None,
        };
        daemon.route(&mut conn, method, params).await
    }

    async fn call(daemon: &Daemon, method: &str, params: Value) -> Value {
        call_as(daemon, Actor::user(), method, params)
            .await
            .unwrap()
    }

    fn send(text: &str, shot: bool) -> Value {
        let mut p = json!({"text": text, "versions": VERSIONS});
        if shot {
            p["shot"] = json!("iVBORw0KGgo=");
        }
        p
    }

    fn argv(s: &Setup) -> Vec<String> {
        std::fs::read_to_string(s.bin.path().join("gh.argv"))
            .unwrap_or_default()
            .lines()
            .map(str::to_owned)
            .collect()
    }

    fn creates(s: &Setup) -> Vec<String> {
        argv(s)
            .into_iter()
            .filter(|line| line.starts_with("issue create"))
            .collect()
    }

    #[tokio::test]
    async fn u7210c_send_runs_one_issue_create_with_the_body_on_stdin_and_the_shot_attached() {
        let s = setup(&gh_of("2.103.3"));
        let filed = call(&s.daemon, "feedback.send", send("the Rail jumps", true)).await;
        assert_eq!(
            filed,
            json!({"number": 7300, "url": "https://github.com/o/r/issues/7300"})
        );
        let creates = creates(&s);
        assert_eq!(creates.len(), 1);
        assert!(creates[0].starts_with(
            "issue create --repo roundup-app/roundup --title the Rail jumps --body-file - --attach "
        ));
        assert!(creates[0].ends_with("window.png#The roundup window"));
        assert_eq!(std::fs::read(s.bin.path().join("gh.shot")).unwrap(), PNG);
        let stdin = std::fs::read_to_string(s.bin.path().join("gh.stdin")).unwrap();
        assert_eq!(stdin, format!("the Rail jumps\n\n{VERSIONS}\n"));
    }

    #[tokio::test]
    async fn u7210c_the_title_is_the_first_line_cut_to_70_characters() {
        let s = setup(&gh_of("2.103.3"));
        let long = format!("\n  hello  \n{}", "x".repeat(80));
        call(&s.daemon, "feedback.send", send(&long, false)).await;
        let cut = format!("{}\nsecond", "y".repeat(80));
        call(&s.daemon, "feedback.send", send(&cut, false)).await;
        let creates = creates(&s);
        assert!(creates[0].contains("--title hello --body-file -"));
        assert!(creates[1].contains(&format!("--title {} --body-file -", "y".repeat(70))));
        let blank = call_as(
            &s.daemon,
            Actor::user(),
            "feedback.send",
            send(" \n ", false),
        )
        .await
        .unwrap_err();
        assert_eq!(blank.code, code::INVALID_PARAMS);
        assert_eq!(argv(&s).len(), 2, "a blank text runs no gh");
    }

    #[tokio::test]
    async fn u7210c_no_shot_runs_no_attach() {
        let s = setup(&gh_of("2.103.3"));
        call(&s.daemon, "feedback.send", send("the Rail jumps", false)).await;
        let argv = argv(&s);
        assert_eq!(argv.len(), 1, "no shot asks gh nothing but the Issue");
        assert!(!argv[0].contains("--attach"));
    }

    #[tokio::test]
    async fn u7210c_a_failure_names_gh_with_its_first_stderr_line() {
        let s = setup(
            r#"case "$1" in --version) echo "gh version 2.103.3";; *) echo 'HTTP 401: Bad credentials' >&2; echo second >&2; exit 1;; esac"#,
        );
        let err = call_as(
            &s.daemon,
            Actor::user(),
            "feedback.send",
            send("the Rail jumps", false),
        )
        .await
        .unwrap_err();
        assert_eq!(err.message, "gh: HTTP 401: Bad credentials");
    }

    #[tokio::test]
    async fn u7210c_no_token_variable_is_set_or_read() {
        let s = setup(&format!("env > \"$0.env\"; {}", gh_of("2.103.3")));
        call(&s.daemon, "feedback.send", send("the Rail jumps", false)).await;
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
    async fn u7210c_an_agent_is_forbidden() {
        let s = setup(&gh_of("2.103.3"));
        let agent = || Actor {
            kind: ActorKind::Agent,
            id: "a1".into(),
            parent: None,
        };
        for (method, params) in [
            ("feedback.send", send("the Rail jumps", false)),
            ("feedback.check", json!(null)),
        ] {
            let err = call_as(&s.daemon, agent(), method, params)
                .await
                .unwrap_err();
            assert_eq!(err.code, code::FORBIDDEN);
        }
        assert!(argv(&s).is_empty());
    }

    #[tokio::test]
    async fn u7210d_an_older_gh_attaches_nothing() {
        let s = setup(&gh_of("2.102.9"));
        call(&s.daemon, "feedback.send", send("the Rail jumps", true)).await;
        let creates = creates(&s);
        assert_eq!(creates.len(), 1);
        assert!(!creates[0].contains("--attach"));
    }

    #[tokio::test]
    async fn u7210d_gh_2_103_attaches() {
        let s = setup(&gh_of("2.103.0"));
        call(&s.daemon, "feedback.send", send("the Rail jumps", true)).await;
        assert!(creates(&s)[0].contains("--attach "));
    }

    #[tokio::test]
    async fn u7210e_check_names_a_missing_gh_a_signed_out_gh_and_a_ready_one() {
        let s = setup(&gh_of("2.103.3"));
        let ready = call(&s.daemon, "feedback.check", json!(null)).await;
        assert_eq!(ready, json!({"gh": "ready", "attach": true}));
        assert_eq!(argv(&s), ["--version", "auth status"], "no token is read");

        let s = setup(
            r#"case "$1" in --version) echo "gh version 2.102.0";; *) echo 'You are not logged into any GitHub hosts.' >&2; exit 1;; esac"#,
        );
        let out = call(&s.daemon, "feedback.check", json!(null)).await;
        assert_eq!(out, json!({"gh": "signed-out", "attach": false}));

        let s = setup("exit 0");
        FAKE.with(|f| *f.borrow_mut() = Some("/nonexistent/gh".into()));
        let missing = call(&s.daemon, "feedback.check", json!(null)).await;
        assert_eq!(missing, json!({"gh": "missing", "attach": false}));
    }
}
