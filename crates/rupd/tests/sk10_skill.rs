//! SK10: the three methods call the Adapter against a temporary config folder.

use agents::claude_code::skill_setup::Install;
use rupd::skill::skill_call;
use serde_json::Value;

fn states(answer: &Value) -> Vec<(String, String)> {
    answer["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| {
            (
                i["item"].as_str().unwrap().to_owned(),
                i["state"].as_str().unwrap().to_owned(),
            )
        })
        .collect()
}

#[test]
fn sk10_skill_status_setup_and_remove_call_the_adapter() {
    let dir = tempfile::tempdir().unwrap();
    let config = dir.path().join(".claude");
    std::fs::create_dir(&config).unwrap();
    let install = Install::from_vars(
        |name| (name == "CLAUDE_CONFIG_DIR").then(|| config.clone().into_os_string()),
        &dir.path().join("rup"),
    )
    .unwrap();
    let pair = |a: &str, b: &str| vec![("skill".into(), a.into()), ("hook".into(), b.into())];

    let status = skill_call(&install, "skill.status").unwrap();
    assert_eq!(states(&status), pair("missing", "missing"));
    assert!(!config.join("skills/roundup/SKILL.md").exists());

    let setup = skill_call(&install, "skill.setup").unwrap();
    assert_eq!(states(&setup), pair("installed", "installed"));
    assert!(config.join("skills/roundup/SKILL.md").exists());
    assert_eq!(
        states(&skill_call(&install, "skill.status").unwrap()),
        pair("current", "current")
    );

    let removed = skill_call(&install, "skill.remove").unwrap();
    assert_eq!(states(&removed), pair("removed", "removed"));
    assert!(!config.join("skills/roundup/SKILL.md").exists());

    std::fs::create_dir_all(config.join("skills/roundup")).unwrap();
    std::fs::write(config.join("skills/roundup/SKILL.md"), "mine").unwrap();
    let refused = skill_call(&install, "skill.setup").unwrap();
    assert_eq!(states(&refused)[0], ("skill".into(), "foreign".into()));
    assert_eq!(
        std::fs::read_to_string(config.join("skills/roundup/SKILL.md")).unwrap(),
        "mine"
    );
}
