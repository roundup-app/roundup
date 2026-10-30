//! B22, B23: the caps on pushed digests and what survives a restart. `top` is a Door that is
//! `working`, so every push to it waits as `pending`. The clock is fake.

use std::sync::atomic::{AtomicBool, AtomicI64, AtomicUsize, Ordering};

use contracts::agent::DigestEntry;
use serde_json::{Value, json};

use super::b_hop_tests::tree;
use super::*;
use super::{FakeRail, agent};

struct Pushes {
    messages: Arc<Messages>,
    bus: Bus,
    rail: Arc<FakeRail>,
    clock: Arc<AtomicI64>,
    touches: Arc<provenance::Touches>,
    attempts: Arc<AtomicUsize>,
    refuse: Arc<AtomicBool>,
    dir: std::path::PathBuf,
}

fn entry(name: &str, todos: u32) -> DigestEntry {
    DigestEntry {
        name: name.into(),
        kind: Kind::Working,
        last: "x".into(),
        todos,
        pads: vec![],
    }
}

impl Pushes {
    fn new(dir: &Path) -> Self {
        Self::over(dir, FakeRail::new(tree()), Arc::default())
    }

    fn over(dir: &Path, rail: Arc<FakeRail>, clock: Arc<AtomicI64>) -> Self {
        for node in rail.0.lock().unwrap().iter_mut() {
            node.terminal_id = Some(format!("terminal-{}", node.id));
        }
        let bus = Bus::new();
        let touches = Arc::new(provenance::Touches::in_memory().unwrap());
        let reads = Arc::clone(&clock);
        let attempts = Arc::new(AtomicUsize::new(0));
        let refuse = Arc::new(AtomicBool::new(false));
        let sends = Arc::clone(&attempts);
        let refusals = Arc::clone(&refuse);
        let env = Env {
            touches: Arc::clone(&touches),
            clock: Arc::new(move || reads.load(Ordering::SeqCst)),
            fault: Arc::new(move |op| {
                if op == "push" {
                    sends.fetch_add(1, Ordering::SeqCst);
                    if refusals.load(Ordering::SeqCst) {
                        return Err("injected Digest refusal".into());
                    }
                }
                Ok(())
            }),
        };
        let agents: Arc<dyn TerminalOwners> = rail.clone();
        let messages = Arc::new(Messages::open_with(dir, bus.clone(), agents, env).unwrap());
        Self {
            messages,
            bus,
            rail,
            clock,
            touches,
            attempts,
            refuse,
            dir: dir.to_path_buf(),
        }
    }

    fn restarted(self) -> Self {
        let Self {
            rail, clock, dir, ..
        } = self;
        Self::over(&dir, rail, clock)
    }

    async fn call_as(&self, actor: Actor, method: &str, p: Value) -> Result<Value, RpcError> {
        let ctx = Ctx {
            actor,
            bus: self.bus.clone(),
            touches: Arc::clone(&self.touches),
        };
        self.messages.call(&ctx, method, p).await
    }

    async fn push(&self, entry: &DigestEntry) {
        self.messages.push_digest("top", &entry.name, entry).await;
    }

    /// The Daemon's clock reads `ms`, and the window's end is acted on.
    async fn at(&self, ms: i64) {
        self.clock.store(ms, Ordering::SeqCst);
        pushes::flush(&self.messages.inner).await;
    }

    async fn all(&self) -> Vec<Message> {
        let all = self
            .call_as(Actor::user(), "message.list", json!({}))
            .await
            .unwrap();
        serde_json::from_value(all).unwrap()
    }

    /// The bodies of the pushed digests to `top` that still stand: not `dropped`.
    async fn standing(&self) -> Vec<Message> {
        self.all()
            .await
            .into_iter()
            .filter(|m| pushes::is_digest(&m.from, &m.body) && m.status != MessageStatus::Dropped)
            .collect()
    }
}

#[tokio::test]
async fn b22_the_ninth_push_in_a_window_waits_and_leaves_at_its_end_as_one_rollup() {
    let dir = tempfile::tempdir().unwrap();
    let h = Pushes::new(dir.path());
    for n in 0..11 {
        h.at(n).await;
        h.push(&entry(&format!("c{n}"), n as u32)).await;
    }
    assert_eq!(h.standing().await.len(), 11 - 3);

    h.at(59_999).await;
    assert_eq!(
        h.standing().await.len(),
        8,
        "the first push is 59 999 ms old"
    );
    h.at(60_000).await;
    let standing = h.standing().await;
    assert_eq!(standing.len(), 9);
    let rollup = &standing[8];
    assert!(
        rollup.body.starts_with("[digest] [3 updates kept back]\n"),
        "{}",
        rollup.body
    );
    // The newest change first: c10, then c9, then c8.
    let lines = pushes::entries_of(&rollup.body);
    assert_eq!(
        lines
            .iter()
            .map(|e| (e.name.as_str(), e.todos))
            .collect::<Vec<_>>(),
        [("c10", 10), ("c9", 9), ("c8", 8)]
    );
    assert_eq!(rollup.from, Actor::daemon());
    assert_eq!(rollup.kind, MessageKind::Note);
}

#[tokio::test]
async fn b22_a_rollup_names_eight_children_and_the_rest_in_one_line_cut_at_512_bytes() {
    let dir = tempfile::tempdir().unwrap();
    let h = Pushes::new(dir.path());
    for n in 0..8 {
        h.push(&entry("early", n)).await;
    }
    for n in 0..30 {
        h.push(&entry(&format!("child-{n}-{}", "w".repeat(30)), 0))
            .await;
    }
    h.at(60_000).await;
    let rollup = h.standing().await.pop().unwrap().body;
    assert!(rollup.starts_with("[digest] [30 updates kept back]\n"));
    assert!(rollup.len() <= 4096, "{}", rollup.len());
    let lines: Vec<&str> = rollup.lines().collect();
    let kept = pushes::entries_of(&rollup);
    assert_eq!(kept.len(), 8);
    // Newest change first: the last child pushed leads.
    assert!(kept[0].name.starts_with("child-29-"));
    let more = lines[lines.len() - 1];
    assert!(more.starts_with("[+22 more: child-21-"), "{more}");
    assert!(more.len() <= 512 && more.ends_with("[cut]"), "{more}");
}

#[tokio::test]
async fn b22_the_twenty_first_open_digest_merges_the_oldest_two() {
    let dir = tempfile::tempdir().unwrap();
    let h = Pushes::new(dir.path());
    for n in 0..21_u32 {
        h.at(i64::from(n / 8) * 60_000).await;
        h.push(&entry(&format!("c{}", n % 2 + 10 * (n / 2)), n))
            .await;
    }
    let all = h.all().await;
    let merged: Vec<_> = all
        .iter()
        .filter(|m| m.status == MessageStatus::Dropped)
        .collect();
    assert_eq!(merged.iter().map(|m| m.id).collect::<Vec<_>>(), [1, 2]);
    assert!(merged.iter().all(|m| m.reason == Some(Reason::Merged)));
    let standing = h.standing().await;
    assert_eq!(standing.len(), 20);
    let last = standing.last().unwrap();
    assert!(
        last.body
            .starts_with("[digest] [2 earlier updates: #1 #2]\n"),
        "{}",
        last.body
    );
    // The newest entry of each child the two named: #2 changed c1, #1 changed c0.
    assert_eq!(pushes::names_in(&last.body), ["c1", "c0"]);
    // `m` reads a Message that was merged away (P7).
    let got = h
        .call_as(agent("top"), "message.get", json!({"id": 1}))
        .await
        .unwrap();
    assert_eq!(got["reason"], "merged");
    assert_eq!(pushes::weight(&last.body), 2);
}

#[tokio::test]
async fn b22_a_merge_counts_the_changes_a_merged_digest_already_counted() {
    let dir = tempfile::tempdir().unwrap();
    let h = Pushes::new(dir.path());
    for n in 0..60_u32 {
        h.at(i64::from(n / 8) * 60_000).await;
        h.push(&entry(&format!("c{n}"), n)).await;
    }
    let standing = h.standing().await;
    assert_eq!(standing.len(), 20);
    assert_eq!(
        standing
            .iter()
            .map(|m| pushes::weight(&m.body))
            .sum::<u32>(),
        60
    );
    // A merge that is itself merged later weighs its own N.
    assert!(standing.iter().any(|m| pushes::weight(&m.body) >= 3));
}

#[tokio::test]
async fn b22_after_a_burst_of_100_changes_every_change_is_counted_once() {
    let dir = tempfile::tempdir().unwrap();
    let h = Pushes::new(dir.path());
    let mut changes = 0_u32;
    for round in 0..10_i64 {
        h.at(round * 20_000).await;
        for _ in 0..10_u32 {
            h.push(&entry(&format!("c{changes}"), changes)).await;
            changes += 1;
        }
    }
    h.at(10 * 60_000 + 1_000_000).await;
    h.at(2 * (10 * 60_000 + 1_000_000)).await;

    let all = h.all().await;
    let digests: Vec<&Message> = all
        .iter()
        .filter(|m| pushes::is_digest(&m.from, &m.body))
        .collect();
    let standing: Vec<&&Message> = digests
        .iter()
        .filter(|m| m.status != MessageStatus::Dropped)
        .collect();
    assert_eq!(changes, 100);
    assert_eq!(
        standing
            .iter()
            .map(|m| pushes::weight(&m.body))
            .sum::<u32>(),
        100
    );
    assert!(standing.len() <= 20);
    // Every digest is standing, or named by a merge, and `m` can open each.
    for dropped in digests
        .iter()
        .filter(|m| m.status == MessageStatus::Dropped)
    {
        assert_eq!(dropped.reason, Some(Reason::Merged));
        let tag = format!("#{}", dropped.id);
        assert!(
            digests
                .iter()
                .any(|m| m.body.lines().next().is_some_and(|l| l.contains(&tag))),
            "{} is named by no merge",
            dropped.id
        );
    }
    for message in &digests {
        h.call_as(agent("top"), "message.get", json!({"id": message.id}))
            .await
            .unwrap();
    }
}

#[tokio::test]
async fn b22_pushes_never_get_conflict_and_do_not_fill_the_bound_of_32() {
    let dir = tempfile::tempdir().unwrap();
    let h = Pushes::new(dir.path());
    for n in 0..32 {
        h.call_as(
            agent("c"),
            "message.send",
            json!({"to": "top", "kind": "note", "body": format!("hi {n}")}),
        )
        .await
        .unwrap();
    }
    let refused = h
        .call_as(
            agent("c"),
            "message.send",
            json!({"to": "top", "kind": "note", "body": "one more"}),
        )
        .await;
    assert_eq!(refused.unwrap_err().code, code::CONFLICT);

    for n in 0..8 {
        h.push(&entry(&format!("c{n}"), n)).await;
    }
    assert_eq!(h.standing().await.len(), 8);
    assert!(
        h.standing()
            .await
            .iter()
            .all(|m| m.status == MessageStatus::Pending)
    );
    // Twenty open digests do not make room for nor take from the Agents' 32.
    let again = h
        .call_as(
            agent("d"),
            "message.send",
            json!({"to": "top", "kind": "note", "body": "one more"}),
        )
        .await;
    assert_eq!(again.unwrap_err().code, code::CONFLICT);
}

#[tokio::test]
async fn b23_pending_pushes_and_a_rollup_survive_a_restart_and_the_window_starts_again() {
    let dir = tempfile::tempdir().unwrap();
    let h = Pushes::new(dir.path());
    for n in 0..11 {
        h.push(&entry(&format!("c{n}"), n)).await;
    }
    h.at(60_000).await;
    let before = h.standing().await;
    assert_eq!(before.len(), 9);

    let h = h.restarted();
    let after = h.standing().await;
    assert_eq!(
        after
            .iter()
            .map(|m| (m.id, m.body.clone(), m.status))
            .collect::<Vec<_>>(),
        before
            .iter()
            .map(|m| (m.id, m.body.clone(), m.status))
            .collect::<Vec<_>>()
    );
    assert_eq!(pushes::weight(&after[8].body), 3);

    // The same instant: the window is empty again, so eight pushes go out at once.
    for n in 0..8 {
        h.push(&entry(&format!("c{n}"), n)).await;
    }
    assert_eq!(
        h.all()
            .await
            .iter()
            .filter(|m| m.body.starts_with("[digest] c"))
            .count(),
        8 + 8
    );
}

fn no_json(body: &str) {
    for needle in [
        "{",
        "}",
        "\"name\"",
        "\"kind\"",
        "\"last\"",
        "\"todos\"",
        "\"pads\"",
    ] {
        assert!(!body.contains(needle), "{needle} in {body}");
    }
}

#[tokio::test]
async fn b33_a_push_a_rollup_and_a_merge_have_no_json() {
    let dir = tempfile::tempdir().unwrap();
    let h = Pushes::new(dir.path());
    let mut with_pads = entry("c0", 3);
    with_pads.pads = vec!["notes".into(), "plan".into()];
    h.push(&with_pads).await;
    for n in 1..12 {
        h.push(&entry(&format!("c{n}"), n)).await;
    }
    for n in 12..40 {
        h.at(i64::from((n - 4) / 8) * 60_000).await;
        h.push(&entry(&format!("c{n}"), n)).await;
    }
    let standing = h.standing().await;
    assert_eq!(
        h.all().await[0].body,
        "[digest] c0 is working\n  last: x\n  open todos: 3\n  pads: notes, plan"
    );
    assert!(
        standing
            .iter()
            .any(|m| m.body.contains(" updates kept back]\n"))
    );
    assert!(
        standing
            .iter()
            .any(|m| m.body.contains("earlier updates: #"))
    );
    for message in &standing {
        no_json(&message.body);
    }
}

#[tokio::test]
async fn b33_the_text_round_trips_through_weight_and_entries_of() {
    let mut entry = entry("a name with is in it", 7);
    entry.kind = Kind::NeedsYou;
    entry.last = "I filed #1077: https://x (Mode: specify)".into();
    entry.pads = vec!["one".into(), "[cut]".into()];
    let body = digest::push_body(&entry);
    assert_eq!(pushes::weight(&body), 1);
    assert_eq!(pushes::entries_of(&body), [entry.clone()]);
    let counted = pushes::counted(&body, 4);
    assert!(counted.ends_with("(4 changes)"));
    assert_eq!(pushes::weight(&counted), 4);
    assert_eq!(pushes::entries_of(&counted), [entry]);
}

async fn burst_of_100(same_children: bool) {
    let dir = tempfile::tempdir().unwrap();
    let h = Pushes::new(dir.path());
    let mut changes = 0_u32;
    for round in 0..10_i64 {
        h.at(round * 20_000).await;
        for _ in 0..10_u32 {
            let name = if same_children { changes % 4 } else { changes };
            h.push(&entry(&format!("c{name}"), changes)).await;
            changes += 1;
        }
    }
    h.at(10 * 60_000 + 1_000_000).await;
    h.at(2 * (10 * 60_000 + 1_000_000)).await;
    let standing = h.standing().await;
    assert_eq!(
        standing
            .iter()
            .map(|m| pushes::weight(&m.body))
            .sum::<u32>(),
        100
    );
    assert!(standing.len() <= 20);
}

#[tokio::test]
async fn b33_the_burst_of_100_keeps_every_count() {
    burst_of_100(false).await;
}

#[tokio::test]
async fn b34_folding_loses_no_count_in_a_burst_of_100_changes() {
    burst_of_100(true).await;
}

#[tokio::test]
async fn b34_two_pushes_of_one_child_are_one_entry_with_the_newest() {
    let dir = tempfile::tempdir().unwrap();
    let h = Pushes::new(dir.path());
    h.push(&entry("c", 1)).await;
    h.push(&entry("c", 2)).await;
    let all = h.all().await;
    assert_eq!(all[0].status, MessageStatus::Dropped);
    assert_eq!(all[0].reason, Some(Reason::Merged));
    assert_eq!(all[1].status, MessageStatus::Pending);
    assert!(all[1].body.ends_with("(2 changes)"), "{}", all[1].body);
    assert!(all[1].body.contains("open todos: 2"));
    let got = h
        .call_as(agent("top"), "message.get", json!({"id": 1}))
        .await
        .unwrap();
    assert_eq!(got["reason"], "merged");
    h.push(&entry("c", 3)).await;
    assert!(h.standing().await[0].body.ends_with("(3 changes)"));
}

#[tokio::test]
async fn b21_stopped_door_keeps_the_cap_waiting_weight_on_start() {
    let dir = tempfile::tempdir().unwrap();
    let h = Pushes::new(dir.path());
    for n in 0..9 {
        h.push(&entry(&format!("c{n}"), n)).await;
    }
    h.rail
        .0
        .lock()
        .unwrap()
        .iter_mut()
        .find(|n| n.id == "top")
        .unwrap()
        .status
        .as_mut()
        .unwrap()
        .kind = Kind::Done;
    h.at(60_000).await;
    h.rail
        .0
        .lock()
        .unwrap()
        .iter_mut()
        .find(|n| n.id == "top")
        .unwrap()
        .status
        .as_mut()
        .unwrap()
        .kind = Kind::Working;
    h.at(60_001).await;
    let standing = h.standing().await;
    let ninth: Vec<_> = standing
        .iter()
        .filter(|m| pushes::names_in(&m.body).contains(&"c8".into()))
        .collect();
    assert_eq!(
        ninth.len(),
        1,
        "the ninth entry was silently lost while its Door was stopped"
    );
    assert_eq!(pushes::weight(&ninth[0].body), 1);
}

fn door_terminal(h: &Pushes, terminal: Option<&str>) {
    h.rail
        .0
        .lock()
        .unwrap()
        .iter_mut()
        .find(|n| n.id == "top")
        .unwrap()
        .terminal_id = terminal.map(str::to_owned);
}

#[tokio::test]
async fn b21_stopped_changes_compact_by_subagent_and_keep_weight_after_failed_start() {
    let dir = tempfile::tempdir().unwrap();
    let h = Pushes::new(dir.path());
    door_terminal(&h, None);
    for n in 1..=100 {
        h.messages
            .push_digest("top", "stable-child", &entry(&format!("renamed-{n}"), n))
            .await;
        h.at(i64::from(n) * 60_000).await;
    }
    assert!(h.all().await.is_empty());
    // A failed start leaves the Terminal absent; even after the window there is no send.
    h.at(7_000_000).await;
    assert!(h.all().await.is_empty());
    let ledger = h.messages.inner.pushes.lock().await;
    assert_eq!(ledger.waiting_count("top"), 1);
    drop(ledger);
    assert_eq!(h.attempts.load(Ordering::SeqCst), 0);
    door_terminal(&h, Some("started"));
    h.at(7_000_001).await;
    let sent = h.standing().await;
    assert_eq!(sent.len(), 1);
    assert_eq!(pushes::weight(&sent[0].body), 100);
    assert_eq!(
        pushes::entries_of(&sent[0].body),
        [entry("renamed-100", 100)]
    );
}

#[tokio::test]
async fn b21_two_stopped_changes_release_one_newest_entry_of_weight_two() {
    let dir = tempfile::tempdir().unwrap();
    let h = Pushes::new(dir.path());
    door_terminal(&h, None);
    let nodes = h.rail.0.lock().unwrap().clone();
    let seen = digest::Seen::default();
    let mut todos = Vec::new();
    seen.baseline(&digest::Sources {
        touches: Vec::new(),
        nodes: &nodes,
        todos: &todos,
        pads: &[],
        messages: &[],
    });
    for id in 1..=2 {
        todos.push(contracts::todo::Todo {
            id,
            title: format!("Todo {id}"),
            body: String::new(),
            done: false,
            blockers: vec![],
            blocked: false,
            created_at: 0,
            updated_at: 0,
            creator: agent("d"),
            home: Some("top".into()),
            owner: None,
            refs: vec![],
            estimate_minutes: None,
        });
        let changes = seen.changed(&digest::Sources {
            touches: Vec::new(),
            nodes: &nodes,
            todos: &todos,
            pads: &[],
            messages: &[],
        });
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].entry.todos, id);
        h.messages
            .push_digest(&changes[0].meta, changes[0].subagent(), &changes[0].entry)
            .await;
    }
    h.at(60_000).await;
    assert!(h.all().await.is_empty());
    assert_eq!(h.attempts.load(Ordering::SeqCst), 0);
    door_terminal(&h, Some("started"));
    h.at(60_001).await;
    let sent = h.standing().await;
    assert_eq!(sent.len(), 1);
    assert_eq!(pushes::weight(&sent[0].body), 2);
    let mut newest = entry("d", 2);
    newest.last = "status".into();
    assert_eq!(pushes::entries_of(&sent[0].body), [newest]);
}

#[tokio::test]
async fn b21_removed_door_discards_unsent_entries_even_inside_the_cap_window() {
    let dir = tempfile::tempdir().unwrap();
    let h = Pushes::new(dir.path());
    for n in 0..9 {
        h.push(&entry(&format!("c{n}"), n)).await;
    }
    h.rail.0.lock().unwrap().retain(|n| n.id != "top");
    h.at(1).await;
    assert_eq!(h.messages.inner.pushes.lock().await.waiting_count("top"), 0);
    h.at(60_000).await;
    h.push(&entry("later", 1)).await;
    assert_eq!(h.all().await.len(), 8);
}

#[tokio::test]
async fn b21_live_door_refusal_keeps_entries_eligible_for_retry() {
    let dir = tempfile::tempdir().unwrap();
    let h = Pushes::new(dir.path());
    h.refuse.store(true, Ordering::SeqCst);
    h.push(&entry("c", 1)).await;
    assert!(h.all().await.is_empty());
    assert_eq!(h.attempts.load(Ordering::SeqCst), 1);
    h.refuse.store(false, Ordering::SeqCst);
    h.push(&entry("c", 2)).await;
    let sent = h.standing().await;
    assert_eq!(sent.len(), 1);
    assert_eq!(pushes::weight(&sent[0].body), 2);
    assert_eq!(pushes::entries_of(&sent[0].body), [entry("c", 2)]);
}

#[test]
fn b21_live_door_refusal_logs_receiver_and_cause() {
    let output = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "tests::b_push_tests::b21_live_door_refusal_keeps_entries_eligible_for_retry",
            "--nocapture",
        ])
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stdout)
    );
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        stderr.contains("push failed: top: injected Digest refusal"),
        "{stderr}"
    );
}

#[test]
fn b21_stopped_door_changes_log_no_refusal() {
    let output = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "tests::b_push_tests::b21_two_stopped_changes_release_one_newest_entry_of_weight_two",
            "--nocapture",
        ])
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stdout)
    );
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(!stderr.contains("push failed"), "{stderr}");
}

#[tokio::test]
async fn b21_same_named_subagents_keep_separate_waiting_entries() {
    let dir = tempfile::tempdir().unwrap();
    let h = Pushes::new(dir.path());
    door_terminal(&h, None);
    h.messages
        .push_digest("top", "first-id", &entry("same-name", 1))
        .await;
    h.messages
        .push_digest("top", "second-id", &entry("same-name", 2))
        .await;
    door_terminal(&h, Some("started"));
    h.at(1).await;
    let sent = h.standing().await;
    assert_eq!(sent.len(), 1);
    assert_eq!(pushes::weight(&sent[0].body), 2);
    assert_eq!(
        pushes::entries_of(&sent[0].body),
        [entry("same-name", 2), entry("same-name", 1)]
    );
}

fn end_entry(name: &str) -> DigestEntry {
    DigestEntry {
        name: name.into(),
        kind: Kind::Done,
        last: format!("{}[cut]", "s".repeat(595)),
        todos: 0,
        pads: vec![],
    }
}

#[tokio::test]
async fn b49_an_end_note_in_a_rollup_keeps_the_512_byte_entry() {
    let dir = tempfile::tempdir().unwrap();
    let h = Pushes::new(dir.path());
    // A lone end note is the plain push, with its 600-byte `last`.
    h.push(&end_entry("alone")).await;
    let plain = h.standing().await.pop().unwrap().body;
    assert_eq!(pushes::entries_of(&plain)[0].last.len(), 600);
    for n in 0..7 {
        h.push(&entry("early", n)).await;
    }
    h.push(&end_entry("ended")).await;
    h.at(60_000).await;
    let rollup = h.standing().await.pop().unwrap().body;
    assert!(
        rollup.starts_with("[digest] [1 updates kept back]\n"),
        "{rollup}"
    );
    let kept = pushes::entries_of(&rollup);
    assert_eq!(kept[0].name, "ended");
    assert!(kept[0].last.len() <= 120 && kept[0].last.ends_with("[cut]"));
    assert!(digest::entry_text(&kept[0]).len() <= 512);
}
