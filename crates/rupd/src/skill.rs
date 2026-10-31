//! SK10: `skill.status`, `skill.setup` and `skill.remove` call the Adapter's `Install` and keep
//! nothing; the files are the state.

use agents::claude_code::skill_setup::Install;
use contracts::ActorKind;
use contracts::skill::{SkillFiles, SkillItem};
use rpc::RpcError;
use serde_json::Value;

use crate::{Conn, Daemon};

/// The Adapter's answer to one method. A refused item is an outcome in the answer; a failed write
/// is an error naming the path and the system's reason (SK11).
pub fn skill_call(install: &Install, method: &str) -> Result<Value, RpcError> {
    let items = match method {
        "skill.status" => install
            .status()
            .into_iter()
            .map(|r| (r.item, r.state.as_str(), r.path))
            .collect::<Vec<_>>(),
        _ => {
            let plan = if method == "skill.setup" {
                install.plan_setup()
            } else {
                install.plan_remove()
            };
            plan.apply()
                .map_err(|err| RpcError::internal(err.to_string()))?
                .into_iter()
                .map(|p| (p.item, p.outcome.as_str(), p.path))
                .collect()
        }
    };
    rpc::reply(&SkillFiles {
        items: items
            .into_iter()
            .map(|(item, state, path)| SkillItem {
                item: item.as_str().to_owned(),
                state: state.to_owned(),
                path: path.display().to_string(),
            })
            .collect(),
    })
}

impl Daemon {
    pub(super) fn skill(&self, conn: &Conn, method: &str) -> Result<Value, RpcError> {
        if conn.actor.kind != ActorKind::User {
            return Err(RpcError::forbidden(
                "only the user changes what is installed in their Claude Code folder",
            ));
        }
        let rup = std::env::current_exe()
            .ok()
            .and_then(|exe| Some(exe.parent()?.join("rup")))
            .unwrap_or_else(|| "rup".into());
        let install =
            Install::from_vars(|name| std::env::var_os(name), &rup).map_err(RpcError::internal)?;
        skill_call(&install, method)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
