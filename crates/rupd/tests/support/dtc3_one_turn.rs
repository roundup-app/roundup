//! DTC3: the 2026-11-07 case, one Job, three Todos of the Door's own and a Wake request, costs the
//! Door one turn. Real Daemon, fake `claude`: the Door's transcript counts the turns.
use super::*;

/// The Door's turns a `rupd` note started, each as the notes the Door was given before it answered:
/// consecutive `user` entries of `rupd` end at the `assistant` entry that answers them.
fn rupd_turns(run: &Run) -> Vec<Vec<String>> {
    let projects = run.dir.path().join("config/projects");
    let mut turns = Vec::new();
    let mut open: Vec<String> = Vec::new();
    let conversations = std::fs::read_dir(projects)
        .into_iter()
        .flatten()
        .flatten()
        .flat_map(|p| std::fs::read_dir(p.path()).into_iter().flatten().flatten())
        .filter(|f| f.path().extension().is_some_and(|e| e == "jsonl"))
        .filter_map(|f| std::fs::read_to_string(f.path()).ok())
        .filter(|written| written.contains(DOOR_PROMPT));
    for written in conversations {
        for entry in written
            .lines()
            .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        {
            if entry["type"] == "user" && entry.to_string().contains(r#"from-name=\"rupd\""#) {
                open.push(entry.to_string());
            } else if entry["type"] == "assistant" && !open.is_empty() {
                turns.push(std::mem::take(&mut open));
            }
        }
    }
    turns
}

#[tokio::test]
async fn dtc3_one_job_three_own_todos_and_a_wake_cost_one_turn() {
    let run = Run::start_live().await;
    run.let_settled_pass().await;
    let before = rupd_turns(&run).len();
    let door = Client::connect(&run.daemon.socket).await.unwrap();
    door.request(
        "daemon.identify",
        json!({"actor":{"kind":"agent","id":run.door,"parent":null}}),
    )
    .await
    .unwrap();
    // The fixture's slow turn keeps the Job at work while the case plays.
    let job = door
        .request(
            "agent.spawn",
            json!({"name":"job","parent":run.door,"cwd":run.dir.path(),"role":"job",
            "prompt":"Do the slow thing",
            "order":{"kind":"work","ask":"Do the slow thing","limits":[]}}),
        )
        .await
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    // The Job reads idle until its prompt is submitted, so the Wake request waits for it to work.
    wait(|| {
        latest_snapshot(run.dir.path()).is_some_and(|v| {
            v["nodes"]
                .as_array()
                .unwrap()
                .iter()
                .any(|n| n["id"] == job && n["status"]["kind"] == "working")
        })
    })
    .await;
    door.request("agent.wake", json!({"ids":[job]}))
        .await
        .unwrap();
    for title in ["one", "two", "three"] {
        door.request(
            "todo.create",
            json!({"title":title,"owner":{"kind":"agent","id":run.door}}),
        )
        .await
        .unwrap();
    }
    // The Job's open Todos move twice before it reports.
    let worker = Client::connect(&run.daemon.socket).await.unwrap();
    worker
        .request(
            "daemon.identify",
            json!({"actor":{"kind":"agent","id":job,"parent":run.door}}),
        )
        .await
        .unwrap();
    for title in ["first change", "second change"] {
        worker
            .request("todo.create", json!({"title":title}))
            .await
            .unwrap();
        run.compared().await;
    }
    // The slow turn ends: the Job reports, and its Wake request fires.
    wait(|| rupd_turns(&run).len() > before).await;
    tokio::time::sleep(Duration::from_secs(5)).await;
    let turns = rupd_turns(&run);
    assert_eq!(turns.len() - before, 1, "{:#?}", &turns[before..]);
    let notes = turns.last().unwrap().join("\n");
    assert!(notes.contains("[wake]"), "the report's note: {notes}");
    assert!(
        notes.contains("[digest]"),
        "the Job's last quiet digest rides in the same turn: {notes}"
    );
}
