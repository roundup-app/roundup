//! SK10: `skill.status`, `skill.setup` and `skill.remove` call the Adapter's `Install` and keep
//! nothing; the files are the state.

use agents::claude_code::skill_setup::Install;
use contracts::ActorKind;
use contracts::skill::{SkillItem, SkillSetup};
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
    rpc::reply(&SkillSetup {
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
