//! FK5977a–FK5977e: `data.fork` on real SQLite files in a temporary data folder.
use super::*;
use crate::tests::ask;
use rusqlite::Connection;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::path::PathBuf;

struct Live {
    _tmp: tempfile::TempDir,
    data: PathBuf,
    /// The two Projects' keys.
    keys: [String; 2],
    daemon: Daemon,
    _others: Vec<Daemon>,
}

impl Live {
    fn project(&self, key: &str) -> PathBuf {
        self.data.join("projects").join(key)
    }

    fn fork_dir(&self, name: &str) -> PathBuf {
        self._tmp.path().join("forks").join(name)
    }
}

fn seed(dir: &Path, tag: &str) {
    let db = Connection::open(dir.join("project.db")).unwrap();
    for n in 0..2 {
        db.execute(
            "INSERT INTO nodes(kind,name,parent,ord) VALUES('agent',?1,NULL,?2)",
            rusqlite::params![format!("{tag}-agent{n}"), n],
        )
        .unwrap();
    }
    let ids: Vec<i64> = db
        .prepare("SELECT id FROM nodes WHERE kind='agent' ORDER BY id")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    for id in &ids {
        db.execute(
            "INSERT INTO messages(from_actor,to_id,kind,body,status,at) VALUES('{\"kind\":\"user\",\"id\":\"you\",\"parent\":null}',?1,'note',?2,'delivered',1)",
            rusqlite::params![id.to_string(), format!("{tag} message to {id}")],
        )
        .unwrap();
        std::fs::create_dir_all(dir.join("agents")).unwrap();
        std::fs::write(dir.join(format!("agents/{id}.settings.json")), "{}").unwrap();
    }
    db.execute(
        "INSERT INTO todos(title,body,created_at) VALUES(?1,'b',1)",
        [format!("{tag} todo")],
    )
    .unwrap();
    db.execute(
        "INSERT INTO pads(key,name,text,updated_at) VALUES('p','note','text',1)",
        [],
    )
    .unwrap();
    std::fs::create_dir_all(dir.join("pads")).unwrap();
    std::fs::write(dir.join("pads/note.md"), "text").unwrap();
    db.execute(
        "INSERT INTO touches(actor_kind,actor_id,verb,item,at) VALUES('user','you','add','todo:1',1)",
        [],
    )
    .unwrap();
}

fn live() -> Live {
    let tmp = tempfile::tempdir().unwrap();
    let data = tmp.path().join("data");
    let mut keys = Vec::new();
    let mut daemons = Vec::new();
    for tag in ["alpha", "beta"] {
        let project = tmp.path().join(tag);
        std::fs::create_dir_all(&project).unwrap();
        let opened = Daemon::open_project(&project, &data).unwrap();
        let dir = data::project_data(&data, &project).unwrap();
        seed(&dir, tag);
        keys.push(dir.file_name().unwrap().to_string_lossy().into_owned());
        daemons.push(opened);
    }
    let keys = [keys.remove(0), keys.remove(0)];
    // Let each Daemon's startup writes land: the checksums below are taken with them idle.
    std::thread::sleep(std::time::Duration::from_millis(500));
    Live {
        _tmp: tmp,
        data,
        keys,
        daemon: daemons.remove(0),
        _others: daemons,
    }
}

async fn fork(live: &Live, folder: &Path, extra: Value) -> Value {
    let mut params = json!({"name":"Try","colour":"teal","path":folder});
    params
        .as_object_mut()
        .unwrap()
        .extend(extra.as_object().unwrap().clone());
    ask(
        &live.daemon,
        &json!({"id":1,"method":"data.fork","params":params}).to_string(),
    )
    .await
}

fn count(db: &Path, table: &str) -> i64 {
    Connection::open(db)
        .unwrap()
        .query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))
        .unwrap()
}

/// Every file under `root` with its checksum.
fn same(a: &BTreeMap<PathBuf, String>, b: &BTreeMap<PathBuf, String>, when: &str) {
    // `-shm` is SQLite's shared-memory index, which any reader takes a read mark in; it holds no data.
    let changed: Vec<_> = a
        .keys()
        .chain(b.keys())
        .filter(|k| !k.to_string_lossy().ends_with("-shm") && a.get(*k) != b.get(*k))
        .collect();
    assert!(changed.is_empty(), "{when}: {changed:?}");
}

fn checksums(root: &Path) -> BTreeMap<PathBuf, String> {
    fn walk(root: &Path, dir: &Path, out: &mut BTreeMap<PathBuf, String>) {
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            let rel = path.strip_prefix(root).unwrap().to_owned();
            if path.is_dir() {
                out.insert(rel, String::new());
                walk(root, &path, out);
            } else {
                let sum = Sha256::digest(std::fs::read(&path).unwrap());
                out.insert(rel, format!("{sum:x}"));
            }
        }
    }
    let mut out = BTreeMap::new();
    walk(root, root, &mut out);
    out
}

#[tokio::test]
async fn fk5977a_the_full_copy_reads_back_through_a_second_daemon() {
    let live = live();
    let folder = live.fork_dir("all");
    let reply = fork(&live, &folder, json!({})).await;
    let result = &reply["result"];
    assert_eq!(result["projects"].as_array().unwrap().len(), 2, "{reply}");
    for key in &live.keys {
        let (from, to) = (live.project(key), folder.join("projects").join(key));
        for table in ["todos", "pads", "messages", "touches", "nodes"] {
            assert_eq!(
                count(&from.join("project.db"), table),
                count(&to.join("project.db"), table),
                "{table}"
            );
        }
        assert_eq!(
            std::fs::read_to_string(to.join("pads/note.md")).unwrap(),
            "text"
        );
        assert_eq!(std::fs::read_dir(to.join("agents")).unwrap().count(), 2);
    }
    // The same Project folder opens its copy.
    let second = Daemon::open(&folder.join("projects").join(&live.keys[0])).unwrap();
    let todos = ask(
        &second,
        &json!({"id":1,"method":"todo.list","params":null}).to_string(),
    )
    .await;
    assert!(
        todos["result"].to_string().contains("alpha todo"),
        "{todos}"
    );
}

#[tokio::test]
async fn fk5977a_a_folder_inside_around_or_filled_is_refused_and_writes_nothing() {
    let live = live();
    for folder in [
        live.data.join("projects/inner"),
        live.data.parent().unwrap().to_path_buf(),
    ] {
        let reply = fork(&live, &folder, json!({})).await;
        assert_eq!(reply["error"]["code"], code::INVALID_PARAMS, "{reply}");
    }
    let filled = live.fork_dir("filled");
    std::fs::create_dir_all(&filled).unwrap();
    std::fs::write(filled.join("mine"), "x").unwrap();
    let reply = fork(&live, &filled, json!({})).await;
    assert_eq!(reply["error"]["code"], code::INVALID_PARAMS, "{reply}");
    assert_eq!(std::fs::read_dir(&filled).unwrap().count(), 1);
    assert!(!live.data.join("projects/inner").exists());
}

#[tokio::test]
async fn fk5977b_each_pick_leaves_out_exactly_what_it_names() {
    let live = live();
    let key = &live.keys[0];
    let agent: i64 = count(&live.project(key).join("project.db"), "nodes");
    assert_eq!(agent, 2);
    let first: i64 = Connection::open(live.project(key).join("project.db"))
        .unwrap()
        .query_row("SELECT min(id) FROM nodes", [], |r| r.get(0))
        .unwrap();
    let folder = live.fork_dir("picked");
    let picks = json!({"projects":[{"key":key,"agents":[first.to_string()],"todos":false,"pads":false,"messages":false,"history":false}]});
    let reply = fork(&live, &folder, picks).await;
    assert!(reply.get("error").is_none(), "{reply}");
    let to = folder.join("projects").join(key);
    let db = to.join("project.db");
    assert!(!folder.join("projects").join(&live.keys[1]).exists());
    assert_eq!(count(&db, "nodes"), 1);
    assert_eq!(count(&db, "todos"), 0);
    assert_eq!(count(&db, "pads"), 0);
    assert_eq!(count(&db, "messages"), 0);
    assert_eq!(count(&db, "touches"), 0);
    assert!(!to.join("pads").exists());
    let files: Vec<_> = std::fs::read_dir(to.join("agents")).unwrap().collect();
    assert_eq!(files.len(), 1);

    // An unpicked Agent has no row, launch file or Message.
    let folder = live.fork_dir("one-agent");
    let reply = fork(
        &live,
        &folder,
        json!({"projects":[{"key":key,"agents":[first.to_string()]}]}),
    )
    .await;
    assert!(reply.get("error").is_none(), "{reply}");
    let db = folder.join("projects").join(key).join("project.db");
    assert_eq!(count(&db, "nodes"), 1);
    assert_eq!(count(&db, "messages"), 1);
    assert_eq!(count(&db, "todos"), 1);
}

#[tokio::test]
async fn fk5977b_an_unknown_key_or_agent_is_refused_and_writes_nothing() {
    let live = live();
    for picks in [
        json!({"projects":[{"key":"nope-0000"}]}),
        json!({"projects":[{"key":live.keys[0],"agents":["9999"]}]}),
    ] {
        let folder = live.fork_dir("bad");
        let reply = fork(&live, &folder, picks).await;
        assert_eq!(reply["error"]["code"], code::INVALID_PARAMS, "{reply}");
        assert!(!folder.exists());
    }
}

#[tokio::test]
async fn fk5977c_a_fork_racing_a_writer_is_whole_and_holds_every_finished_row() {
    let live = live();
    let db = live.project(&live.keys[0]).join("project.db");
    // Held open without checkpoints, so the WAL holds committed rows the main file lacks.
    let held = Connection::open(&db).unwrap();
    held.pragma_update(None, "wal_autocheckpoint", 0).unwrap();
    held.execute(
        "INSERT INTO todos(title,body,created_at) VALUES('wal','b',1)",
        [],
    )
    .unwrap();
    let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let (started, wrote) = std::sync::mpsc::channel();
    let handle = std::thread::spawn({
        let (stop, db) = (stop.clone(), db.clone());
        move || {
            let writer = Connection::open(&db).unwrap();
            let mut rows = 0;
            while !stop.load(std::sync::atomic::Ordering::Relaxed) {
                writer
                    .execute(
                        "INSERT INTO todos(title,body,created_at) VALUES('w','b',1)",
                        [],
                    )
                    .unwrap();
                rows += 1;
                if rows == 50 {
                    started.send(()).unwrap();
                }
                std::thread::yield_now();
            }
        }
    });
    wrote.recv().unwrap();
    let finished = count(&db, "todos");
    let folder = live.fork_dir("race");
    let reply = fork(&live, &folder, json!({})).await;
    stop.store(true, std::sync::atomic::Ordering::Relaxed);
    handle.join().unwrap();
    assert!(reply.get("error").is_none(), "{reply}");
    let copy = folder
        .join("projects")
        .join(&live.keys[0])
        .join("project.db");
    let check: String = Connection::open(&copy)
        .unwrap()
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .unwrap();
    assert_eq!(check, "ok");
    assert!(count(&copy, "todos") >= finished);
}

#[tokio::test]
async fn fk5977d_the_record_holds_the_name_colour_source_and_picks() {
    let live = live();
    let folder = live.fork_dir("rec");
    let picks = json!({"projects":[{"key":live.keys[0],"todos":false}]});
    let reply = fork(&live, &folder, picks.clone()).await;
    assert!(reply.get("error").is_none(), "{reply}");
    let record: Value =
        serde_json::from_str(&std::fs::read_to_string(folder.join("fork.json")).unwrap()).unwrap();
    assert_eq!(record["name"], "Try");
    assert_eq!(record["colour"], "teal");
    assert_eq!(
        record["source"],
        live.data.canonicalize().unwrap().to_str().unwrap()
    );
    assert!(record["created_ms"].as_u64().unwrap() > 0);
    assert_eq!(record["projects"][0]["key"], live.keys[0]);
    assert_eq!(record["projects"][0]["todos"], false);
}

#[tokio::test]
async fn fk5977d_a_bad_colour_or_name_is_refused_with_nothing_written() {
    let live = live();
    let folder = live.fork_dir("refused");
    for (name, colour) in [("Try", "mauve"), ("", "red"), ("tab\there", "red")] {
        let params = json!({"name":name,"colour":colour,"folder":folder});
        let reply = ask(
            &live.daemon,
            &json!({"id":1,"method":"data.fork","params":params}).to_string(),
        )
        .await;
        assert_eq!(reply["error"]["code"], code::INVALID_PARAMS, "{reply}");
    }
    let long = "x".repeat(41);
    let reply = fork(&live, &folder, json!({"name":long})).await;
    assert_eq!(reply["error"]["code"], code::INVALID_PARAMS, "{reply}");
    assert!(!folder.exists());
}

#[tokio::test]
async fn fk5977d_a_failed_copy_removes_the_folder_it_made() {
    let live = live();
    // A database the copy cannot read.
    std::fs::write(
        live.project(&live.keys[1]).join("broken.db"),
        "not sqlite at all",
    )
    .unwrap();
    let folder = live.fork_dir("fails");
    let reply = fork(&live, &folder, json!({})).await;
    assert_eq!(reply["error"]["code"], code::INTERNAL, "{reply}");
    assert!(!folder.exists());
}

#[tokio::test]
async fn fk5977e_the_live_folder_is_unchanged_by_a_fork_and_by_a_write_in_it() {
    // No Daemon is open on the live folder: its own writes are not the Fork's.
    let live = live();
    let Live {
        data,
        keys,
        _tmp,
        daemon,
        _others,
    } = live;
    drop((daemon, _others));
    let params = |name: &str, projects: Option<Vec<contracts::data::ForkProject>>| {
        contracts::data::ForkParams {
            name: "Try".into(),
            colour: contracts::data::ForkColour::Teal,
            path: _tmp
                .path()
                .join("forks")
                .join(name)
                .to_string_lossy()
                .into_owned(),
            projects,
        }
    };
    let before = checksums(&data);
    let picked =
        vec![serde_json::from_value(json!({"key":keys[0],"agents":"none","pads":false})).unwrap()];
    for (name, projects) in [("full", None), ("picked", Some(picked))] {
        crate::fork::fork(&data, &params(name, projects)).unwrap();
        same(&checksums(&data), &before, name);
    }
    let copy = Daemon::open(&_tmp.path().join("forks/full/projects").join(&keys[0])).unwrap();
    let added = ask(
        &copy,
        &json!({"id":1,"method":"todo.create","params":{"title":"in the fork"}}).to_string(),
    )
    .await;
    assert!(added.get("error").is_none(), "{added}");
    same(&checksums(&data), &before, "after a write in the Fork");
}
