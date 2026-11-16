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
