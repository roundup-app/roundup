//! A36, A37, M12: which Model and Effort an Agent starts on. The lists are the Adapter's; here an
//! id is opaque (P4).

use contracts::project::{Choice, ModelList, ProjectModels};
use rpc::{RpcError, code};

use crate::claude_code::{self, Pair, Role};

fn choices(table: &[(&str, &str)]) -> Vec<Choice> {
    table
        .iter()
        .map(|&(id, label)| Choice {
            id: id.to_owned(),
            label: label.to_owned(),
        })
        .collect()
}

/// `models.list`: what the Adapter offers.
pub fn list() -> ModelList {
    ModelList {
        models: choices(claude_code::models()),
        efforts: choices(claude_code::efforts()),
    }
}

fn invalid(message: String) -> RpcError {
    RpcError::new(code::INVALID_PARAMS, message)
}

/// An id the Adapter does not list is `INVALID_PARAMS` naming it.
pub fn check_listed(model: Option<&str>, effort: Option<&str>) -> Result<(), RpcError> {
    let ModelList { models, efforts } = list();
    for (what, id, listed) in [("model", model, models), ("effort", effort, efforts)] {
        if let Some(id) = id
            && !listed.iter().any(|choice| choice.id == id)
        {
            return Err(invalid(format!(
                "{what} {id:?} is not one the Adapter lists"
            )));
        }
    }
    Ok(())
}

/// M12: an Agent's call may not set an Effort; only the user does. Its `model` is checked as any
/// call's is, against the Adapter's list.
pub fn check_agents_choice(effort: Option<&str>) -> Result<(), RpcError> {
    if effort.is_some() {
        return Err(invalid("only the user sets an effort: omit effort".into()));
    }
    Ok(())
}

/// `project.setModels`: every role is a known Role once, and every id is one the Adapter lists.
pub fn check_settings(settings: &ProjectModels) -> Result<(), RpcError> {
    let mut seen = Vec::new();
    for entry in &settings.roles {
        if !Role::ALL.iter().any(|role| role.id() == entry.role) {
            return Err(invalid(format!("{:?} is not a role", entry.role)));
        }
        if seen.contains(&entry.role.as_str()) {
            return Err(invalid(format!("role {:?} appears twice", entry.role)));
        }
        seen.push(entry.role.as_str());
        check_listed(entry.model.as_deref(), entry.effort.as_deref())?;
    }
    Ok(())
}

/// M2219: whether Agents launch with the roundup MCP server: the Daemon's `ROUNDUP_MCP=off` turns it
/// off for every Project, and any other value, or none, leaves the Project's own value in force.
pub fn mcp_on(env: Option<&std::ffi::OsStr>, project: bool) -> bool {
    project && env != Some(std::ffi::OsStr::new("off"))
}

/// A36: for each of Model and Effort, the call's own, else the Project's for `role`, else none.
pub fn resolve(
    project: &ProjectModels,
    role: Role,
    model: Option<String>,
    effort: Option<String>,
) -> Pair {
    let own = project.roles.iter().find(|entry| entry.role == role.id());
    Pair {
        yolo: false,
        model: model.or_else(|| own.and_then(|entry| entry.model.clone())),
        effort: effort.or_else(|| own.and_then(|entry| entry.effort.clone())),
        mcp_off: false,
        lean: None,
    }
}

#[cfg(test)]
mod tests {
    use contracts::project::RoleModels;

    use super::*;

    fn project() -> ProjectModels {
        ProjectModels {
            roles: vec![RoleModels {
                role: "subagent".into(),
                model: Some("haiku".into()),
                effort: Some("low".into()),
            }],
        }
    }

    #[test]
    fn a_call_sets_each_half_apart() {
        let pair = resolve(&project(), Role::Agent, Some("opus".into()), None);
        assert_eq!(pair.model.as_deref(), Some("opus"));
        assert_eq!(pair.effort.as_deref(), Some("low"));
    }

    #[test]
    fn a_role_never_set_resolves_to_none() {
        assert_eq!(resolve(&project(), Role::Door, None, None), Pair::default());
    }
}
