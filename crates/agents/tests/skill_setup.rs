//! SK1–SK6: the skill and hook installed in a temporary config folder.

use std::collections::BTreeMap;
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};

use agents::claude_code::skill_setup::{Install, Item, ItemState, Outcome};
use serde_json::{Value, json};

const RUP: &str = "/opt/roundup/rup";

fn install(config: &Path) -> Install {
    let vars = config.to_owned();
    Install::from_vars(
        move |name| (name == "CLAUDE_CONFIG_DIR").then(|| OsString::from(&vars)),
        Path::new(RUP),
    )
    .unwrap()
}

fn setup(i: &Install) -> Vec<(Item, Outcome)> {
    i.plan_setup()
        .apply()
        .unwrap()
        .into_iter()
        .map(|p| (p.item, p.outcome))
        .collect()
}

fn remove(i: &Install) -> Vec<(Item, Outcome)> {
    i.plan_remove()
        .apply()
        .unwrap()
        .into_iter()
        .map(|p| (p.item, p.outcome))
        .collect()
}

fn states(i: &Install) -> Vec<ItemState> {
    i.status().into_iter().map(|r| r.state).collect()
}

fn settings(config: &Path) -> Value {
    serde_json::from_str(&fs::read_to_string(config.join("settings.json")).unwrap()).unwrap()
}

const USERS: &str = r#"{
  "model": "opus",
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "say done"
          }
        ]
      }
    ],
    "Notification": []
  },
  "extra": {
    "unknown": [
      1,
      2
    ]
  }
}
"#;

#[test]
fn sk1_setup_writes_the_skill_and_one_hook_per_event() {
    let dir = tempfile::tempdir().unwrap();
    let i = install(dir.path());
    assert_eq!(
        setup(&i),
        [
            (Item::Skill, Outcome::Installed),
            (Item::Hook, Outcome::Installed)
        ]
    );
    let skill = fs::read_to_string(dir.path().join("skills/roundup/SKILL.md")).unwrap();
    assert!(skill.contains("roundup-skill: 1\n"));
    let hooks = &settings(dir.path())["hooks"];
    let events: Vec<_> = hooks.as_object().unwrap().keys().cloned().collect();
    assert_eq!(
        events,
        [
            "SessionStart",
            "UserPromptSubmit",
            "PermissionRequest",
            "PreToolUse",
            "Stop",
            "SessionEnd"
        ]
    );
    for list in hooks.as_object().unwrap().values() {
        let command = list[0]["hooks"][0]["command"].as_str().unwrap();
        assert!(
            command.starts_with("/opt/roundup/rup skill report --state "),
            "{command}"
        );
        assert_eq!(list.as_array().unwrap().len(), 1);
    }
    assert_eq!(hooks["PreToolUse"][0]["matcher"], "AskUserQuestion");
    assert_eq!(states(&i), [ItemState::Current, ItemState::Current]);
}

#[test]
fn sk1_a_missing_settings_file_and_folders_are_created() {
    let dir = tempfile::tempdir().unwrap();
    let config = dir.path().join("a/b/.claude");
    let bin = dir.path().join("bin");
    fs::create_dir_all(&bin).unwrap();
    fs::write(bin.join("claude"), "").unwrap();
    let vars = [
        ("CLAUDE_CONFIG_DIR", config.clone().into()),
        ("PATH", bin.into()),
    ];
    with_vars(&vars, Path::new(RUP))
        .plan_setup()
        .apply()
        .unwrap();
    assert!(config.join("skills/roundup/SKILL.md").is_file());
    assert!(config.join("settings.json").is_file());

    // A settings file without `hooks`, and one with `hooks` but no event list, gain them.
    for original in [r#"{"model":"x"}"#, r#"{"hooks":{"Other":[]}}"#] {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("settings.json"), original).unwrap();
        setup(&install(dir.path()));
        assert!(settings(dir.path())["hooks"].as_object().unwrap().len() >= 6);
    }
}

#[test]
fn sk1_a_symlinked_settings_file_stays_a_link() {
    let dir = tempfile::tempdir().unwrap();
    let real = dir.path().join("dotfiles/settings.json");
    fs::create_dir_all(real.parent().unwrap()).unwrap();
    fs::write(&real, "{}\n").unwrap();
    let config = dir.path().join("config");
    fs::create_dir_all(&config).unwrap();
    std::os::unix::fs::symlink(&real, config.join("settings.json")).unwrap();
    setup(&install(&config));
    assert!(
        fs::symlink_metadata(config.join("settings.json"))
            .unwrap()
            .file_type()
            .is_symlink()
    );
    assert!(fs::read_to_string(&real).unwrap().contains("skill report"));
}

#[test]
fn sk1_a_failed_write_leaves_the_earlier_file() {
    let dir = tempfile::tempdir().unwrap();
    let config = dir.path().join("config");
    fs::create_dir_all(&config).unwrap();
    fs::write(config.join("settings.json"), USERS).unwrap();
    let plan = install(&config).plan_setup();
    // Read-only folders do not stop root.
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(&config, fs::Permissions::from_mode(0o555)).unwrap();
    let blocked = fs::File::create(config.join("probe")).is_err();
    let result = plan.apply();
    fs::set_permissions(&config, fs::Permissions::from_mode(0o755)).unwrap();
    if blocked {
        assert!(result.is_err());
        assert_eq!(
            fs::read_to_string(config.join("settings.json")).unwrap(),
            USERS
        );
    }
}

#[test]
fn sk2_other_settings_hooks_and_order_survive_setup() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("settings.json"), USERS).unwrap();
    setup(&install(dir.path()));
    let after = settings(dir.path());
    let before: Value = serde_json::from_str(USERS).unwrap();
    let keys: Vec<_> = after.as_object().unwrap().keys().collect();
    assert_eq!(keys, ["model", "hooks", "extra"]);
    assert_eq!(after["model"], before["model"]);
    assert_eq!(after["extra"], before["extra"]);
    let stop = after["hooks"]["Stop"].as_array().unwrap();
    assert_eq!(stop[0], before["hooks"]["Stop"][0]);
    assert_eq!(stop.len(), 2);
    assert!(
        stop[1]["hooks"][0]["command"]
            .as_str()
            .unwrap()
            .contains("skill report")
    );
    assert_eq!(after["hooks"]["Notification"], json!([]));
}

#[test]
fn sk2_setup_then_remove_restores_the_bytes() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("settings.json");
    fs::write(&file, USERS).unwrap();
    let i = install(dir.path());
    setup(&i);
    remove(&i);
    assert_eq!(fs::read_to_string(&file).unwrap(), USERS);
    assert!(!dir.path().join("skills/roundup").exists());

    // Other formatting comes back equal as a value, keys in order.
    let other = "{\n    \"b\": 1,\n    \"a\": {\"hooks\": 2}\n}";
    fs::write(&file, other).unwrap();
    setup(&i);
    remove(&i);
    assert_eq!(
        fs::read_to_string(&file)
            .unwrap()
            .replace(char::is_whitespace, ""),
        other.replace(char::is_whitespace, "")
    );

    // An emptied file stays as `{}`.
    fs::write(&file, "{}\n").unwrap();
    setup(&i);
    remove(&i);
    assert_eq!(fs::read_to_string(&file).unwrap(), "{}\n");
}

#[test]
fn sk2_a_rerun_writes_nothing_and_says_unchanged() {
    let dir = tempfile::tempdir().unwrap();
    let i = install(dir.path());
    setup(&i);
    let files = [
        dir.path().join("settings.json"),
        dir.path().join("skills/roundup/SKILL.md"),
    ];
    let before: Vec<_> = files
        .iter()
        .map(|f| {
            (
                fs::read(f).unwrap(),
                fs::metadata(f).unwrap().modified().unwrap(),
            )
        })
        .collect();
    std::thread::sleep(std::time::Duration::from_millis(20));
    assert_eq!(
        setup(&i),
        [
            (Item::Skill, Outcome::Unchanged),
            (Item::Hook, Outcome::Unchanged)
        ]
    );
    let after: Vec<_> = files
        .iter()
        .map(|f| {
            (
                fs::read(f).unwrap(),
                fs::metadata(f).unwrap().modified().unwrap(),
            )
        })
        .collect();
    assert_eq!(before, after);
}

#[test]
fn sk2_an_unreadable_settings_file_is_never_rewritten() {
    for bad in [
        "{not json",
        "[]",
        r#"{"hooks":[]}"#,
        r#"{"hooks":{"Stop":{}}}"#,
        "",
    ] {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("settings.json"), bad).unwrap();
        let i = install(dir.path());
        assert_eq!(states(&i)[1], ItemState::Unreadable, "{bad}");
        assert_eq!(setup(&i)[1], (Item::Hook, Outcome::Unreadable));
        assert_eq!(remove(&i)[1], (Item::Hook, Outcome::Unreadable));
        assert_eq!(
            fs::read_to_string(dir.path().join("settings.json")).unwrap(),
            bad
        );
    }
}

fn with_vars(pairs: &[(&'static str, OsString)], rup: &Path) -> Install {
    let pairs = pairs.to_vec();
    Install::from_vars(
        move |name| {
            pairs
                .iter()
                .find(|(k, _)| *k == name)
                .map(|(_, v)| v.clone())
        },
        rup,
    )
    .unwrap()
}

#[test]
fn sk3_the_config_folder_follows_the_variable() {
    let dir = tempfile::tempdir().unwrap();
    let home = dir.path().join("home");
    let custom = dir.path().join("custom");
    fs::create_dir_all(home.join(".claude")).unwrap();
    fs::create_dir_all(&custom).unwrap();
    let h = || ("HOME", OsString::from(&home));
    with_vars(
        &[h(), ("CLAUDE_CONFIG_DIR", custom.clone().into())],
        Path::new(RUP),
    )
    .plan_setup()
    .apply()
    .unwrap();
    assert!(custom.join("skills/roundup/SKILL.md").is_file());
    assert!(!home.join(".claude/skills").exists());
    for vars in [vec![h()], vec![h(), ("CLAUDE_CONFIG_DIR", OsString::new())]] {
        with_vars(&vars, Path::new(RUP))
            .plan_setup()
            .apply()
            .unwrap();
        assert!(home.join(".claude/skills/roundup/SKILL.md").is_file());
        fs::remove_dir_all(home.join(".claude/skills")).unwrap();
    }
}

#[test]
fn sk3_a_foreign_skill_is_refused_and_nothing_is_written() {
    let dir = tempfile::tempdir().unwrap();
    let skill = dir.path().join("skills/roundup/SKILL.md");
    fs::create_dir_all(skill.parent().unwrap()).unwrap();
    fs::write(&skill, "---\nname: roundup\n---\nmine\n").unwrap();
    let i = install(dir.path());
    assert_eq!(setup(&i)[0], (Item::Skill, Outcome::Foreign));
    assert_eq!(
        fs::read_to_string(&skill).unwrap(),
        "---\nname: roundup\n---\nmine\n"
    );
    assert!(!dir.path().join("settings.json").exists());
    assert_eq!(remove(&i)[0], (Item::Skill, Outcome::Foreign));
    assert!(skill.exists());
}

#[test]
fn sk3_force_replaces_a_foreign_skill() {
    let dir = tempfile::tempdir().unwrap();
    let skill = dir.path().join("skills/roundup/SKILL.md");
    fs::create_dir_all(skill.parent().unwrap()).unwrap();
    fs::write(&skill, "mine\n").unwrap();
    let i = install(dir.path()).force(true);
    assert_eq!(setup(&i)[0], (Item::Skill, Outcome::Updated));
    assert!(
        fs::read_to_string(&skill)
            .unwrap()
            .contains("roundup-skill: 1")
    );
    // A marked folder with edited content is roundup's own.
    fs::write(&skill, "---\nroundup-skill: 1\n---\nedited\n").unwrap();
    assert_eq!(states(&install(dir.path()))[0], ItemState::Outdated);
}

#[test]
fn sk4_each_state_is_reported_for_each_item() {
    let dir = tempfile::tempdir().unwrap();
    let config = dir.path().join("c");
    fs::create_dir_all(&config).unwrap();
    let i = install(&config);
    assert_eq!(states(&i), [ItemState::Missing, ItemState::Missing]);
    setup(&i);
    assert_eq!(states(&i), [ItemState::Current, ItemState::Current]);

    // Outdated: edited skill, hook on only some events.
    let skill = config.join("skills/roundup/SKILL.md");
    fs::write(&skill, "---\nroundup-skill: 0\n---\nold\n").unwrap();
    let mut doc = settings(&config);
    doc["hooks"].as_object_mut().unwrap().shift_remove("Stop");
    fs::write(config.join("settings.json"), doc.to_string()).unwrap();
    assert_eq!(states(&i), [ItemState::Outdated, ItemState::Outdated]);

    // Foreign skill, unreadable hook.
    fs::write(&skill, "mine").unwrap();
    fs::write(config.join("settings.json"), "{").unwrap();
    assert_eq!(states(&i), [ItemState::Foreign, ItemState::Unreadable]);
}

#[test]
fn sk4_a_moved_rup_makes_the_hook_outdated() {
    let dir = tempfile::tempdir().unwrap();
    setup(&install(dir.path()));
    let moved = Install::from_vars(
        |name| (name == "CLAUDE_CONFIG_DIR").then(|| dir.path().into()),
        Path::new("/elsewhere/rup"),
    )
    .unwrap();
    assert_eq!(states(&moved), [ItemState::Current, ItemState::Outdated]);
    assert_eq!(
        moved.plan_setup().apply().unwrap()[1].outcome,
        Outcome::Updated
    );
    let doc = settings(dir.path());
    assert_eq!(doc["hooks"]["Stop"].as_array().unwrap().len(), 1);
    assert!(doc.to_string().contains("/elsewhere/rup skill report"));
    assert!(!doc.to_string().contains("/opt/roundup/rup"));
}

#[test]
fn sk4_no_claude_reports_unsupported_and_setup_writes_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let config = dir.path().join("absent");
    let i = install(&config);
    assert_eq!(states(&i), [ItemState::Unsupported, ItemState::Unsupported]);
    assert_eq!(
        setup(&i),
        [
            (Item::Skill, Outcome::Unsupported),
            (Item::Hook, Outcome::Unsupported)
        ]
    );
    assert_eq!(remove(&i)[0].1, Outcome::Unsupported);
    assert!(!config.exists());

    // A `claude` on PATH makes it supported.
    let bin = dir.path().join("bin");
    fs::create_dir_all(&bin).unwrap();
    fs::write(bin.join("claude"), "").unwrap();
    let i = with_vars(
        &[
            ("CLAUDE_CONFIG_DIR", config.clone().into()),
            ("PATH", bin.into()),
        ],
        Path::new(RUP),
    );
    assert_eq!(states(&i), [ItemState::Missing, ItemState::Missing]);
}

#[test]
fn sk5_remove_takes_only_marked_items() {
    let dir = tempfile::tempdir().unwrap();
    let i = install(dir.path());
    assert_eq!(
        remove(&i),
        [
            (Item::Skill, Outcome::Missing),
            (Item::Hook, Outcome::Missing)
        ]
    );
    setup(&i);
    assert_eq!(
        remove(&i),
        [
            (Item::Skill, Outcome::Removed),
            (Item::Hook, Outcome::Removed)
        ]
    );
    assert!(!dir.path().join("skills/roundup").exists());
    assert_eq!(
        fs::read_to_string(dir.path().join("settings.json")).unwrap(),
        "{}\n"
    );
}

#[test]
fn sk5_a_foreign_skill_and_the_users_hooks_stay() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("settings.json"), USERS).unwrap();
    let i = install(dir.path());
    setup(&i);
    // The user's other skill is untouched.
    fs::create_dir_all(dir.path().join("skills/other")).unwrap();
    fs::write(dir.path().join("skills/other/SKILL.md"), "x").unwrap();
    remove(&i);
    assert_eq!(
        settings(dir.path()),
        serde_json::from_str::<Value>(USERS).unwrap()
    );
    assert!(dir.path().join("skills/other/SKILL.md").is_file());
}

#[test]
fn sk5_extra_files_in_the_skill_folder_stay() {
    let dir = tempfile::tempdir().unwrap();
    let i = install(dir.path());
    setup(&i);
    let folder = dir.path().join("skills/roundup");
    fs::write(folder.join("notes.md"), "mine").unwrap();
    remove(&i);
    assert!(!folder.join("SKILL.md").exists());
    assert_eq!(fs::read_to_string(folder.join("notes.md")).unwrap(), "mine");
}

#[test]
fn sk5_a_second_remove_changes_nothing() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("settings.json"), USERS).unwrap();
    let i = install(dir.path());
    setup(&i);
    remove(&i);
    let before = snapshot(dir.path());
    assert_eq!(
        remove(&i),
        [
            (Item::Skill, Outcome::Missing),
            (Item::Hook, Outcome::Missing)
        ]
    );
    assert_eq!(snapshot(dir.path()), before);
}

/// Every path under `root` with its bytes, mode and modification time.
fn snapshot(root: &Path) -> BTreeMap<PathBuf, (Option<Vec<u8>>, u32, std::time::SystemTime)> {
    use std::os::unix::fs::PermissionsExt;
    let mut out = BTreeMap::new();
    let mut stack = vec![root.to_owned()];
    while let Some(path) = stack.pop() {
        let meta = fs::symlink_metadata(&path).unwrap();
        let bytes = meta.is_file().then(|| fs::read(&path).unwrap());
        if meta.is_dir() {
            stack.extend(fs::read_dir(&path).unwrap().map(|e| e.unwrap().path()));
        }
        out.insert(
            path,
            (bytes, meta.permissions().mode(), meta.modified().unwrap()),
        );
    }
    out
}

#[test]
fn sk6_a_plan_changes_nothing_and_applying_it_has_the_planned_outcomes() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("settings.json"), USERS).unwrap();
    let i = install(dir.path());
    for remove_plan in [false, true, false] {
        let before = snapshot(dir.path());
        let plan = if remove_plan {
            i.plan_remove()
        } else {
            i.plan_setup()
        };
        assert_eq!(snapshot(dir.path()), before);
        assert!(plan.entries.iter().all(|e| e.path.starts_with(dir.path())));
        assert_eq!(plan.apply().unwrap(), plan.entries);
    }
    assert_eq!(states(&i), [ItemState::Current, ItemState::Current]);
}
