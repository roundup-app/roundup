//! U7889: a click runs a command an Agent printed, in a shell the Agent owns.

use super::*;
use std::collections::BTreeMap;

impl Agents {
    /// U7889a: what Agent `id` printed as shell commands, read from its conversation record; none
    /// while it has no saved conversation.
    pub(super) fn printed_commands(&self, id: &str) -> Result<Vec<String>, RpcError> {
        let saved = self
            .shared
            .rail()
            .conversation(crate::rail::agent_id(id)?)?;
        match saved {
            Some((conversation, cwd)) => self
                .launcher
                .printed_commands(std::path::Path::new(&cwd), &conversation),
            None => Ok(Vec::new()),
        }
    }

    /// U7889c: type `command` and Enter into a login shell of Agent `id` whose prompt is free, else
    /// into a new one in its Worktree, else its folder. Claiming the shell and choosing it are one
    /// step, so two quick calls never share a busy shell. Only a command the Agent printed runs.
    pub(super) async fn run_printed(
        &self,
        ctx: &Ctx,
        params: contracts::agent::RunPrintedParams,
    ) -> Result<Opened, RpcError> {
        let contracts::agent::RunPrintedParams { id, command } = params;
        let node = self.shared.rail().node(crate::rail::agent_id(&id)?)?;
        if node.kind() != NodeKind::Agent {
            return Err(RpcError::new(
                code::INVALID_PARAMS,
                format!("{id} is not an Agent"),
            ));
        }
        if !self.printed_commands(&id)?.contains(&command) {
            return Err(RpcError::new(
                code::INVALID_PARAMS,
                "that command is not one the Agent printed",
            ));
        }
        let terminals = &self.shared.terminals;
        let target = match terminals.claim_free_shell(&id) {
            Some(free) => free,
            None => {
                let cwd = node
                    .worktree()
                    .map(|worktree| worktree.path)
                    .unwrap_or_else(|| self.project_dir().to_string_lossy().into_owned());
                let shell = self.shared.shell.clone();
                let opened = terminals
                    .spawn_shell_owned(&cwd, &shell, &id, BTreeMap::new(), (80, 24))
                    .await?;
                opened.id
            }
        };
        terminals
            .write(&target, format!("{command}\r").as_bytes())
            .await?;
        ctx.touch(contracts::Verb::Wrote, &format!("agent:{id}"))?;
        Ok(Opened {
            terminal_id: target,
        })
    }
}
