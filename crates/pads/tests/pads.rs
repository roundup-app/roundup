use std::sync::Arc;

use contracts::{Actor, ActorKind, EventData, Verb};
use pads::{PadDeletion, PadSourceState, Pads, source, source_state};
use provenance::Touches;
use rpc::{Bus, Ctx, Module, code};
use serde_json::{Value, json};
use tempfile::TempDir;

/// APFS caps a file name at 255 characters (bytes on other file systems).
const BEYOND_NAME_MAX: usize = 300;

const NOT_UTF8: [u8; 2] = [0xff, 0xfe];

fn agent(id: &str) -> Actor {
    Actor {
        kind: ActorKind::Agent,
        id: id.into(),
        parent: None,
    }
}

struct Rig {
    pads: Pads,
    bus: Bus,
    touches: Arc<Touches>,
    dir: TempDir,
}

impl Rig {
    fn new() -> Self {
        let dir = TempDir::new().unwrap();
        let bus = Bus::new();
        Self {
            pads: Pads::open(dir.path(), bus.clone()).unwrap(),
            bus,
            touches: Arc::new(Touches::in_memory().unwrap()),
            dir,
        }
    }

    async fn call(
        &self,
        actor: &Actor,
        method: &str,
        params: Value,
    ) -> Result<Value, rpc::RpcError> {
        let ctx = Ctx {
            actor: actor.clone(),
            bus: self.bus.clone(),
            touches: Arc::clone(&self.touches),
        };
        self.pads.call(&ctx, method, params).await
    }

    fn file_text(&self, name: &str) -> String {
        std::fs::read_to_string(self.dir.path().join("pads").join(name)).unwrap()
    }

    /// A row written straight to the database, bypassing name validation.
    fn store_row(&self, name: &str) {
        rusqlite::Connection::open(self.dir.path().join("pads.db"))
            .unwrap()
            .execute(
                "INSERT INTO pads (key, name, owner, text, updated_at) VALUES (?1, ?1, ?2, 'orig', 0)",
                [name.to_string(), serde_json::to_string(&agent("a")).unwrap()],
            )
            .unwrap();
    }

    async fn create(&self, name: &str, text: &str) {
        let params = json!({"name": name, "text": text});
        self.ok(&agent("a"), "pad.create", params).await;
    }

    async fn ok(&self, actor: &Actor, method: &str, params: Value) -> Value {
        self.call(actor, method, params).await.unwrap()
    }

    async fn fail(&self, actor: &Actor, method: &str, params: Value) -> rpc::RpcError {
        self.call(actor, method, params).await.unwrap_err()
    }
}

#[tokio::test]
async fn p1_create_makes_the_caller_owner_and_logs_a_write() {
    let rig = Rig::new();
    let mut events = rig.bus.subscribe();
    let a = agent("a");

    let pad = rig
        .ok(&a, "pad.create", json!({"name": "notes", "text": "hi"}))
        .await;

    assert_eq!(pad["owner"]["id"], "a");
    assert_eq!(pad["text"], "hi");
    let duplicate = rig.fail(&a, "pad.create", json!({"name": "notes"})).await;
    assert_eq!(duplicate.code, code::CONFLICT);
    let EventData::PadChanged(changed) = events.try_recv().unwrap().data else {
        panic!("expected pad.changed");
    };
    assert_eq!(changed.name, "notes");
    let history = rig.touches.history("pad:notes").unwrap();
    assert_eq!(history.len(), 1);
    assert_eq!(history[0].verb, Verb::Wrote);
}

#[tokio::test]
async fn p2_owner_rewrites_and_others_only_append() {
    let rig = Rig::new();
    let (a, b) = (agent("a"), agent("b"));
    rig.ok(&a, "pad.create", json!({"name": "notes", "text": "one"}))
        .await;

    rig.ok(&a, "pad.write", json!({"name": "notes", "text": "two"}))
        .await;
    let mut events = rig.bus.subscribe();
    let denied = rig
        .fail(&b, "pad.write", json!({"name": "notes", "text": "x"}))
        .await;
    assert_eq!(denied.code, code::FORBIDDEN);
    assert!(events.try_recv().is_err());
    rig.ok(&b, "pad.append", json!({"name": "notes", "text": "+b"}))
        .await;

    let pad = rig.ok(&a, "pad.read", json!({"name": "notes"})).await;
    assert_eq!(pad["text"], "two+b");
    assert!(matches!(
        events.try_recv().unwrap().data,
        EventData::PadChanged(_)
    ));
    let by_b: Vec<_> = rig.touches.touched("b").unwrap();
    assert_eq!(by_b.len(), 1);
    assert_eq!(by_b[0].verb, Verb::Wrote);
}

#[tokio::test]
async fn p3_list_is_ordered_and_read_is_logged() {
    let rig = Rig::new();
    let a = agent("a");
    for name in ["c", "a", "b"] {
        rig.ok(&a, "pad.create", json!({"name": name, "text": name}))
            .await;
    }

    let listed = rig.ok(&a, "pad.list", Value::Null).await;
    let names: Vec<_> = listed
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, ["a", "b", "c"]);
    let read = rig.ok(&a, "pad.read", json!({"name": "b"})).await;
    assert_eq!(
        (read["name"].as_str(), read["text"].as_str()),
        (Some("b"), Some("b"))
    );
    rig.ok(&a, "pad.read", json!({"name": "a"})).await;
    let verbs: Vec<_> = rig
        .touches
        .history("pad:a")
        .unwrap()
        .iter()
        .map(|t| t.verb)
        .collect();
    assert_eq!(verbs, [Verb::Wrote, Verb::Read]);
    let missing = rig.fail(&a, "pad.read", json!({"name": "zzz"})).await;
    assert_eq!(missing.code, code::NOT_FOUND);
}

#[tokio::test]
async fn p8_bad_names_are_invalid_params_for_every_method() {
    let rig = Rig::new();
    let a = agent("a");
    let path = rig.dir.path().join("out.md");
    for method in [
        "pad.create",
        "pad.read",
        "pad.write",
        "pad.append",
        "pad.delete",
        "pad.setOwner",
        "pad.export",
    ] {
        for name in ["", "a/b", "a\\b", "..", ".hidden", "a..b", "a\0b"] {
            let err = rig
                .fail(
                    &a,
                    method,
                    json!({"name": name, "text": "x", "owner": a, "path": path}),
                )
                .await;
            assert_eq!(err.code, code::INVALID_PARAMS, "{method} {name:?}");
            assert!(
                err.message.contains("invalid pad name"),
                "{method} {name:?}: {}",
                err.message
            );
        }
    }
}

fn user() -> Actor {
    Actor::user()
}

#[tokio::test]
async fn p4_user_flips_ownership_and_owner_may_hand_over() {
    let rig = Rig::new();
    let (a, b) = (agent("a"), agent("b"));
    rig.call(&a, "pad.create", json!({"name": "notes"}))
        .await
        .unwrap();

    let denied = rig
        .call(&b, "pad.setOwner", json!({"name": "notes", "owner": b}))
        .await
        .unwrap_err();
    assert_eq!(denied.code, code::FORBIDDEN);
    let flipped = rig
        .call(
            &user(),
            "pad.setOwner",
            json!({"name": "notes", "owner": user()}),
        )
        .await
        .unwrap();
    assert_eq!(flipped["owner"]["kind"], "user");

    let locked_out = rig
        .call(&a, "pad.write", json!({"name": "notes", "text": "x"}))
        .await
        .unwrap_err();
    assert_eq!(locked_out.code, code::FORBIDDEN);
    rig.call(
        &user(),
        "pad.write",
        json!({"name": "notes", "text": "mine"}),
    )
    .await
    .unwrap();
    let handed = rig
        .call(
            &user(),
            "pad.setOwner",
            json!({"name": "notes", "owner": b}),
        )
        .await
        .unwrap();
    assert_eq!(handed["owner"]["id"], "b");
}

#[tokio::test]
async fn p6_export_writes_one_file_and_never_creates_directories() {
    let rig = Rig::new();
    let a = agent("a");
    rig.call(&a, "pad.create", json!({"name": "notes", "text": "hello"}))
        .await
        .unwrap();
    let out = TempDir::new().unwrap();

    let target = out.path().join("notes.md");
    rig.call(&a, "pad.export", json!({"name": "notes", "path": target}))
        .await
        .unwrap();
    assert_eq!(std::fs::read_to_string(&target).unwrap(), "hello");
    rig.ok(&a, "pad.setStorage", json!({"files": true})).await;
    let in_files_mode = out.path().join("files-mode.md");
    rig.ok(
        &a,
        "pad.export",
        json!({"name": "notes", "path": in_files_mode}),
    )
    .await;
    assert_eq!(std::fs::read_to_string(&in_files_mode).unwrap(), "hello");

    let missing_dir = out.path().join("nope").join("notes.md");
    let err = rig
        .call(
            &a,
            "pad.export",
            json!({"name": "notes", "path": missing_dir}),
        )
        .await
        .unwrap_err();
    assert_eq!(err.code, code::INVALID_PARAMS);
    assert!(!out.path().join("nope").exists());
}

// Rule 10: p7_every_pad_keeps_its_own_owner_and_text_after_reopening proves the single-Pad reopen too.
#[tokio::test]
async fn p7_every_pad_keeps_its_own_owner_and_text_after_reopening() {
    let dir = TempDir::new().unwrap();
    let (a, b) = (agent("a"), agent("b"));
    let touches = Arc::new(Touches::in_memory().unwrap());
    let call = |pads: Pads, actor: Actor, method: &'static str, params: Value| {
        let ctx = Ctx {
            actor,
            bus: Bus::new(),
            touches: Arc::clone(&touches),
        };
        async move { pads.call(&ctx, method, params).await.unwrap() }
    };
    call(
        Pads::open(dir.path(), Bus::new()).unwrap(),
        a.clone(),
        "pad.create",
        json!({"name": "notes", "text": "n1"}),
    )
    .await;
    call(
        Pads::open(dir.path(), Bus::new()).unwrap(),
        b.clone(),
        "pad.create",
        json!({"name": "plan", "text": "n2"}),
    )
    .await;

    let reopened = Pads::open(dir.path(), Bus::new()).unwrap();
    let listed = call(reopened, a.clone(), "pad.list", Value::Null).await;

    let pads = listed.as_array().unwrap();
    let names: Vec<_> = pads.iter().map(|p| p["name"].as_str().unwrap()).collect();
    let owners: Vec<_> = pads
        .iter()
        .map(|p| p["owner"]["id"].as_str().unwrap())
        .collect();
    let texts: Vec<_> = pads.iter().map(|p| p["text"].as_str().unwrap()).collect();
    assert_eq!(names, ["notes", "plan"]);
    assert_eq!(owners, ["a", "b"]);
    assert_eq!(texts, ["n1", "n2"]);
}

#[tokio::test]
async fn p9_owner_or_user_deletes_and_others_are_forbidden() {
    let rig = Rig::new();
    let (a, b) = (agent("a"), agent("b"));
    rig.ok(&a, "pad.create", json!({"name": "notes"})).await;
    rig.ok(&a, "pad.create", json!({"name": "plan"})).await;

    let db = rusqlite::Connection::open(rig.dir.path().join("pads.db")).unwrap();
    let notes = source(&db, "notes").unwrap().unwrap();
    let plan = source(&db, "plan").unwrap().unwrap();
    let denied = rig.fail(&b, "pad.delete", json!({"name": "notes"})).await;
    assert_eq!(denied.code, code::FORBIDDEN);
    assert_eq!(
        source_state(&db, notes.incarnation).unwrap(),
        PadSourceState::Live(notes.clone())
    );
    let mut events = rig.bus.subscribe();
    rig.ok(&a, "pad.delete", json!({"name": "notes"})).await;
    rig.ok(&user(), "pad.delete", json!({"name": "plan"})).await;

    assert_eq!(
        source_state(&db, notes.incarnation).unwrap(),
        PadSourceState::Deleted(PadDeletion::Owner)
    );
    assert_eq!(
        source_state(&db, plan.incarnation).unwrap(),
        PadSourceState::Deleted(PadDeletion::User)
    );
    let gone = rig.fail(&a, "pad.read", json!({"name": "notes"})).await;
    assert_eq!(gone.code, code::NOT_FOUND);
    let EventData::PadChanged(changed) = events.try_recv().unwrap().data else {
        panic!("expected pad.changed");
    };
    assert_eq!(changed.name, "notes");
    let verbs: Vec<_> = rig
        .touches
        .history("pad:notes")
        .unwrap()
        .iter()
        .map(|t| t.verb)
        .collect();
    assert_eq!(verbs, [Verb::Wrote, Verb::Wrote]);
}

#[tokio::test]
async fn p5_files_mirror_pads_and_edits_import_when_flipped_back() {
    let rig = Rig::new();
    let a = agent("a");
    rig.ok(&a, "pad.create", json!({"name": "notes", "text": "one"}))
        .await;
    rig.ok(&a, "pad.create", json!({"name": "plan", "text": "p"}))
        .await;

    rig.ok(&a, "pad.setStorage", json!({"files": true})).await;
    assert_eq!(rig.file_text("notes.md"), "one");
    assert_eq!(rig.file_text("plan.md"), "p");

    rig.ok(&a, "pad.write", json!({"name": "notes", "text": "two"}))
        .await;
    assert_eq!(rig.file_text("notes.md"), "two");
    rig.ok(
        &agent("b"),
        "pad.append",
        json!({"name": "notes", "text": "+b"}),
    )
    .await;
    assert_eq!(rig.file_text("notes.md"), "two+b");

    let reopened = Pads::open(rig.dir.path(), Bus::new()).unwrap();
    let ctx = Ctx {
        actor: a.clone(),
        bus: Bus::new(),
        touches: Arc::clone(&rig.touches),
    };
    reopened
        .call(&ctx, "pad.append", json!({"name": "notes", "text": "!"}))
        .await
        .unwrap();
    assert_eq!(rig.file_text("notes.md"), "two+b!");

    std::fs::write(rig.dir.path().join("pads/notes.md"), "edited on disk").unwrap();
    reopened
        .call(&ctx, "pad.setStorage", json!({"files": false}))
        .await
        .unwrap();

    let pad = rig.ok(&a, "pad.read", json!({"name": "notes"})).await;
    assert_eq!(pad["text"], "edited on disk");
}

#[tokio::test]
async fn p9_delete_removes_the_file_when_file_backed() {
    let rig = Rig::new();
    let a = agent("a");
    rig.ok(&a, "pad.setStorage", json!({"files": true})).await;
    rig.ok(&a, "pad.create", json!({"name": "notes"})).await;
    let file = rig.dir.path().join("pads/notes.md");
    assert!(file.exists());

    rig.ok(&a, "pad.delete", json!({"name": "notes"})).await;

    assert!(!file.exists());
}

#[tokio::test]
async fn p4_owner_may_hand_over_its_own_pad() {
    let rig = Rig::new();
    let (a, b) = (agent("a"), agent("b"));
    rig.ok(&a, "pad.create", json!({"name": "notes"})).await;

    let handed = rig
        .ok(&a, "pad.setOwner", json!({"name": "notes", "owner": b}))
        .await;

    assert_eq!(handed["owner"]["id"], "b");
    let again = rig
        .fail(&a, "pad.setOwner", json!({"name": "notes", "owner": a}))
        .await;
    assert_eq!(again.code, code::FORBIDDEN);
}

#[tokio::test]
async fn p5_a_failed_flip_back_applies_nothing_and_can_be_retried() {
    let rig = Rig::new();
    let a = agent("a");
    rig.ok(&a, "pad.create", json!({"name": "notes", "text": "n"}))
        .await;
    rig.ok(&a, "pad.create", json!({"name": "plan", "text": "p"}))
        .await;
    rig.ok(&a, "pad.setStorage", json!({"files": true})).await;
    let files = rig.dir.path().join("pads");
    std::fs::write(files.join("notes.md"), "edited").unwrap();
    std::fs::write(files.join("plan.md"), NOT_UTF8).unwrap();

    let err = rig
        .fail(&a, "pad.setStorage", json!({"files": false}))
        .await;

    assert_eq!(err.code, code::INTERNAL);
    let notes = rig.ok(&a, "pad.read", json!({"name": "notes"})).await;
    assert_eq!(notes["text"], "n");
    std::fs::write(files.join("plan.md"), "fixed").unwrap();
    rig.ok(&a, "pad.setStorage", json!({"files": false})).await;
    let notes = rig.ok(&a, "pad.read", json!({"name": "notes"})).await;
    assert_eq!(notes["text"], "edited");
}

#[tokio::test]
async fn p5_a_failed_file_write_changes_nothing_and_emits_nothing() {
    let rig = Rig::new();
    let a = agent("a");
    rig.ok(&a, "pad.create", json!({"name": "notes", "text": "old"}))
        .await;
    rig.ok(&a, "pad.setStorage", json!({"files": true})).await;
    let blocked = rig.dir.path().join("pads");
    std::fs::remove_file(blocked.join("notes.md")).unwrap();
    std::fs::create_dir(blocked.join("notes.md")).unwrap();
    std::fs::create_dir(blocked.join("other.md")).unwrap();
    let mut events = rig.bus.subscribe();
    let touched = rig.touches.touched("a").unwrap().len();

    rig.fail(&a, "pad.write", json!({"name": "notes", "text": "new"}))
        .await;
    rig.fail(&a, "pad.append", json!({"name": "notes", "text": "+"}))
        .await;
    rig.fail(&a, "pad.create", json!({"name": "other"})).await;

    let pad = rig.ok(&a, "pad.read", json!({"name": "notes"})).await;
    assert_eq!(pad["text"], "old");
    let missing = rig.fail(&a, "pad.read", json!({"name": "other"})).await;
    assert_eq!(missing.code, code::NOT_FOUND);
    assert!(events.try_recv().is_err());
    assert_eq!(
        rig.touches.touched("a").unwrap().len(),
        touched + 1,
        "only the read"
    );
}

#[tokio::test]
async fn p9_a_failed_file_removal_deletes_nothing() {
    let rig = Rig::new();
    let a = agent("a");
    rig.ok(&a, "pad.create", json!({"name": "notes", "text": "keep"}))
        .await;
    rig.ok(&a, "pad.setStorage", json!({"files": true})).await;
    let file = rig.dir.path().join("pads/notes.md");
    std::fs::remove_file(&file).unwrap();
    std::fs::create_dir(&file).unwrap();
    std::fs::write(file.join("inner"), "x").unwrap();
    let mut events = rig.bus.subscribe();

    rig.fail(&a, "pad.delete", json!({"name": "notes"})).await;

    let pad = rig.ok(&a, "pad.read", json!({"name": "notes"})).await;
    assert_eq!(pad["text"], "keep");
    assert!(events.try_recv().is_err());
    let verbs: Vec<_> = rig
        .touches
        .history("pad:notes")
        .unwrap()
        .iter()
        .map(|t| t.verb)
        .collect();
    assert_eq!(verbs, [Verb::Wrote, Verb::Read]);
}

#[tokio::test]
async fn p5_a_write_is_atomic_so_hard_links_keep_the_old_text() {
    let rig = Rig::new();
    let a = agent("a");
    rig.ok(&a, "pad.create", json!({"name": "notes", "text": "old"}))
        .await;
    rig.ok(&a, "pad.setStorage", json!({"files": true})).await;
    let files = rig.dir.path().join("pads");
    std::fs::hard_link(files.join("notes.md"), files.join("link.md")).unwrap();

    rig.ok(&a, "pad.write", json!({"name": "notes", "text": "new"}))
        .await;

    assert_eq!(rig.file_text("notes.md"), "new");
    assert_eq!(rig.file_text("link.md"), "old");
}

#[tokio::test]
async fn p5_a_case_clash_in_file_mode_leaves_the_first_pad_and_its_file() {
    let rig = Rig::new();
    let a = agent("a");
    rig.ok(&a, "pad.setStorage", json!({"files": true})).await;
    rig.ok(&a, "pad.create", json!({"name": "notes", "text": "first"}))
        .await;

    let clash = rig
        .fail(&a, "pad.create", json!({"name": "Notes", "text": "second"}))
        .await;

    assert_eq!(clash.code, code::CONFLICT);
    let files = rig.dir.path().join("pads");
    assert_eq!(rig.file_text("notes.md"), "first");
    assert_eq!(std::fs::read_dir(&files).unwrap().count(), 1);
}

#[tokio::test]
async fn p5_a_pair_that_once_collided_shares_one_file_and_survives_the_flip() {
    let rig = Rig::new();
    let a = agent("a");
    rig.ok(&a, "pad.create", json!({"name": "ΑΣ", "text": "one"}))
        .await;
    rig.fail(&a, "pad.create", json!({"name": "ασ", "text": "two"}))
        .await;

    rig.ok(&a, "pad.setStorage", json!({"files": true})).await;
    let files = rig.dir.path().join("pads");
    assert_eq!(std::fs::read_dir(&files).unwrap().count(), 1);
    rig.ok(&a, "pad.setStorage", json!({"files": false})).await;

    let pad = rig.ok(&a, "pad.read", json!({"name": "ασ"})).await;
    assert_eq!(
        (pad["name"].as_str(), pad["text"].as_str()),
        (Some("ΑΣ"), Some("one"))
    );
}

#[tokio::test]
async fn p8_a_stored_pad_with_a_bad_name_fails_the_flip_as_invalid_params() {
    let rig = Rig::new();
    let a = agent("a");
    rig.ok(&a, "pad.setStorage", json!({"files": true})).await;
    let nul = rig.fail(&a, "pad.create", json!({"name": "a\0b"})).await;
    assert_eq!(nul.code, code::INVALID_PARAMS);
    rig.ok(&a, "pad.setStorage", json!({"files": false})).await;
    rig.store_row("a\0b");

    let err = rig.fail(&a, "pad.setStorage", json!({"files": true})).await;

    assert_eq!(err.code, code::INVALID_PARAMS);
    assert!(err.message.contains("a\\0b"), "{}", err.message);
}

#[tokio::test]
async fn p5_a_name_the_file_system_refuses_is_invalid_params() {
    let rig = Rig::new();
    let a = agent("a");
    rig.ok(&a, "pad.setStorage", json!({"files": true})).await;

    let err = rig
        .fail(
            &a,
            "pad.create",
            json!({"name": "x".repeat(BEYOND_NAME_MAX)}),
        )
        .await;

    assert_eq!(err.code, code::INVALID_PARAMS);
}

// Rule 10: replaces p1_names_are_unique_ignoring_case;
// p1_every_method_resolves_other_spellings_to_the_same_pad proves its read-back clause.
#[tokio::test]
async fn p1_names_that_fold_or_normalize_together_conflict() {
    let rig = Rig::new();
    let a = agent("a");
    for (first, second) in [
        ("notes", "Notes"),
        ("ΑΣ", "ασ"),
        ("straße", "STRASSE"),
        ("caf\u{e9}", "cafe\u{301}"),
        ("\u{1FB4}", "\u{3B1}\u{345}\u{301}"),
    ] {
        rig.ok(&a, "pad.create", json!({"name": first})).await;
        let clash = rig.fail(&a, "pad.create", json!({"name": second})).await;
        assert_eq!(clash.code, code::CONFLICT, "{first} vs {second}");
    }
}

#[tokio::test]
async fn p1_every_method_resolves_other_spellings_to_the_same_pad() {
    let rig = Rig::new();
    let (a, b) = (agent("a"), agent("b"));
    let out = TempDir::new().unwrap();
    rig.ok(&a, "pad.create", json!({"name": "Notes", "text": "x"}))
        .await;

    rig.ok(&a, "pad.write", json!({"name": "nOTES", "text": "y"}))
        .await;
    rig.ok(&b, "pad.append", json!({"name": "NOTES", "text": "z"}))
        .await;
    let read = rig.ok(&a, "pad.read", json!({"name": "notes"})).await;
    assert_eq!(
        (read["name"].as_str(), read["text"].as_str()),
        (Some("Notes"), Some("yz"))
    );
    rig.ok(&a, "pad.setOwner", json!({"name": "nOtEs", "owner": b}))
        .await;
    let path = out.path().join("n.md");
    rig.ok(&b, "pad.export", json!({"name": "NOTES", "path": path}))
        .await;
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "yz");
    rig.ok(&b, "pad.delete", json!({"name": "noTES"})).await;

    let gone = rig.fail(&a, "pad.read", json!({"name": "Notes"})).await;
    assert_eq!(gone.code, code::NOT_FOUND);
}

#[tokio::test]
async fn p8_a_stored_pad_that_escapes_the_directory_fails_flip_back() {
    let rig = Rig::new();
    let a = agent("a");
    rig.ok(&a, "pad.setStorage", json!({"files": true})).await;
    std::fs::write(rig.dir.path().join("evil.md"), "outside").unwrap();
    rig.store_row("../evil");

    let err = rig
        .fail(&a, "pad.setStorage", json!({"files": false}))
        .await;

    assert_eq!(err.code, code::INVALID_PARAMS);
    assert!(err.message.contains("../evil"), "{}", err.message);
}

#[cfg(target_os = "macos")]
#[tokio::test]
async fn p5_a_code_point_apfs_refuses_is_invalid_params() {
    let rig = Rig::new();
    let a = agent("a");
    rig.store_row("a\u{FFFE}");
    let on_flip = rig.fail(&a, "pad.setStorage", json!({"files": true})).await;
    assert_eq!(on_flip.code, code::INVALID_PARAMS);
    rig.ok(&a, "pad.delete", json!({"name": "a\u{FFFE}"})).await;
    rig.ok(&a, "pad.setStorage", json!({"files": true})).await;

    let on_create = rig
        .fail(&a, "pad.create", json!({"name": "b\u{FFFE}"}))
        .await;

    assert_eq!(on_create.code, code::INVALID_PARAMS);
}

#[tokio::test]
async fn p9_delete_succeeds_when_the_file_was_removed_on_disk() {
    let rig = Rig::new();
    let a = agent("a");
    rig.create("notes", "x").await;
    rig.ok(&a, "pad.setStorage", json!({"files": true})).await;
    std::fs::remove_file(rig.dir.path().join("pads/notes.md")).unwrap();

    rig.ok(&a, "pad.delete", json!({"name": "notes"})).await;

    let gone = rig.fail(&a, "pad.read", json!({"name": "notes"})).await;
    assert_eq!(gone.code, code::NOT_FOUND);
}

#[tokio::test]
async fn p5_flip_back_reports_only_the_edited_pad() {
    let rig = Rig::new();
    let a = agent("a");
    rig.create("notes", "n").await;
    rig.create("plan", "p").await;
    rig.ok(&a, "pad.setStorage", json!({"files": true})).await;
    std::fs::write(rig.dir.path().join("pads/plan.md"), "edited").unwrap();
    let mut events = rig.bus.subscribe();

    rig.ok(&a, "pad.setStorage", json!({"files": false})).await;

    let EventData::PadChanged(changed) = events.try_recv().unwrap().data else {
        panic!("expected pad.changed");
    };
    assert_eq!(changed.name, "plan");
    assert!(events.try_recv().is_err());
    let verbs = |item| -> Vec<_> {
        rig.touches
            .history(item)
            .unwrap()
            .iter()
            .map(|t| t.verb)
            .collect()
    };
    assert_eq!(verbs("pad:plan"), [Verb::Wrote, Verb::Wrote]);
    assert_eq!(verbs("pad:notes"), [Verb::Wrote]);
}

#[tokio::test]
async fn p6_a_relative_export_path_is_invalid_params() {
    let rig = Rig::new();
    rig.create("notes", "x").await;

    let err = rig
        .fail(
            &agent("a"),
            "pad.export",
            json!({"name": "notes", "path": "out.md"}),
        )
        .await;

    assert_eq!(err.code, code::INVALID_PARAMS);
}

#[tokio::test]
async fn p8_flip_validates_every_name_before_any_file_operation() {
    let rig = Rig::new();
    let a = agent("a");
    rig.create("-first", "x").await;
    rig.store_row("a\0b");

    let err = rig.fail(&a, "pad.setStorage", json!({"files": true})).await;

    assert_eq!(err.code, code::INVALID_PARAMS);
    assert!(!rig.dir.path().join("pads/-first.md").exists());
}

#[tokio::test]
async fn p8_flip_back_validates_before_reading_any_file() {
    let rig = Rig::new();
    let a = agent("a");
    rig.create("-first", "x").await;
    rig.ok(&a, "pad.setStorage", json!({"files": true})).await;
    let first = rig.dir.path().join("pads/-first.md");
    std::fs::remove_file(&first).unwrap();
    std::fs::create_dir(&first).unwrap();
    std::fs::create_dir(rig.dir.path().join("evil.md")).unwrap();
    rig.store_row("../evil");

    let err = rig
        .fail(&a, "pad.setStorage", json!({"files": false}))
        .await;

    assert_eq!(err.code, code::INVALID_PARAMS);
}

/// Makes the next update of `name` delete the row first, as a concurrent Daemon's delete would.
fn delete_row_before_update_of(rig: &Rig, name: &str) {
    rusqlite::Connection::open(rig.dir.path().join("pads.db"))
        .unwrap()
        .execute_batch(&format!(
            "CREATE TRIGGER racing_delete BEFORE UPDATE ON pads WHEN OLD.name = '{name}'
             BEGIN DELETE FROM pads WHERE name = OLD.name; END;"
        ))
        .unwrap();
}

#[tokio::test]
async fn p5_a_write_that_loses_to_a_delete_leaves_no_file() {
    let rig = Rig::new();
    let a = agent("a");
    rig.create("notes", "x").await;
    rig.ok(&a, "pad.setStorage", json!({"files": true})).await;
    std::fs::remove_file(rig.dir.path().join("pads/notes.md")).unwrap();
    delete_row_before_update_of(&rig, "notes");

    let err = rig
        .fail(&a, "pad.write", json!({"name": "notes", "text": "y"}))
        .await;

    assert_eq!(err.code, code::NOT_FOUND);
    assert!(!rig.dir.path().join("pads/notes.md").exists());
}

#[tokio::test]
async fn p5_a_flip_back_that_fails_part_way_imports_nothing() {
    let rig = Rig::new();
    let a = agent("a");
    rig.create("notes", "n").await;
    rig.create("plan", "p").await;
    rig.ok(&a, "pad.setStorage", json!({"files": true})).await;
    std::fs::write(rig.dir.path().join("pads/notes.md"), "edited").unwrap();
    std::fs::write(rig.dir.path().join("pads/plan.md"), "edited").unwrap();
    delete_row_before_update_of(&rig, "plan");

    rig.fail(&a, "pad.setStorage", json!({"files": false}))
        .await;

    let notes = rig.ok(&a, "pad.read", json!({"name": "notes"})).await;
    assert_eq!(notes["text"], "n");
    rig.ok(&a, "pad.write", json!({"name": "notes", "text": "z"}))
        .await;
    assert_eq!(rig.file_text("notes.md"), "z");
}

#[tokio::test]
async fn u148_a_visual_block_survives_files_export_and_reopening_byte_exact() {
    let dir = TempDir::new().unwrap();
    let a = agent("a");
    let touches = Arc::new(Touches::in_memory().unwrap());
    let call = |pads: Pads, method: &'static str, params: Value| {
        let ctx = Ctx {
            actor: a.clone(),
            bus: Bus::new(),
            touches: Arc::clone(&touches),
        };
        async move { pads.call(&ctx, method, params).await.unwrap() }
    };
    let text = "before\r\n\r\n```mermaid\ngraph TD\n  A --> B  \n```\n\n```excalidraw\n{\"type\":\"excalidraw\",\"version\":2,\"elements\":[]}\n```\n";
    call(
        Pads::open(dir.path(), Bus::new()).unwrap(),
        "pad.create",
        json!({"name": "notes", "text": text}),
    )
    .await;

    let reopened = Pads::open(dir.path(), Bus::new()).unwrap();
    let out = TempDir::new().unwrap();
    let target = out.path().join("notes.md");
    call(
        Pads::open(dir.path(), Bus::new()).unwrap(),
        "pad.export",
        json!({"name": "notes", "path": target}),
    )
    .await;
    call(
        Pads::open(dir.path(), Bus::new()).unwrap(),
        "pad.setStorage",
        json!({"files": true}),
    )
    .await;

    assert_eq!(std::fs::read_to_string(&target).unwrap(), text);
    assert_eq!(
        std::fs::read_to_string(dir.path().join("pads").join("notes.md")).unwrap(),
        text
    );
    assert_eq!(
        call(reopened, "pad.read", json!({"name": "notes"})).await["text"],
        text
    );
}

#[tokio::test]
async fn u149_a_drawing_survives_files_export_and_reopening_byte_exact() {
    let dir = TempDir::new().unwrap();
    let a = agent("a");
    let touches = Arc::new(Touches::in_memory().unwrap());
    let call = |pads: Pads, method: &'static str, params: Value| {
        let ctx = Ctx {
            actor: a.clone(),
            bus: Bus::new(),
            touches: Arc::clone(&touches),
        };
        async move { pads.call(&ctx, method, params).await.unwrap() }
    };
    let text = "before\r\n\r\n```excalidraw\n{\"type\":\"excalidraw\",\"version\":2,\"elements\":[{\"type\":\"rectangle\",\"id\":\"a\",\"x\":0,\"y\":0,\"width\":160,\"height\":80,\"label\":{\"text\":\"plan\"}},{\"type\":\"text\",\"id\":\"t\",\"x\":220,\"y\":28,\"text\":\"ship\"},{\"type\":\"arrow\",\"x\":160,\"y\":40,\"width\":60,\"height\":0,\"start\":{\"id\":\"a\"},\"end\":{\"id\":\"t\"}}]}\n```\n";
    call(
        Pads::open(dir.path(), Bus::new()).unwrap(),
        "pad.create",
        json!({"name": "notes", "text": text}),
    )
    .await;

    let reopened = Pads::open(dir.path(), Bus::new()).unwrap();
    let out = TempDir::new().unwrap();
    let target = out.path().join("notes.md");
    call(
        Pads::open(dir.path(), Bus::new()).unwrap(),
        "pad.export",
        json!({"name": "notes", "path": target}),
    )
    .await;
    call(
        Pads::open(dir.path(), Bus::new()).unwrap(),
        "pad.setStorage",
        json!({"files": true}),
    )
    .await;

    assert_eq!(std::fs::read_to_string(&target).unwrap(), text);
    assert_eq!(
        std::fs::read_to_string(dir.path().join("pads").join("notes.md")).unwrap(),
        text
    );
    assert_eq!(
        call(reopened, "pad.read", json!({"name": "notes"})).await["text"],
        text
    );
}

#[tokio::test]
async fn p12_a_pad_made_here_is_at_the_project_root_whatever_its_params_say() {
    let rig = Rig::new();
    let made = rig
        .ok(
            &agent("a"),
            "pad.create",
            json!({"name": "notes", "home": "r1"}),
        )
        .await;
    assert_eq!(made["home"], Value::Null);
}

#[tokio::test]
async fn p12_move_sets_the_home_once_and_other_writes_keep_it() {
    let rig = Rig::new();
    rig.create("notes", "x").await;
    let user = Actor::user();
    let mut events = rig.bus.subscribe();

    let moved = rig
        .ok(&user, "pad.move", json!({"name": "notes", "home": "r1"}))
        .await;
    assert_eq!(moved["home"], "r1");
    let EventData::PadChanged(changed) = events.try_recv().unwrap().data else {
        panic!("expected pad.changed");
    };
    assert_eq!(changed.name, "notes");
    let touches = rig.touches.history("pad:notes").unwrap().len();

    rig.ok(&user, "pad.move", json!({"name": "notes", "home": "r1"}))
        .await;
    assert!(events.try_recv().is_err());
    assert_eq!(rig.touches.history("pad:notes").unwrap().len(), touches);

    rig.ok(
        &agent("a"),
        "pad.write",
        json!({"name": "notes", "text": "y"}),
    )
    .await;
    rig.ok(
        &agent("b"),
        "pad.append",
        json!({"name": "notes", "text": "z"}),
    )
    .await;
    rig.ok(
        &user,
        "pad.setOwner",
        json!({"name": "notes", "owner": user}),
    )
    .await;
    assert_eq!(
        rig.ok(&user, "pad.read", json!({"name": "notes"})).await["home"],
        "r1"
    );
    let out = TempDir::new().unwrap();
    rig.ok(
        &user,
        "pad.export",
        json!({"name": "notes", "path": out.path().join("notes.md")}),
    )
    .await;
    rig.ok(&user, "pad.setStorage", json!({"files": true}))
        .await;
    assert_eq!(
        rig.ok(&user, "pad.list", json!(null)).await[0]["home"],
        "r1"
    );
    rig.ok(&user, "pad.setStorage", json!({"files": false}))
        .await;
    assert_eq!(
        rig.ok(&user, "pad.read", json!({"name": "notes"})).await["home"],
        "r1"
    );

    rig.ok(&user, "pad.move", json!({"name": "notes", "home": null}))
        .await;
    assert_eq!(
        rig.ok(&user, "pad.list", json!(null)).await[0]["home"],
        Value::Null
    );
}

#[tokio::test]
async fn p12_a_rejected_move_leaves_no_trace() {
    let rig = Rig::new();
    rig.create("notes", "x").await;
    let mut events = rig.bus.subscribe();
    let touches = rig.touches.history("pad:notes").unwrap().len();

    let by_agent = rig
        .fail(
            &agent("a"),
            "pad.move",
            json!({"name": "notes", "home": "r1"}),
        )
        .await;
    let unknown = rig
        .fail(
            &Actor::user(),
            "pad.move",
            json!({"name": "ghost", "home": "r1"}),
        )
        .await;
    let refused = rig
        .fail(
            &Actor::user(),
            "pad.move",
            json!({"name": "a/b", "home": "r1"}),
        )
        .await;

    assert_eq!(by_agent.code, code::FORBIDDEN);
    assert_eq!(unknown.code, code::NOT_FOUND);
    assert_eq!(refused.code, code::INVALID_PARAMS);
    assert!(events.try_recv().is_err());
    assert_eq!(rig.touches.history("pad:notes").unwrap().len(), touches);
}

#[tokio::test]
async fn p12_the_home_survives_open() {
    let rig = Rig::new();
    rig.create("notes", "x").await;
    rig.ok(
        &Actor::user(),
        "pad.move",
        json!({"name": "notes", "home": "r1"}),
    )
    .await;
    let Rig { dir, bus, .. } = rig;
    let reopened = Pads::open(dir.path(), bus.clone()).unwrap();
    let ctx = Ctx {
        actor: Actor::user(),
        bus,
        touches: Arc::new(Touches::in_memory().unwrap()),
    };
    let listed = reopened.call(&ctx, "pad.list", Value::Null).await.unwrap();
    assert_eq!(listed[0]["home"], "r1");
}

const DOC: &str = "# Notes\n\n## Plan\n- one\n\n### Detail\nmore\n\n## Done\n- x\n";

async fn section(rig: &Rig, who: &Actor, heading: &str, text: &str) -> Value {
    let params = json!({"name": "notes", "heading": heading, "text": text});
    rig.ok(who, "pad.appendSection", params).await
}

#[tokio::test]
async fn p15_appends_at_section_end() {
    let rig = Rig::new();
    rig.create("notes", DOC).await;
    let a = agent("a");

    let pad = section(&rig, &a, "Done", "- y\n").await;
    assert_eq!(pad["text"], DOC.replace("- x\n", "- x\n- y\n"));

    rig.create("tail", "## A\nx").await;
    let tail = rig
        .ok(
            &a,
            "pad.appendSection",
            json!({"name": "tail", "heading": "a", "text": "y"}),
        )
        .await;
    assert_eq!(tail["text"], "## A\nx\ny");

    let blank = rig
        .ok(
            &a,
            "pad.appendSection",
            json!({"name": "tail", "heading": "a", "text": "z\n\n"}),
        )
        .await;
    assert_eq!(blank["text"], "## A\nx\ny\nz\n");
}

#[tokio::test]
async fn p15_deeper_heading_stays_inside_section() {
    let rig = Rig::new();
    rig.create("notes", DOC).await;

    let pad = section(&rig, &agent("a"), "## Plan", "- two").await;

    assert_eq!(
        pad["text"],
        "# Notes\n\n## Plan\n- one\n\n### Detail\nmore\n- two\n\n## Done\n- x\n"
    );
    let inner = section(&rig, &agent("a"), "Detail", "deep").await;
    assert!(
        inner["text"]
            .as_str()
            .unwrap()
            .contains("more\n- two\ndeep\n\n## Done")
    );
}

#[tokio::test]
async fn p15_fenced_hash_is_no_heading() {
    let rig = Rig::new();
    rig.create(
        "notes",
        "## Plan\n```\n# not a heading\n```\nafter\n## Done\n",
    )
    .await;

    let pad = section(&rig, &agent("a"), "Plan", "added").await;
    assert_eq!(
        pad["text"],
        "## Plan\n```\n# not a heading\n```\nafter\nadded\n## Done\n"
    );
    let missing = rig
        .fail(
            &agent("a"),
            "pad.appendSection",
            json!({"name": "notes", "heading": "not a heading", "text": "x"}),
        )
        .await;
    assert_eq!(missing.code, code::INVALID_PARAMS);
}

#[tokio::test]
async fn p15_heading_match_ignores_case_and_space() {
    let rig = Rig::new();
    rig.create("notes", "## Plan  Ahead\n## Plan Ahead\n").await;
    let a = agent("a");

    for heading in ["  plan   ahead ", "PLAN AHEAD", "### Plan Ahead"] {
        section(&rig, &a, heading, "x").await;
    }

    let pad = rig.ok(&a, "pad.read", json!({"name": "notes"})).await;
    assert_eq!(pad["text"], "## Plan  Ahead\nx\nx\nx\n## Plan Ahead\n");
}

#[tokio::test]
async fn p15_missing_heading_lists_headings() {
    let rig = Rig::new();
    rig.create("notes", "# Notes\n## Plan\n## Done\n").await;
    rig.create("bare", "no headings").await;
    let a = agent("a");

    let err = rig
        .fail(
            &a,
            "pad.appendSection",
            json!({"name": "notes", "heading": "Risks", "text": "x"}),
        )
        .await;
    let bare = rig
        .fail(
            &a,
            "pad.appendSection",
            json!({"name": "bare", "heading": "Risks", "text": "x"}),
        )
        .await;
    let empty_heading = rig
        .fail(
            &a,
            "pad.appendSection",
            json!({"name": "notes", "heading": " # ", "text": "x"}),
        )
        .await;
    let empty_text = rig
        .fail(
            &a,
            "pad.appendSection",
            json!({"name": "notes", "heading": "Plan", "text": ""}),
        )
        .await;

    assert_eq!(err.code, code::INVALID_PARAMS);
    assert_eq!(
        err.message,
        r###"no heading "Risks" in pad notes; headings: "# Notes", "## Plan", "## Done""###
    );
    assert!(bare.message.ends_with("the pad has no headings"));
    assert_eq!(empty_heading.code, code::INVALID_PARAMS);
    assert_eq!(empty_text.code, code::INVALID_PARAMS);
    let pad = rig.ok(&a, "pad.read", json!({"name": "notes"})).await;
    assert_eq!(pad["revision"], 1);
}

#[tokio::test]
async fn p15_any_actor_appends_with_touch_and_event() {
    let rig = Rig::new();
    rig.create("notes", DOC).await;
    let mut events = rig.bus.subscribe();
    let b = agent("b");

    let denied = rig
        .fail(&b, "pad.write", json!({"name": "notes", "text": "x"}))
        .await;
    let pad = section(&rig, &b, "Plan", "- b").await;

    assert_eq!(denied.code, code::FORBIDDEN);
    assert_eq!(pad["revision"], 2);
    assert!(matches!(
        events.try_recv().unwrap().data,
        EventData::PadChanged(_)
    ));
    assert!(events.try_recv().is_err());
    let by_b = rig.touches.touched("b").unwrap();
    assert_eq!(by_b.len(), 1);
    assert_eq!(by_b[0].verb, Verb::Wrote);
    assert_eq!(by_b[0].item, "pad:notes");
}

#[tokio::test]
async fn p15_stale_revision_conflicts() {
    let rig = Rig::new();
    rig.create("notes", DOC).await;
    let a = agent("a");
    let send = |revision: u64| json!({"name": "notes", "heading": "Plan", "text": "x", "expectedRevision": revision});

    rig.ok(&a, "pad.appendSection", send(1)).await;
    let stale = rig.fail(&a, "pad.appendSection", send(1)).await;
    let ahead = rig.fail(&a, "pad.appendSection", send(9)).await;
    let current = rig.ok(&a, "pad.appendSection", send(2)).await;

    assert_eq!(stale.code, code::CONFLICT);
    assert!(stale.message.contains("revision 2"));
    assert_eq!(ahead.code, code::CONFLICT);
    assert_eq!(current["revision"], 3);
    assert!(current["text"].as_str().unwrap().contains("more\nx\nx\n"));
}

#[tokio::test]
async fn p15_two_writers_one_wins() {
    for order in [["a", "b"], ["b", "a"]] {
        let rig = Rig::new();
        rig.create("notes", DOC).await;
        let params = |who: &str| json!({"name": "notes", "heading": "Done", "text": who, "expectedRevision": 1});
        let first = rig
            .call(&agent(order[0]), "pad.appendSection", params(order[0]))
            .await;
        let second = rig
            .call(&agent(order[1]), "pad.appendSection", params(order[1]))
            .await;

        assert!(first.is_ok());
        assert_eq!(second.unwrap_err().code, code::CONFLICT);
        let pad = rig
            .ok(&agent("a"), "pad.read", json!({"name": "notes"}))
            .await;
        assert!(
            pad["text"]
                .as_str()
                .unwrap()
                .ends_with(&format!("- x\n{}\n", order[0]))
        );
    }
}

#[tokio::test]
async fn p15_rejected_call_leaves_no_trace() {
    for files in [false, true] {
        let rig = Rig::new();
        rig.create("notes", DOC).await;
        if files {
            rig.ok(&Actor::user(), "pad.setStorage", json!({"files": true}))
                .await;
        }
        let mut events = rig.bus.subscribe();
        let touches = rig.touches.history("pad:notes").unwrap().len();
        let a = agent("a");

        let unknown = rig
            .fail(
                &a,
                "pad.appendSection",
                json!({"name": "ghost", "heading": "Plan", "text": "x"}),
            )
            .await;
        let bad_name = rig
            .fail(
                &a,
                "pad.appendSection",
                json!({"name": "a/b", "heading": "Plan", "text": "x"}),
            )
            .await;
        let no_heading = rig
            .fail(
                &a,
                "pad.appendSection",
                json!({"name": "notes", "heading": "Risks", "text": "x"}),
            )
            .await;
        let stale = rig
            .fail(
                &a,
                "pad.appendSection",
                json!({"name": "notes", "heading": "Plan", "text": "x", "expectedRevision": 7}),
            )
            .await;

        assert_eq!(unknown.code, code::NOT_FOUND);
        assert_eq!(bad_name.code, code::INVALID_PARAMS);
        assert_eq!(no_heading.code, code::INVALID_PARAMS);
        assert_eq!(stale.code, code::CONFLICT);
        assert!(events.try_recv().is_err());
        assert_eq!(rig.touches.history("pad:notes").unwrap().len(), touches);
        let pad = rig.ok(&a, "pad.read", json!({"name": "notes"})).await;
        assert_eq!(
            (pad["text"].as_str().unwrap(), pad["revision"].clone()),
            (DOC, json!(1))
        );
        if files {
            assert_eq!(rig.file_text("notes.md"), DOC);
        }
    }
}

#[tokio::test]
async fn p15_file_storage_follows_the_section_append() {
    let rig = Rig::new();
    rig.create("notes", DOC).await;
    rig.ok(&Actor::user(), "pad.setStorage", json!({"files": true}))
        .await;

    let pad = section(&rig, &agent("a"), "Done", "- y").await;

    assert_eq!(rig.file_text("notes.md"), pad["text"].as_str().unwrap());
}

#[tokio::test]
async fn p15_revision_follows_text_changes() {
    let rig = Rig::new();
    rig.create("notes", "one").await;
    let (a, user) = (agent("a"), Actor::user());
    let revision = |pad: Value| pad["revision"].as_u64().unwrap();
    assert_eq!(
        revision(rig.ok(&a, "pad.read", json!({"name": "notes"})).await),
        1
    );

    let written = rig
        .ok(&a, "pad.write", json!({"name": "notes", "text": "two"}))
        .await;
    let same = rig
        .ok(&a, "pad.write", json!({"name": "notes", "text": "two"}))
        .await;
    let appended = rig
        .ok(&a, "pad.append", json!({"name": "notes", "text": "+"}))
        .await;
    let nothing = rig
        .ok(&a, "pad.append", json!({"name": "notes", "text": ""}))
        .await;
    let moved = rig
        .ok(&user, "pad.move", json!({"name": "notes", "home": "r1"}))
        .await;
    let handed = rig
        .ok(
            &user,
            "pad.setOwner",
            json!({"name": "notes", "owner": agent("b")}),
        )
        .await;

    assert_eq!(
        [written, same, appended, nothing, moved, handed].map(revision),
        [2, 2, 3, 3, 3, 3]
    );
}

#[tokio::test]
async fn p15_revision_survives_reopen() {
    let rig = Rig::new();
    rig.create("notes", "one").await;
    rig.ok(
        &agent("a"),
        "pad.append",
        json!({"name": "notes", "text": "+"}),
    )
    .await;
    let Rig { dir, bus, .. } = rig;
    let reopened = Pads::open(dir.path(), bus.clone()).unwrap();
    let ctx = Ctx {
        actor: Actor::user(),
        bus,
        touches: Arc::new(Touches::in_memory().unwrap()),
    };

    let listed = reopened.call(&ctx, "pad.list", Value::Null).await.unwrap();

    assert_eq!(listed[0]["revision"], 2);
}

#[tokio::test]
async fn p15_a_pad_stored_before_revisions_reads_revision_1() {
    let rig = Rig::new();
    rig.store_row("old");

    let pad = rig
        .ok(&agent("a"), "pad.read", json!({"name": "old"}))
        .await;

    assert_eq!(pad["revision"], 1);
}

#[tokio::test]
async fn p2544d_write_revision_guard() {
    for files in [false, true] {
        let rig = Rig::new();
        rig.create("notes", "original").await;
        rig.ok(&Actor::user(), "pad.setStorage", json!({"files": files}))
            .await;
        let a = agent("a");
        let incarnation = rig.ok(&a, "pad.list", json!({})).await[0]["incarnation"].clone();
        let mut accepted_events = rig.bus.subscribe();
        let written = rig.ok(
            &a,
            "pad.write",
            json!({"name": "notes", "text": "winner", "expectedRevision": 1, "expectedIncarnation": incarnation}),
        )
        .await;
        assert_eq!(written["incarnation"], incarnation);
        assert_eq!(written["revision"], 2);
        assert!(matches!(
            accepted_events.try_recv().unwrap().data,
            EventData::PadChanged(_)
        ));
        assert!(accepted_events.try_recv().is_err());
        let before = rig.ok(&a, "pad.list", json!({})).await;
        let touches = rig.touches.history("pad:notes").unwrap();
        let mut events = rig.bus.subscribe();
        let error = rig
            .fail(
                &a,
                "pad.write",
                json!({"name": "notes", "text": "loser", "expectedRevision": 1, "expectedIncarnation": incarnation}),
            )
            .await;
        assert_eq!(error.code, code::CONFLICT);
        assert!(error.message.contains("revision 2"));
        assert_eq!(rig.ok(&a, "pad.list", json!({})).await, before);
        assert_eq!(
            rig.touches.history("pad:notes").unwrap().len(),
            touches.len()
        );
        assert!(events.try_recv().is_err());
        if files {
            assert_eq!(rig.file_text("notes.md"), "winner");
            assert_eq!(
                std::fs::read_dir(rig.dir.path().join("pads"))
                    .unwrap()
                    .count(),
                1
            );
        }
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn p2544d_two_connections_have_one_winner() {
    for files in [false, true] {
        let rig = Rig::new();
        rig.create("notes", "original").await;
        rig.ok(&Actor::user(), "pad.setStorage", json!({"files": files}))
            .await;
        let incarnation =
            rig.ok(&agent("a"), "pad.list", json!({})).await[0]["incarnation"].clone();
        let stores = [
            Pads::open(rig.dir.path(), rig.bus.clone()).unwrap(),
            Pads::open(rig.dir.path(), rig.bus.clone()).unwrap(),
        ];
        let barrier = std::sync::Barrier::new(2);
        let runtime = tokio::runtime::Handle::current();
        let results = std::thread::scope(|scope| {
            let calls: Vec<_> = stores
                .iter()
                .zip(["first", "second"])
                .map(|(pads, text)| {
                    let ctx = Ctx {
                        actor: agent("a"),
                        bus: rig.bus.clone(),
                        touches: rig.touches.clone(),
                    };
                    let incarnation = incarnation.clone();
                    let barrier = &barrier;
                    let runtime = &runtime;
                    scope.spawn(move || {
                        barrier.wait();
                        runtime.block_on(pads.call(
                            &ctx,
                            "pad.write",
                            json!({"name": "notes", "text": text, "expectedRevision": 1, "expectedIncarnation": incarnation}),
                        ))
                    })
                })
                .collect();
            calls
                .into_iter()
                .map(|call| call.join().unwrap())
                .collect::<Vec<_>>()
        });
        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        assert_eq!(
            results
                .iter()
                .find_map(|result| result.as_ref().err())
                .unwrap()
                .code,
            code::CONFLICT
        );
        let winner = results.into_iter().find_map(Result::ok).unwrap();
        assert_eq!(rig.ok(&agent("a"), "pad.list", json!({})).await[0], winner);
        if files {
            assert_eq!(rig.file_text("notes.md"), winner["text"].as_str().unwrap());
        }
    }
}

#[tokio::test]
async fn p2544d_guard_preserves_validation_and_authorization() {
    let rig = Rig::new();
    rig.create("notes", "original").await;
    for (who, name, expected) in [
        (agent("b"), "notes", code::FORBIDDEN),
        (agent("a"), "missing", code::NOT_FOUND),
        (agent("a"), "../notes", code::INVALID_PARAMS),
    ] {
        let error = rig
            .fail(
                &who,
                "pad.write",
                json!({"name": name, "text": "refused", "expectedRevision": 99}),
            )
            .await;
        assert_eq!(error.code, expected);
    }
}
