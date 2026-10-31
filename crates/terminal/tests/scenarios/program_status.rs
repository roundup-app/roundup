//! PS1–PS6: the Program Status Protocol (OSC 7501) as the Terminal mirror reads it.

use std::sync::Arc;

use crate::common::{PATIENCE, open, sh, until_exit};
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use contracts::EventData;
use terminal::{Change, ProgramState};
use tokio::sync::broadcast::error::TryRecvError;

fn b64(text: &str) -> String {
    STANDARD.encode(text)
}

fn report(pairs: &str) -> Vec<u8> {
    format!("\x1b]7501;{pairs}\x1b\\").into_bytes()
}

struct Ran {
    changes: Vec<Arc<Change>>,
    printed: String,
}

/// Run `script` in a Terminal in `dir` and collect every change to its records until it exits.
async fn run_script(dir: &tempfile::TempDir, script: &str) -> Ran {
    let (terminals, _) = open(dir);
    let mut changes = terminals.subscribe_status();
    let mut spawned = terminals.spawn(sh(dir.path(), script)).await.unwrap();
    let (printed, _) = until_exit(&mut spawned).await;
    let mut seen = Vec::new();
    loop {
        match changes.try_recv() {
            Ok(change) => seen.push(change),
            Err(TryRecvError::Lagged(_)) => {}
            Err(_) => break,
        }
    }
    Ran {
        changes: seen,
        printed,
    }
}

/// Run a program that prints `bytes` as they are.
async fn run(bytes: &[u8]) -> Ran {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("out"), bytes).unwrap();
    run_script(&dir, "cat out").await
}

fn ids(change: &Change) -> Vec<&str> {
    change.records.iter().map(|r| r.id.as_str()).collect()
}

#[tokio::test]
async fn ps1_a_report_makes_its_record_across_chunk_boundaries() {
    let dir = tempfile::tempdir().unwrap();
    let msg = b64("tests 3/9");
    let script = format!(
        "printf '\\033]75'; sleep 0.2; printf '01;state=blocked:kind=ques'; sleep 0.2; \
         printf 'tion:id=ci/test:progress=33:app=cargo:title={}:msg={msg}\\033'; sleep 0.2; printf '\\\\'",
        b64("Tests")
    );
    let ran = run_script(&dir, &script).await;
    let records = &ran.changes[0].records;
    assert_eq!(records.len(), 1);
    let record = &records[0];
    assert_eq!(record.id, "ci/test");
    assert_eq!(record.state, ProgramState::Blocked);
    assert_eq!(record.kind, Some(terminal::BlockedKind::Question));
    assert_eq!(record.progress, Some(33));
    assert_eq!(record.app.as_deref(), Some("cargo"));
    assert_eq!(record.title.as_deref(), Some("Tests"));
    assert_eq!(record.msg.as_deref(), Some("tests 3/9"));
}

#[tokio::test]
async fn ps1_a_bad_pair_is_skipped_and_the_rest_apply() {
    let bad_msg = b64("a\tb");
    let bad_utf8 = STANDARD.encode([0xff, 0xfe]);
    let reports = [
        "novalue:state=done:unknown=1:kind=weird:progress=5".to_string(),
        "state=working:kind=auth:progress=101:id=a".to_string(),
        "state=working:progress=1.5:id=b".to_string(),
        format!("state=done:id=c:msg={bad_msg}:title={bad_utf8}"),
        "state=done:id=d//e".to_string(),
        "kind=auth:progress=3".to_string(),
    ];
    let bytes: Vec<u8> = reports.iter().flat_map(|r| report(r)).collect();
    let ran = run(&bytes).await;
    let seen: Vec<_> = ran.changes.iter().map(|c| ids(c).join(",")).collect();
    // Five reports apply (the sixth has no state and changes nothing); `a` and `b` are working
    // and drop when the program exits.
    assert_eq!(
        seen[..5],
        ["", ",a", ",a,b", ",a,b,c", "a,b,c,"].map(String::from)
    );
    let root = &ran.changes[0].records[0];
    assert_eq!(root.state, ProgramState::Done);
    assert_eq!((root.kind, root.progress), (None, Some(5)));
    let last = &ran.changes[4].records;
    assert_eq!(last[0].kind, None, "a kind needs state blocked");
    assert_eq!(last[0].progress, None, "101 is out of range");
    assert_eq!(last[1].progress, None, "1.5 is no integer");
    assert_eq!(
        (last[2].msg.as_deref(), last[2].title.as_deref()),
        (None, None)
    );
    assert_eq!(last[3].id, "", "an id with an empty level is skipped");
}

#[tokio::test]
async fn ps1_bad_base64_drops_the_whole_report() {
    let bytes: Vec<u8> = [
        "state=working:msg=!!!!",
        "state=working:title=abc",
        "state=working:id=ok",
    ]
    .iter()
    .flat_map(|r| report(r))
    .collect();
    let ran = run(&bytes).await;
    assert_eq!(ran.changes.len(), 2, "the report and the exit drop");
    assert_eq!(ids(&ran.changes[0]), ["ok"]);
}

#[tokio::test]
async fn ps1_one_change_per_applied_report() {
    let bytes: Vec<u8> = [
        "state=done:id=a",
        "state=nonsense",
        "state=done:id=b",
        "state=clear:id=absent",
        "state=clear:id=a",
    ]
    .iter()
    .flat_map(|r| report(r))
    .collect();
    let ran = run(&bytes).await;
    let seen: Vec<_> = ran.changes.iter().map(|c| ids(c)).collect();
    assert_eq!(seen, [vec!["a"], vec!["a", "b"], vec!["b"]]);
    assert!(ran.changes.iter().all(|c| !c.terminal.is_empty()));
}

fn pad(report_prefix: &str, total: usize) -> Vec<u8> {
    // A whole report of exactly `total` bytes between `ESC ]` and the terminator.
    let mut body = format!("7501;{report_prefix}:app=");
    let fill = total - body.len();
    body.push_str(&"x".repeat(fill));
    format!("\x1b]{body}\x07").into_bytes()
}

#[tokio::test]
async fn ps2_limits_drop_whole_reports_and_the_record_cap_evicts_the_oldest() {
    let mut bytes = Vec::new();
    let mut expect = Vec::new();
    let mut case = |id: &str, pairs: String, applies: bool| {
        bytes.extend(report(&format!("state=done:id={id}:{pairs}")));
        if applies {
            expect.push(id.to_string());
        }
    };
    case("m-at", format!("msg={}", b64(&"a".repeat(2048))), true);
    case("m-under", format!("msg={}", b64(&"a".repeat(2047))), true);
    case("m-over", format!("msg={}", b64(&"a".repeat(2049))), false);
    case("t-at", format!("title={}", b64(&"a".repeat(192))), true);
    case("t-under", format!("title={}", b64(&"a".repeat(191))), true);
    case("t-over", format!("title={}", b64(&"a".repeat(193))), false);
    let long = |n: usize| "a".repeat(n);
    case(&long(128), String::new(), true);
    case(&long(127), String::new(), true);
    case(&long(129), String::new(), false);
    let levels = |n: usize| vec!["l"; n].join("/");
    case(&levels(8), String::new(), true);
    case(&levels(7), String::new(), true);
    case(&levels(9), String::new(), false);
    bytes.extend(pad("state=done:id=w-at", 4096));
    bytes.extend(pad("state=done:id=w-under", 4095));
    bytes.extend(pad("state=done:id=w-over", 4097));
    expect.extend(["w-at".to_string(), "w-under".to_string()]);
    let ran = run(&bytes).await;
    let mut held: Vec<_> = ran
        .changes
        .last()
        .unwrap()
        .records
        .iter()
        .map(|r| r.id.clone())
        .collect();
    held.sort();
    expect.sort();
    assert_eq!(held, expect);
    assert_eq!(ran.changes.len(), expect.len());

    // The 257th record evicts the least recently updated one, not the oldest created.
    let mut cap: Vec<u8> = (0..256)
        .flat_map(|i| report(&format!("state=done:id=i{i}")))
        .collect();
    cap.extend(report("state=idle:id=i0"));
    cap.extend(report("state=done:id=new"));
    let ran = run(&cap).await;
    let held = ran.changes.last().unwrap();
    assert_eq!(held.records.len(), 256);
    assert!(held.records.iter().any(|r| r.id == "i0"));
    assert!(!held.records.iter().any(|r| r.id == "i1"));
    assert!(held.records.iter().any(|r| r.id == "new"));
}

#[tokio::test]
async fn ps3_a_report_replaces_its_record_whole() {
    let bytes: Vec<u8> = [
        format!(
            "state=done:id=a:progress=40:app=x:title={}:msg={}",
            b64("T"),
            b64("M")
        ),
        "state=error:id=a".to_string(),
    ]
    .iter()
    .flat_map(|r| report(r))
    .collect();
    let ran = run(&bytes).await;
    let record = &ran.changes[1].records;
    assert_eq!(record.len(), 1);
    assert_eq!(record[0].state, ProgramState::Error);
    assert_eq!(
        (
            record[0].progress,
            &record[0].app,
            &record[0].title,
            &record[0].msg
        ),
        (None, &None, &None, &None)
    );
}

#[tokio::test]
async fn ps3_clear_removes_a_record_and_the_records_below_it() {
    let bytes: Vec<u8> = [
        "state=done:id=build",
        "state=done:id=build/lint",
        "state=done:id=build/lint/deep",
        "state=done:id=builder",
        "state=done",
        "state=clear:id=build",
        "state=clear",
    ]
    .iter()
    .flat_map(|r| report(r))
    .collect();
    let ran = run(&bytes).await;
    let seen: Vec<_> = ran.changes.iter().map(|c| ids(c)).collect();
    assert_eq!(seen[5], ["builder", ""]);
    assert!(seen[6].is_empty());
}

#[tokio::test]
async fn ps4_working_and_blocked_drop_on_exit_and_on_a_new_prompt_and_done_and_error_stay() {
    let mut prompt = Vec::new();
    for pairs in [
        "state=working:id=w",
        "state=blocked:id=b",
        "state=done:id=d",
        "state=error:id=e",
    ] {
        prompt.extend(report(pairs));
    }
    prompt.extend(b"\x1b]133;A\x07");
    prompt.extend(b"\x1b]133;A\x07");
    let ran = run(&prompt).await;
    let seen: Vec<_> = ran.changes.iter().map(|c| ids(c)).collect();
    assert_eq!(
        seen,
        [
            vec!["w"],
            vec!["w", "b"],
            vec!["w", "b", "d"],
            vec!["w", "b", "d", "e"],
            vec!["d", "e"],
        ],
        "one drop at the prompt, none for the second prompt or for the exit"
    );

    let mut exit = report("state=working:id=w");
    exit.extend(report("state=done:id=d"));
    let ran = run(&exit).await;
    let last = ran.changes.last().unwrap();
    assert_eq!(ids(last), ["d"]);
    assert_eq!(ran.changes.len(), 3);
}

#[tokio::test]
async fn ps4_a_full_reset_clears_every_record() {
    let mut bytes = report("state=done:id=d");
    bytes.extend(report("state=error:id=e"));
    bytes.extend(b"\x1bc");
    let ran = run(&bytes).await;
    assert_eq!(ran.changes.len(), 3);
    assert!(ran.changes[2].records.is_empty());
}

#[tokio::test]
async fn ps5_the_query_gets_the_fixed_reply_and_nothing_else() {
    let reply =
        "\x1b]7501;?:states=idle,working,done,blocked,error,clear:kinds=permission,question,auth";
    let dir = tempfile::tempdir().unwrap();
    // `?x` is no query; the two real ones end as they were asked; the report adds nothing.
    let script = format!(
        "stty raw -echo; printf '\\033]7501;?x\\033\\\\\\033]7501;state=done:msg=SECRET\\033\\\\\\033]7501;?\\033\\\\\\033]7501;?\\007'; \
         head -c {} | cat -v; echo END",
        2 * reply.len() + 3
    );
    let (terminals, _) = open(&dir);
    terminals.answer_status_query(true);
    let mut spawned = terminals.spawn(sh(dir.path(), &script)).await.unwrap();
    let (printed, _) = until_exit(&mut spawned).await;
    let ran = Ran {
        changes: Vec::new(),
        printed,
    };
    let shown = format!("{reply}\x1b\\{reply}\x07")
        .replace('\x1b', "^[")
        .replace('\x07', "^G");
    assert!(
        ran.printed.contains(&format!("{shown}END")),
        "{:?}",
        ran.printed
    );
    assert!(
        !ran.printed.contains("^[]7501;state"),
        "the report is not echoed back"
    );
}

#[tokio::test]
async fn ps5_no_report_writes_to_the_pty() {
    let dir = tempfile::tempdir().unwrap();
    let script = "stty raw -echo min 0 time 8; \
         printf '\\033]7501;state=blocked:kind=auth\\007\\033]7501;state=bad\\007\\033]7501;msg=!!\\007'; \
         got=$(dd bs=1 count=1 2>/dev/null | od -An -tx1); echo \"got:[$got]\"";
    let ran = run_script(&dir, script).await;
    assert!(ran.printed.contains("got:[]"), "{:?}", ran.printed);
}

#[tokio::test]
async fn ps6_other_osc_handling_is_unchanged_beside_reports() {
    let dir = tempfile::tempdir().unwrap();
    let (terminals, _) = open(&dir);
    let mut spawned = terminals
        .spawn(sh(
            dir.path(),
            r"printf '\033]0;one\007hello\033]7501;state=done\007\033]7;file:///tmp\007\033]133;A\007\033]7501;state=idle:id=x\033\\world\033]2;two\033\\'",
        ))
        .await
        .unwrap();
    let mut titles = Vec::new();
    tokio::time::timeout(PATIENCE, async {
        loop {
            match spawned.events.recv().await.unwrap().as_ref() {
                EventData::TerminalTitle(title) => titles.push(title.title.clone()),
                EventData::TerminalExited(_) => break,
                _ => {}
            }
        }
    })
    .await
    .unwrap();
    assert_eq!(titles, ["one", "two"]);
}

#[tokio::test]
async fn ps6_output_carries_the_report_bytes_untouched() {
    let bytes = [
        &b"\x1b]0;one\x07hello"[..],
        &report("state=done"),
        b"\x1b]7;file:///tmp\x07\x1b]133;A\x07world",
    ]
    .concat();
    let ran = run(&bytes).await;
    assert_eq!(ran.printed.as_bytes(), bytes);
}

#[tokio::test]
async fn ps6_a_flood_of_reports_stays_within_the_record_cap() {
    let bytes: Vec<u8> = (0..100_000)
        .flat_map(|i| report(&format!("state=done:id=r{i}")))
        .collect();
    let ran = run(&bytes).await;
    assert!(ran.changes.last().unwrap().records.len() <= 256);
    assert_eq!(ran.changes.last().unwrap().records.len(), 256);
}
