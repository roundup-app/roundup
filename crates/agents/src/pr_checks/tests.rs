//! NR10: required checks read through a fake `gh` that emits recorded JSON.
use super::*;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::time::Duration;

const HEAD: &str = "1111111111111111111111111111111111111111";
const MOVED: &str = "2222222222222222222222222222222222222222";

struct Gh {
    dir: tempfile::TempDir,
}

impl Gh {
    fn new(url: &str, head: &str, checks: &str, checks_code: i32) -> Self {
        let dir = tempfile::tempdir().unwrap();
        let gh = dir.path().join("gh");
        std::fs::write(
            &gh,
            r#"#!/bin/sh
d=$(dirname "$0")
case "$1 $2" in
"pr view")
  n=$(cat "$d/views" 2>/dev/null || echo 0); echo $((n+1)) > "$d/views"
  [ -f "$d/view.code" ] && exit $(cat "$d/view.code")
  f="$d/view$((n+1)).json"; [ -f "$f" ] || f="$d/view.json"
  cat "$f" ;;
"pr checks")
  [ -f "$d/sleep" ] && sleep 30
  cat "$d/checks.json"; exit $(cat "$d/checks.code") ;;
esac
"#,
        )
        .unwrap();
        std::fs::set_permissions(&gh, std::fs::Permissions::from_mode(0o755)).unwrap();
        let this = Self { dir };
        this.put("view.json", &view(url, head));
        this.put("checks.json", checks);
        this.put("checks.code", &checks_code.to_string());
        this
    }
    fn put(&self, name: &str, body: &str) {
        std::fs::write(self.dir.path().join(name), body).unwrap();
    }
    fn gh(&self) -> PathBuf {
        self.dir.path().join("gh")
    }
    fn read(&self) -> Evidence {
        read(&self.gh(), self.dir.path(), Duration::from_secs(5))
    }
}

fn view(url: &str, head: &str) -> String {
    let number = url.rsplit('/').next().unwrap();
    format!(r#"{{"number":{number},"headRefOid":"{head}","url":"{url}"}}"#)
}

const URL: &str = "https://github.com/acme/widgets/pull/42";
const PASS: &str = r#"[{"name":"check","bucket":"pass"},{"name":"rules","bucket":"pass"}]"#;

fn gap(evidence: Evidence) -> Gap {
    match evidence {
        Evidence::Incomplete(gap) => gap,
        Evidence::Complete(facts) => panic!("reported complete: {facts:?}"),
    }
}

#[test]
fn nr10_complete_success_binds_identity_and_head() {
    let Evidence::Complete(facts) = Gh::new(URL, HEAD, PASS, 0).read() else {
        panic!("complete success was not complete");
    };
    assert_eq!(
        (
            facts.host.as_str(),
            facts.repository.as_str(),
            facts.number,
            facts.head.as_str()
        ),
        ("github.com", "acme/widgets", 42, HEAD)
    );
    assert!(facts.passing() && facts.read_at > 0);
    assert_eq!(facts.checks.len(), 2);
}

#[test]
fn nr10_pending_failed_and_empty_are_distinct() {
    let pending = r#"[{"name":"check","bucket":"pass"},{"name":"rules","bucket":"pending"}]"#;
    assert_eq!(gap(Gh::new(URL, HEAD, pending, 8).read()), Gap::Pending);
    assert_eq!(
        gap(Gh::new(URL, HEAD, "[]", 1).read()),
        Gap::NoRequiredChecks
    );
    let failed = r#"[{"name":"check","bucket":"fail"},{"name":"rules","bucket":"pass"}]"#;
    let Evidence::Complete(facts) = Gh::new(URL, HEAD, failed, 1).read() else {
        panic!("a concluded failure is complete evidence");
    };
    assert!(!facts.passing());
    assert_eq!(facts.checks[0].conclusion, Conclusion::Failed);
}

#[test]
fn nr10_unknown_bucket_and_bad_json_never_pass() {
    let odd = r#"[{"name":"check","bucket":"mystery"}]"#;
    assert_eq!(gap(Gh::new(URL, HEAD, odd, 0).read()), Gap::ReadFailed);
    assert_eq!(
        gap(Gh::new(URL, HEAD, "not json", 0).read()),
        Gap::ReadFailed
    );
    assert_eq!(gap(Gh::new(URL, HEAD, PASS, 2).read()), Gap::ReadFailed);
}

#[test]
fn nr10_unavailable_gh_is_not_passing() {
    let gh = Gh::new(URL, HEAD, PASS, 0);
    gh.put("view.code", "4");
    assert_eq!(gap(gh.read()), Gap::NotLoggedIn);
    let missing = read(
        Path::new("/nonexistent/gh"),
        gh.dir.path(),
        Duration::from_secs(1),
    );
    assert_eq!(gap(missing), Gap::GhMissing);
    let plain = gh.dir.path().join("plain");
    std::fs::write(&plain, "x").unwrap();
    assert_eq!(
        gap(read(&plain, gh.dir.path(), Duration::from_secs(1))),
        Gap::Refused
    );
}

#[test]
fn nr10_timeout_is_not_passing() {
    let gh = Gh::new(URL, HEAD, PASS, 0);
    gh.put("sleep", "");
    let started = std::time::Instant::now();
    let out = read(&gh.gh(), gh.dir.path(), Duration::from_millis(300));
    assert_eq!(gap(out), Gap::TimedOut);
    assert!(started.elapsed() < Duration::from_secs(5));
}

#[test]
fn nr10_changed_head_is_stale() {
    let gh = Gh::new(URL, HEAD, PASS, 0);
    gh.put("view2.json", &view(URL, MOVED));
    assert_eq!(gap(gh.read()), Gap::StaleHead);
}

#[test]
fn nr10_non_github_remote_is_unavailable() {
    let gh = Gh::new(URL, HEAD, PASS, 0);
    gh.put("view.code", "1");
    let git = |args: &[&str]| {
        assert!(
            std::process::Command::new("git")
                .current_dir(gh.dir.path())
                .args(args)
                .status()
                .unwrap()
                .success()
        );
    };
    git(&["init", "-q"]);
    git(&[
        "remote",
        "add",
        "origin",
        "git@gitlab.example.com:acme/widgets.git",
    ]);
    assert_eq!(gap(gh.read()), Gap::NonGithubRemote);
}

#[test]
fn nr10_same_pr_number_in_two_repositories_stays_distinct() {
    let a = Gh::new("https://github.com/acme/widgets/pull/42", HEAD, PASS, 0).read();
    let b = Gh::new("https://github.com/acme/gadgets/pull/42", HEAD, PASS, 0).read();
    let (Evidence::Complete(a), Evidence::Complete(b)) = (a, b) else {
        panic!("both complete");
    };
    assert_eq!((a.number, b.number), (42, 42));
    assert_ne!((&a.host, &a.repository), (&b.host, &b.repository));
}
