//! DTC4 and DTC5: one catch-up note per Door Stop, and a repeated report dropped. Real Daemon,
//! fake `claude`: the Door's transcript counts the turns and holds the notes.
use super::dtc3_one_turn::rupd_turns;
use super::*;

/// A Job of the Door, idle, and the client that speaks as it.
struct Job {
    id: String,
    client: Client,
}

impl Run {
    async fn as_door(&self) -> Client {
        let door = Client::connect(&self.daemon.socket).await.unwrap();
        door.request(
            "daemon.identify",
            json!({"actor":{"kind":"agent","id":self.door,"parent":null}}),
        )
        .await
        .unwrap();
        door
    }

    async fn spawn_job(&self, door: &Client, name: &str) -> Job {
        let id = door
            .request(
                "agent.spawn",
                json!({"name":name,"parent":self.door,"cwd":self.dir.path(),"role":"job",
                "prompt":"Do the one thing.",
                "order":{"kind":"work","ask":"Do the one thing.","limits":[]}}),
            )
            .await
            .unwrap()["id"]
            .as_str()
            .unwrap()
            .to_owned();
        let client = Client::connect(&self.daemon.socket).await.unwrap();
        client
            .request(
                "daemon.identify",
                json!({"actor":{"kind":"agent","id":id,"parent":self.door}}),
            )
            .await
            .unwrap();
        self.idle(&id, 2).await;
        Job { id, client }
    }

    /// The user's prompt starts a slow turn of the Door (4 s), which the case plays inside.
    async fn hold_turn(&self) {
        self.user
            .request(
                "message.send",
                json!({"to":self.door,"kind":"note","body":"Do the slow thing"}),
            )
            .await
            .unwrap();
        wait(|| {
            let tree = latest_snapshot(self.dir.path());
            tree.iter().any(|v| {
                v["nodes"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|n| n["id"] == self.door && n["status"]["kind"] == "working")
            })
        })
        .await;
    }

    /// The Job sends the Door a report, then ends.
    async fn report_and_end(&self, job: &Job, report: &str) {
        job.client
            .request(
                "message.send",
                json!({"to":self.door,"kind":"note","body":report}),
            )
            .await
            .unwrap();
        self.user
            .request("agent.stop", json!({"id":job.id}))
            .await
            .unwrap();
    }

    /// The turns a `rupd` note started after the first `before`, once `at_least` are written and
    /// the Door has answered them.
    async fn started_by_rupd(&self, before: usize, at_least: usize) -> Vec<Vec<String>> {
        wait(|| started(self).len() >= before + at_least).await;
        tokio::time::sleep(Duration::from_secs(3)).await;
        started(self).split_off(before)
    }

    /// No `rupd` note has started a turn for 5 s: the setup's own notes are all written.
    async fn calm(&self) {
        let mut seen = (started(self).len(), std::time::Instant::now());
        while seen.1.elapsed() < Duration::from_secs(5) {
            tokio::time::sleep(Duration::from_millis(250)).await;
            let now = started(self).len();
            if now != seen.0 {
                seen = (now, std::time::Instant::now());
            }
        }
    }

    /// The Job gives itself one open Todo, which keeps its end note to say something (DTC5(b)).
    async fn open_todo(&self, job: &Job) {
        job.client
            .request("todo.create", json!({"title":"left open"}))
            .await
            .unwrap();
    }
}

/// The Door's turns that a `rupd` note about its children started: those whose first entry is from `rupd`, not the
/// user's prompt that took the quiet notes along.
fn started(run: &Run) -> Vec<Vec<String>> {
    rupd_turns(run)
        .into_iter()
        .filter(|turn| turn[0].contains(r#"from-name=\"rupd\""#))
        // DCL6's settled note is its own turn and stays as it is.
        .filter(|turn| !turn[0].contains("[settled]"))
        .collect()
}

/// The `rupd` digests among `turn`'s entries.
fn digests(turn: &[String]) -> Vec<&String> {
    turn.iter().filter(|e| e.contains("[digest]")).collect()
}

#[tokio::test]
async fn dtc4_eight_reports_during_one_turn_cost_one_turn() {
    let run = Run::start_live().await;
    run.let_settled_pass().await;
    let door = run.as_door().await;
    let mut jobs = Vec::new();
    for n in 0..8 {
        let job = run.spawn_job(&door, &format!("job{n}")).await;
        run.open_todo(&job).await;
        jobs.push(job);
    }
    run.let_settled_pass().await;
    run.calm().await;
    let before = started(&run).len();
    run.hold_turn().await;
    for (n, job) in jobs.iter().enumerate() {
        run.report_and_end(job, &format!("report of job{n}")).await;
    }
    let turns = run.started_by_rupd(before, 1).await;
    assert_eq!(turns.len(), 1, "{turns:#?}");
    let notes = digests(&turns[0]);
    assert_eq!(notes.len(), 1, "one Message, one write: {notes:#?}");
    // The transcript shows a digest as one line (B50(d)); the Message holds the entries.
    let held = run.digests().await;
    let body = held
        .iter()
        .filter_map(|m| m["body"].as_str())
        .find(|body| (0..8).all(|n| body.contains(&format!("job{n} is done"))))
        .unwrap_or_else(|| panic!("no one Message holds an entry per Job: {held:#?}"));
    for n in 0..8 {
        let entry = format!("job{n} is done");
        assert_eq!(body.matches(&entry).count(), 1, "job{n} once: {body}");
    }
    assert!(
        !body.contains("last: report of"),
        "no summary the Door already holds: {body}"
    );
}

#[tokio::test]
async fn dtc4_a_waking_note_to_an_idle_door_is_written_within_2s() {
    let run = Run::start_live().await;
    run.let_settled_pass().await;
    let door = run.as_door().await;
    let job = run.spawn_job(&door, "job0").await;
    run.open_todo(&job).await;
    run.let_settled_pass().await;
    run.calm().await;
    let before = started(&run).len();
    run.report_and_end(&job, "report of job0").await;
    let at = std::time::Instant::now();
    wait(|| started(&run).len() > before).await;
    assert!(at.elapsed() < Duration::from_secs(2), "{:?}", at.elapsed());
}

/// The Door's turns after `before` that a `rupd` note started, with a Job that ended after one
/// report and `todos` open Todos, `error` or not.
async fn one_job(run: &Run, report: &str, todos: bool) -> Vec<Vec<String>> {
    let door = run.as_door().await;
    let job = run.spawn_job(&door, "job0").await;
    if todos {
        run.open_todo(&job).await;
    }
    run.let_settled_pass().await;
    run.calm().await;
    let before = started(run).len();
    run.report_and_end(&job, report).await;
    tokio::time::sleep(Duration::from_secs(6)).await;
    started(run).split_off(before)
}

/// The Door's conversation, whole.
fn door_transcript(run: &Run) -> String {
    std::fs::read_dir(run.dir.path().join("config/projects"))
        .into_iter()
        .flatten()
        .flatten()
        .flat_map(|p| std::fs::read_dir(p.path()).into_iter().flatten().flatten())
        .filter(|f| f.path().extension().is_some_and(|e| e == "jsonl"))
        .filter_map(|f| std::fs::read_to_string(f.path()).ok())
        .filter(|written| written.contains(DOOR_PROMPT))
        .collect()
}

fn all(turns: &[Vec<String>]) -> String {
    turns
        .iter()
        .flatten()
        .cloned()
        .collect::<Vec<_>>()
        .join("\n")
}

#[tokio::test]
async fn dtc5_an_end_note_repeating_a_sent_report_is_not_written() {
    let run = Run::start_live().await;
    run.let_settled_pass().await;
    let turns = one_job(&run, "report of job0", false).await;
    let seen = all(&turns);
    assert!(!seen.contains("last: report of job0"), "{seen}");
    assert!(!seen.contains("job0 is done"), "{seen}");
}

#[tokio::test]
async fn dtc5_a_repeated_report_keeps_the_open_todos_and_the_error() {
    let run = Run::start_live().await;
    run.let_settled_pass().await;
    let turns = one_job(&run, "report of job0", true).await;
    let seen = all(&turns);
    assert!(seen.contains("job0 is done"), "{seen}");
    assert!(seen.contains("open todos: 1"), "{seen}");
    assert!(!seen.contains("last: report of job0"), "{seen}");
}

#[tokio::test]
async fn dtc5_a_report_and_its_end_note_in_one_catch_up_show_once() {
    let run = Run::start_live().await;
    run.let_settled_pass().await;
    let door = run.as_door().await;
    let job = run.spawn_job(&door, "job0").await;
    run.open_todo(&job).await;
    run.let_settled_pass().await;
    run.calm().await;
    run.hold_turn().await;
    run.report_and_end(&job, "report of job0").await;
    wait(|| written(&run.dir.path().join("config"), "report of job0")).await;
    tokio::time::sleep(Duration::from_secs(8)).await;
    let seen = door_transcript(&run);
    assert_eq!(user_turns_with(&seen, "report of job0"), 1, "{seen}");
}

#[tokio::test]
async fn dtc5_an_unsent_or_changed_summary_is_still_carried() {
    let run = Run::start_live().await;
    run.let_settled_pass().await;
    let door = run.as_door().await;
    // No Message sent: B49(c).
    let quiet = run.spawn_job(&door, "silent").await;
    run.open_todo(&quiet).await;
    // A report over 600 bytes reaches the end note cut, so the end note is no repeat of it.
    let long = run.spawn_job(&door, "long").await;
    run.let_settled_pass().await;
    run.calm().await;
    let before = started(&run).len();
    run.user
        .request("agent.stop", json!({"id":quiet.id}))
        .await
        .unwrap();
    run.report_and_end(&long, &"x".repeat(900)).await;
    let seen = all(&run.started_by_rupd(before, 1).await);
    assert!(seen.contains("ended with no finding"), "{seen}");
    assert!(seen.contains("[cut]"), "{seen}");
}
