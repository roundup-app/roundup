//! RB1 to RB8 (`scenarios/readback.md`): a fresh model reads the diff. A fake `claude` records the
//! stdin of each one-shot launch and answers from `reply<n>` files.

use std::path::{Path, PathBuf};
use std::time::Duration;

use agents::worktree::Git;
use serde_json::{Value, json};

use crate::common::Fixture;

const SCRIPT: &str = r#"D=$(dirname "$0")
case "$*" in
*--json-schema*)
  n=$(ls "$D"/launch.* 2>/dev/null | wc -l)
  cat > "$D/launch.$n"
  [ -f "$D/slow" ] && sleep 2
  cat "$D/reply$n" ;;
*) touch "$D/ready"; sleep 30 ;;
esac"#;

fn git(dir: &Path, args: &[&str]) {
    let status = std::process::Command::new("git")
        .current_dir(dir)
        .args(args)
        .status()
        .unwrap();
    assert!(status.success(), "git {args:?}");
}

fn write(dir: &Path, name: &str, text: &str) {
    std::fs::write(dir.join(name), text).unwrap();
}

fn answer(text: &str) -> String {
    json!({"structured_output": {"text": text}}).to_string()
}

/// The first step's answer: one flow holding `a.rs#1`, so `seed.txt#1` is unplaced.
fn account() -> String {
    with(|_| {})
}

/// `account()` after `edit` changed its JSON.
fn with(edit: impl FnOnce(&mut Value)) -> String {
    let mut value = json!({"overview": "It adds a.rs.", "diagram": "a -> b", "modules": [{"module": "m", "account": "x"}],
        "flows": [{"id": "f", "name": "Add", "steps": [{"note": "adds", "hunks": ["a.rs#1"]}]}],
        "ranks": [{"hunk": "a.rs#1", "rank": "core"}, {"hunk": "seed.txt#1", "rank": "glue"}],
        "risks": [{"target": "flow", "id": "f", "level": "high", "reason": "It changes what the rail counts."},
            {"target": "module", "id": "m", "level": "low", "reason": "A small addition."}]});
    edit(&mut value);
    value.to_string()
}

fn gaps(found: Value) -> String {
    json!({"gaps": found}).to_string()
}

struct Rb {
    f: Fixture,
    id: String,
    path: PathBuf,
    _origin: tempfile::TempDir,
}

/// An Agent in a Worktree of its own, whose diff is a new `a.rs` and a changed `seed.txt`; the
/// fake answers launch `n` with `replies[n]`.
async fn rb(replies: &[String]) -> Rb {
    let f = Fixture::in_git_project(SCRIPT, Git::from_env());
    write(f.dir.path(), "seed.txt", "a\nb\n");
    git(f.dir.path(), &["add", "-A"]);
    git(f.dir.path(), &["commit", "-q", "-m", "seed"]);
    let origin = tempfile::tempdir().unwrap();
    git(origin.path(), &["init", "-q", "--bare", "-b", "main"]);
    let url = origin.path().display().to_string();
    git(f.dir.path(), &["remote", "add", "origin", &url]);
    git(f.dir.path(), &["push", "-q", "origin", "main"]);
    git(f.dir.path(), &["fetch", "-q", "origin"]);
    git(f.dir.path(), &["remote", "set-head", "origin", "main"]);
    f.call("project.setWorktrees", json!({"on": true, "check": null}))
        .await
        .unwrap();
    for (n, reply) in replies.iter().enumerate() {
        write(f.dir.path(), &format!("reply{n}"), reply);
    }
    let node = f.spawn(None, None).await.unwrap();
    let path: PathBuf = node.worktree().expect("a Worktree").path.into();
    write(&path, "a.rs", "fn a() {}\nfn b() {}\n");
    write(&path, "seed.txt", "a\nchanged\n");
    Rb {
        f,
        id: node.base.id,
        path,
        _origin: origin,
    }
}

impl Rb {
    async fn start(&self) -> Value {
        self.f
            .call("agent.readbackStart", json!({"id": self.id}))
            .await
            .unwrap()
    }
    async fn state(&self) -> Value {
        self.f
            .call("agent.readback", json!({"id": self.id}))
            .await
            .unwrap()
    }
    /// The state once the run has left `reading`.
    async fn settled(&self) -> Value {
        let mut tick = tokio::time::interval(Duration::from_millis(50));
        for _ in 0..200 {
            tick.tick().await;
            let state = self.state().await;
            if state["state"] != "reading" {
                return state;
            }
        }
        panic!("the readback never settled");
    }
    fn launches(&self) -> Vec<String> {
        (0..)
            .map_while(|n| {
                std::fs::read_to_string(self.f.dir.path().join(format!("launch.{n}"))).ok()
            })
            .collect()
    }
    async fn stop(&self, message: &str) {
        let attempt = self.f.attempt(&self.id).await;
        let payload = json!({"hook_event_name": "Stop", "last_assistant_message": message});
        let params = json!({"id": self.id, "attempt": attempt, "payload": payload});
        self.f.call("agent.signal", params).await.unwrap();
    }
}

fn input(launch: &str) -> Value {
    serde_json::from_str(launch).unwrap_or_else(|_| json!({"raw": launch}))
}

#[tokio::test]
async fn rb1_the_input_is_the_hunks_the_flows_and_the_last_message_only() {
    let r = rb(&[answer(&account()), answer(&gaps(json!([])))]).await;
    r.stop("MARKER-EARLIER turn").await;
    r.stop("I only added a.rs").await;

    assert_eq!(r.start().await["state"], "reading");
    r.settled().await;

    let launches = r.launches();
    let one = input(&launches[0]);
    let ids: Vec<&str> = one["hunks"]
        .as_array()
        .unwrap()
        .iter()
        .map(|h| h["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, ["a.rs#1", "seed.txt#1"]);
    assert_eq!(one["hunks"][0]["path"], "a.rs");
    assert_eq!(one["flows"], json!([]));
    let two = input(&launches[1]);
    assert_eq!(two["last_message"], "I only added a.rs");
    assert_eq!(two["account"]["overview"], "It adds a.rs.");
    assert!(
        launches
            .iter()
            .all(|launch| !launch.contains("MARKER-EARLIER"))
    );
    assert!(!launches[0].contains("I only added a.rs"));
}

#[tokio::test]
async fn rb2_only_the_start_method_launches_the_call() {
    let r = rb(&[answer(&account())]).await;
    r.stop("done").await;
    write(&r.path, "later.rs", "x\n");
    for method in ["agent.changedFiles", "agent.callPaths", "agent.readback"] {
        r.f.call(method, json!({"id": r.id})).await.unwrap();
    }
    r.f.call("agent.compareFile", json!({"id": r.id, "path": "a.rs"}))
        .await
        .unwrap();
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert!(r.launches().is_empty());
}

#[tokio::test]
async fn rb2_a_second_start_joins_the_run_in_flight() {
    let r = rb(&[answer(&account())]).await;
    write(r.f.dir.path(), "slow", "");
    assert_eq!(r.start().await["state"], "reading");
    assert_eq!(r.start().await["state"], "reading");
    assert_eq!(r.settled().await["state"], "read");
    assert_eq!(r.launches().len(), 1);
}

#[tokio::test]
async fn rb2_a_shared_checkout_has_no_readback() {
    let f = Fixture::in_git_project(SCRIPT, Git::from_env());
    let node = f.spawn(None, None).await.unwrap();
    let err = f
        .call("agent.readbackStart", json!({"id": node.base.id}))
        .await
        .unwrap_err();
    assert!(err.message.contains("no_worktree"), "{}", err.message);
}

#[tokio::test]
async fn rb3_a_read_run_answers_the_fixed_shape_and_computes_unplaced() {
    let r = rb(&[answer(&account())]).await;
    r.start().await;
    let state = r.settled().await;
    assert_eq!(state["state"], "read");
    assert_eq!(state["overview"], "It adds a.rs.");
    assert_eq!(state["flows"][0]["source"], "readback");
    assert_eq!(state["flows"][0]["steps"][0]["hunks"], json!(["a.rs#1"]));
    assert_eq!(state["unplaced"], json!(["seed.txt#1"]));
    assert_eq!(state["gaps"], json!([]));
}

#[tokio::test]
async fn rb3_a_malformed_answer_fails_with_its_cause() {
    let r = rb(&[answer("not a readback")]).await;
    r.start().await;
    let state = r.settled().await;
    assert_eq!(state["state"], "failed");
    assert_eq!(state["kind"], "badAnswer");
    assert!(state["cause"].as_str().unwrap().contains("not a readback"));
}

#[tokio::test]
async fn rb3_an_unknown_hunk_id_fails_the_run() {
    let bad = account().replace("a.rs#1", "nowhere.rs#9");
    let r = rb(&[answer(&bad)]).await;
    r.start().await;
    let state = r.settled().await;
    assert_eq!(state["kind"], "badAnswer");
    assert!(state["cause"].as_str().unwrap().contains("nowhere.rs#9"));
}

#[tokio::test]
async fn rb4_a_gap_carries_the_agents_words_and_a_quote_the_diff_holds() {
    let found = json!([{"path": "seed.txt", "said": "I left seed.txt alone", "quote": "changed"}]);
    let r = rb(&[answer(&account()), answer(&gaps(found))]).await;
    r.stop("I left seed.txt alone").await;
    r.start().await;
    let state = r.settled().await;
    assert_eq!(
        state["gaps"],
        json!([{"path": "seed.txt", "said": "I left seed.txt alone", "quote": "changed", "line": 2}])
    );
}

#[tokio::test]
async fn rb4_a_gap_the_diff_does_not_hold_is_dropped() {
    let found = json!([
        {"path": "seed.txt", "said": "s", "quote": "never written"},
        {"path": "other.rs", "said": "s", "quote": "fn a"},
    ]);
    let r = rb(&[answer(&account()), answer(&gaps(found))]).await;
    r.stop("said something").await;
    r.start().await;
    assert_eq!(r.settled().await["gaps"], json!([]));
}

#[tokio::test]
async fn rb4_without_a_last_message_there_are_no_gaps() {
    let r = rb(&[answer(&account())]).await;
    r.stop("").await;
    r.start().await;
    assert_eq!(r.settled().await["gaps"], json!([]));
    assert_eq!(r.launches().len(), 1);
}

#[tokio::test]
async fn rb4_a_failed_comparison_keeps_the_account() {
    let r = rb(&[answer(&account())]).await;
    r.stop("said something").await;
    r.start().await;
    let state = r.settled().await;
    assert_eq!(state["state"], "read");
    assert_eq!(state["overview"], "It adds a.rs.");
    assert!(
        state["gaps"]["failed"]
            .as_str()
            .is_some_and(|cause| !cause.is_empty())
    );
}

#[tokio::test]
async fn rb5_states_run_not_read_reading_read_and_failed_retries() {
    let r = rb(&[answer("nope"), answer(&account())]).await;
    write(r.f.dir.path(), "slow", "");
    assert_eq!(r.state().await["state"], "notRead");
    assert_eq!(r.start().await["state"], "reading");
    assert_eq!(r.state().await["state"], "reading");
    r.f.call("agent.changedFiles", json!({"id": r.id}))
        .await
        .unwrap();
    assert_eq!(r.settled().await["state"], "failed");
    assert_eq!(r.start().await["state"], "reading");
    assert_eq!(r.settled().await["state"], "read");
}

#[tokio::test]
async fn rb5_a_failure_cause_carries_no_usage_figure() {
    let usage = json!({"usage": {"input_tokens": 41234}, "total_cost_usd": 0.4321}).to_string();
    let r = rb(&[usage]).await;
    r.start().await;
    let state = r.settled().await;
    assert_eq!(state["kind"], "call");
    let cause = state["cause"].as_str().unwrap();
    assert!(
        !cause.contains("41234") && !cause.contains("0.4321"),
        "{cause}"
    );
}

#[tokio::test]
async fn rb6_an_agent_with_no_stop_has_no_last_message() {
    let r = rb(&[answer(&account())]).await;
    r.start().await;
    r.settled().await;
    assert_eq!(r.launches().len(), 1);
}

#[tokio::test]
async fn rb7_a_write_to_the_diff_makes_the_result_stale() {
    let r = rb(&[answer(&account())]).await;
    r.start().await;
    assert_eq!(r.settled().await["state"], "read");
    write(&r.path, "a.rs", "fn a() {}\nfn c() {}\n");
    let state = r.state().await;
    assert_eq!(state["state"], "stale");
    assert_eq!(state["overview"], "It adds a.rs.");
}

#[tokio::test]
async fn rb7_a_write_outside_the_diff_or_with_same_bytes_leaves_it_read() {
    let r = rb(&[answer(&account())]).await;
    r.start().await;
    r.settled().await;
    write(&r.path, "a.rs", "fn a() {}\nfn b() {}\n");
    write(&r.path, ".roundup/note.txt", "x\n");
    assert_eq!(r.state().await["state"], "read");
}

#[tokio::test]
async fn rb7_closing_the_view_does_not_cancel_the_run() {
    let r = rb(&[answer(&account())]).await;
    write(r.f.dir.path(), "slow", "");
    r.start().await;
    write(&r.path, "a.rs", "fn a() {}\nfn c() {}\n");
    tokio::time::sleep(Duration::from_millis(2600)).await;
    // The run read the diff as it was at the start, so the later write makes it stale.
    assert_eq!(r.state().await["state"], "stale");
    assert_eq!(r.state().await["state"], "stale");
}

#[tokio::test]
async fn rb8_a_diff_over_the_cap_fails_naming_the_cap_and_launches_nothing() {
    let r = rb(&[answer(&account())]).await;
    write(&r.path, "big.txt", &"x".repeat(300 * 1024));
    let state = r.start().await;
    assert_eq!(state["kind"], "tooLarge");
    assert!(state["cause"].as_str().unwrap().contains("256 KiB"));
    std::fs::remove_file(r.path.join("big.txt")).unwrap();
    for n in 0..399 {
        write(&r.path, &format!("f{n}.txt"), "x\n");
    }
    let state = r.start().await;
    assert_eq!(state["kind"], "tooLarge");
    assert!(state["cause"].as_str().unwrap().contains("400 hunks"));
    assert_eq!(r.state().await["state"], "failed");
    assert!(r.launches().is_empty());
}

#[tokio::test]
async fn rb8_a_diff_under_the_cap_is_sent_whole() {
    let r = rb(&[answer(&account())]).await;
    for n in 0..398 {
        write(&r.path, &format!("f{n}.txt"), "x\n");
    }
    assert_eq!(r.start().await["state"], "reading");
    r.settled().await;
    let one = input(&r.launches()[0]);
    assert_eq!(one["hunks"].as_array().unwrap().len(), 400);
}

async fn refused(reply: String) -> String {
    let r = rb(&[answer(&reply)]).await;
    r.start().await;
    let state = r.settled().await;
    assert_eq!(state["state"], "failed");
    assert_eq!(state["kind"], "badAnswer");
    assert!(state.get("ranks").is_none());
    state["cause"].as_str().unwrap().to_owned()
}

#[tokio::test]
async fn rb10_a_read_run_carries_a_rank_for_every_hunk() {
    let r = rb(&[answer(&account())]).await;
    r.start().await;
    let state = r.settled().await;
    assert_eq!(
        state["ranks"],
        json!([{"hunk": "a.rs#1", "rank": "core"}, {"hunk": "seed.txt#1", "rank": "glue"}])
    );
}

#[tokio::test]
async fn rb10_a_missing_or_unknown_rank_is_refused_with_its_cause() {
    let cause = refused(with(|v| {
        v["ranks"].as_array_mut().unwrap().pop();
    }))
    .await;
    assert!(cause.contains("seed.txt#1"), "{cause}");
    let cause = refused(with(|v| v["ranks"][1]["rank"] = json!("tiny"))).await;
    assert!(
        cause.contains("seed.txt#1") && cause.contains("tiny"),
        "{cause}"
    );
    let cause = refused(with(|v| {
        v["ranks"]
            .as_array_mut()
            .unwrap()
            .push(json!({"hunk": "a.rs#1", "rank": "glue"}));
    }))
    .await;
    assert!(cause.contains("a.rs#1"), "{cause}");
    let cause = refused(with(|v| {
        v["ranks"]
            .as_array_mut()
            .unwrap()
            .push(json!({"hunk": "no.rs#1", "rank": "glue"}));
    }))
    .await;
    assert!(cause.contains("no.rs#1"), "{cause}");
}

#[tokio::test]
async fn rb10_ranks_leave_the_flows_and_unplaced_as_they_were() {
    let r = rb(&[answer(&with(|v| v["ranks"][0]["rank"] = json!("glue")))]).await;
    r.start().await;
    let state = r.settled().await;
    assert_eq!(state["flows"][0]["steps"][0]["hunks"], json!(["a.rs#1"]));
    assert_eq!(state["unplaced"], json!(["seed.txt#1"]));
}

#[tokio::test]
async fn rb11_a_read_run_carries_a_risk_and_reason_for_each_flow_and_module() {
    let r = rb(&[answer(&account())]).await;
    r.start().await;
    let state = r.settled().await;
    assert_eq!(
        state["risks"],
        json!([
            {"target": "flow", "id": "f", "level": "high", "reason": "It changes what the rail counts."},
            {"target": "module", "id": "m", "level": "low", "reason": "A small addition."}
        ])
    );
}

#[tokio::test]
async fn rb11_a_missing_or_unknown_risk_is_refused_with_its_cause() {
    let cause = refused(with(|v| {
        v["risks"].as_array_mut().unwrap().pop();
    }))
    .await;
    assert!(cause.contains("module m"), "{cause}");
    let cause = refused(with(|v| v["risks"][0]["level"] = json!("severe"))).await;
    assert!(cause.contains("severe"), "{cause}");
    let cause = refused(with(|v| v["risks"][0]["reason"] = json!(" "))).await;
    assert!(cause.contains("flow f"), "{cause}");
    let cause = refused(with(|v| v["risks"][0]["id"] = json!("ghost"))).await;
    assert!(cause.contains("ghost"), "{cause}");
    let cause = refused(with(|v| {
        let again = v["risks"][0].clone();
        v["risks"].as_array_mut().unwrap().push(again);
    }))
    .await;
    assert!(cause.contains("two risks"), "{cause}");
}

#[tokio::test]
async fn rb11_a_risk_carries_no_number_and_no_usage_figure() {
    let r = rb(&[answer(&account())]).await;
    r.start().await;
    let state = r.settled().await;
    for risk in state["risks"].as_array().unwrap() {
        assert_eq!(risk.as_object().unwrap().len(), 4);
        assert!(risk["level"].is_string());
    }
    let usage = json!({"usage": {"input_tokens": 41234}, "total_cost_usd": 0.4321}).to_string();
    let r = rb(&[usage]).await;
    r.start().await;
    let cause = r.settled().await["cause"].to_string();
    assert!(
        !cause.contains("41234") && !cause.contains("0.4321"),
        "{cause}"
    );
}

#[tokio::test]
async fn rb11_the_daemon_derives_no_risk_from_a_path_or_size() {
    let r = rb(&[answer(&with(|v| {
        v["risks"][0]["level"] = json!("low");
        v["risks"][1]["level"] = json!("medium");
        v["ranks"]
            .as_array_mut()
            .unwrap()
            .push(json!({"hunk": "tests_big.rs#1", "rank": "glue"}));
    }))])
    .await;
    write(&r.path, "tests_big.rs", &"fn t() {}\n".repeat(400));
    r.start().await;
    let state = r.settled().await;
    let levels: Vec<_> = state["risks"]
        .as_array()
        .unwrap()
        .iter()
        .map(|x| x["level"].clone())
        .collect();
    assert_eq!(levels, [json!("low"), json!("medium")]);
}

#[tokio::test]
async fn rb12_ranks_and_risks_stay_with_a_stale_result_and_start_no_call() {
    let r = rb(&[answer(&account())]).await;
    r.start().await;
    r.settled().await;
    write(&r.path, "a.rs", "fn a() {}\nfn c() {}\n");
    let state = r.state().await;
    assert_eq!(state["state"], "stale");
    assert_eq!(state["ranks"][0]["rank"], "core");
    assert_eq!(state["risks"][0]["level"], "high");
    r.state().await;
    assert_eq!(r.launches().len(), 1);
}
