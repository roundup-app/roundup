//! Stored Project configuration for Worktrees, MCP and Models.
use super::*;

impl Rail {
    /// The Project's `worktrees` setting; `{on: false, check: null}` for a Project that never
    /// had it set (G1).
    pub fn get_worktrees(&self) -> Result<Worktrees, RpcError> {
        self.db
            .query_row(
                "SELECT worktrees_on, worktrees_check FROM settings WHERE id = 0",
                [],
                |row| {
                    Ok(Worktrees {
                        on: row.get(0)?,
                        check: row.get(1)?,
                    })
                },
            )
            .optional()
            .map_err(sql)
            .map(|found| {
                found.unwrap_or(Worktrees {
                    on: false,
                    check: None,
                })
            })
    }

    pub fn set_worktrees(&mut self, worktrees: &Worktrees) -> Result<(), RpcError> {
        self.db
            .execute(
                "INSERT INTO settings (id, worktrees_on, worktrees_check) VALUES (0, ?, ?)
                 ON CONFLICT (id) DO UPDATE SET worktrees_on = excluded.worktrees_on,
                    worktrees_check = excluded.worktrees_check",
                params![worktrees.on, worktrees.check],
            )
            .map_err(sql)?;
        Ok(())
    }

    /// M2219: the Project's `mcp` setting; `{on: true}` for a Project that never set it.
    pub fn get_mcp(&self) -> Result<Mcp, RpcError> {
        self.db
            .query_row("SELECT mcp_on FROM settings WHERE id = 0", [], |row| {
                Ok(Mcp { on: row.get(0)? })
            })
            .optional()
            .map_err(sql)
            .map(|found| found.unwrap_or(Mcp { on: true }))
    }

    pub fn set_mcp(&mut self, mcp: &Mcp) -> Result<(), RpcError> {
        self.db
            .execute(
                "INSERT INTO settings (id, mcp_on) VALUES (0, ?)
                 ON CONFLICT (id) DO UPDATE SET mcp_on = excluded.mcp_on",
                params![mcp.on],
            )
            .map_err(sql)?;
        Ok(())
    }

    /// G2542: the Project's prepared-directory configuration; empty for a Project that never set it.
    pub fn get_prepared(&self) -> Result<Prepared, RpcError> {
        let (readiness, timeout_ms, setup) = self
            .db
            .query_row(
                "SELECT readiness, timeout_ms, setup FROM prepared_config WHERE id = 0",
                [],
                |row| Ok((row.get(0)?, row.get::<_, Option<i64>>(1)?, row.get(2)?)),
            )
            .optional()
            .map_err(sql)?
            .unwrap_or((None, None, None));
        let mut query = self
            .db
            .prepare("SELECT path FROM prepared_dirs ORDER BY ord")
            .map_err(sql)?;
        let enrolled = query
            .query_map([], |row| row.get(0))
            .map_err(sql)?
            .collect::<Result<_, _>>()
            .map_err(sql)?;
        Ok(Prepared {
            enrolled,
            readiness,
            timeout_ms: timeout_ms.and_then(|ms| u64::try_from(ms).ok()),
            setup,
        })
    }

    /// Replace the configuration in one transaction; a directory kept keeps its unavailable mark.
    pub fn set_prepared(&mut self, prepared: &Prepared) -> Result<(), RpcError> {
        let tx = self.db.transaction().map_err(sql)?;
        tx.execute(
            "INSERT INTO prepared_config (id, readiness, timeout_ms, setup) VALUES (0, ?, ?, ?)
             ON CONFLICT (id) DO UPDATE SET readiness = excluded.readiness,
                timeout_ms = excluded.timeout_ms, setup = excluded.setup",
            params![
                prepared.readiness,
                prepared
                    .timeout_ms
                    .map(|ms| i64::try_from(ms).unwrap_or(i64::MAX)),
                prepared.setup
            ],
        )
        .map_err(sql)?;
        tx.execute("DELETE FROM prepared_dirs WHERE ord < 0 OR path NOT IN (SELECT value FROM json_each(?))", [serde_json::to_string(&prepared.enrolled).map_err(RpcError::internal)?]).map_err(sql)?;
        for (ord, path) in prepared.enrolled.iter().enumerate() {
            tx.execute(
                "INSERT INTO prepared_dirs (path, ord) VALUES (?, ?)
                 ON CONFLICT (path) DO UPDATE SET ord = excluded.ord",
                params![path, i64::try_from(ord).unwrap_or(i64::MAX)],
            )
            .map_err(sql)?;
        }
        tx.commit().map_err(sql)
    }

    /// Why an enrolled directory is unavailable, or `None` when it is not.
    pub fn prepared_unavailable(&self, path: &str) -> Result<Option<String>, RpcError> {
        self.db
            .query_row(
                "SELECT unavailable FROM prepared_dirs WHERE path = ?",
                [path],
                |row| row.get(0),
            )
            .optional()
            .map_err(sql)
            .map(Option::flatten)
    }

    pub fn set_prepared_unavailable(
        &mut self,
        path: &str,
        reason: Option<&str>,
    ) -> Result<(), RpcError> {
        self.db
            .execute(
                "UPDATE prepared_dirs SET unavailable = ? WHERE path = ?",
                params![reason, path],
            )
            .map_err(sql)?;
        Ok(())
    }

    /// The node that holds `path` as its Worktree, whatever its state.
    pub fn worktree_owner_of(&self, path: &str) -> Result<Option<String>, RpcError> {
        self.db
            .query_row(
                "SELECT id FROM nodes WHERE worktree_path = ?",
                [path],
                |row| row.get::<_, i64>(0).map(|id| id.to_string()),
            )
            .optional()
            .map_err(sql)
    }

    /// G2542c: persist `plan` for `id` only if no node holds its directory and the directory is
    /// available, in one statement, so two starts never both win. `false` when taken.
    pub fn reserve_prepared(
        &mut self,
        id: &str,
        plan: &crate::worktree::Provision,
    ) -> Result<bool, RpcError> {
        self.closed_recovery_ready(Some(id))?;
        let path = plan.worktree.path.to_string_lossy();
        let changed = self
            .db
            .execute(
                "UPDATE nodes SET worktree_state='provisioning', worktree_path=?1, worktree_branch=?2,
                    worktree_base=?3, worktree_owner=?4, worktree_commit=?5
                 WHERE id=?6
                   AND NOT EXISTS (SELECT 1 FROM nodes WHERE worktree_path = ?1)
                   AND EXISTS (SELECT 1 FROM prepared_dirs WHERE path = ?1 AND unavailable IS NULL)",
                params![
                    path,
                    plan.worktree.branch,
                    plan.worktree.base,
                    plan.owner,
                    plan.commit,
                    id
                ],
            )
            .map_err(sql)?;
        Ok(changed == 1)
    }

    /// A36: the Models and Efforts set per Role, one entry for each of `roles` in order (`None`s
    /// for one never set), and the Models a Door may use.
    pub fn get_models(&self, roles: &[&str]) -> Result<ProjectModels, RpcError> {
        let mut set = self
            .db
            .prepare("SELECT role, model, effort FROM role_models")
            .map_err(sql)?;
        let set: Vec<RoleModels> = set
            .query_map([], |row| {
                Ok(RoleModels {
                    role: row.get(0)?,
                    model: row.get(1)?,
                    effort: row.get(2)?,
                })
            })
            .map_err(sql)?
            .collect::<Result<_, _>>()
            .map_err(sql)?;
        let roles = roles
            .iter()
            .map(|role| {
                set.iter()
                    .find(|found| found.role == *role)
                    .cloned()
                    .unwrap_or_else(|| RoleModels {
                        role: (*role).to_owned(),
                        model: None,
                        effort: None,
                    })
            })
            .collect();
        Ok(ProjectModels { roles })
    }

    /// A36: replace the Project's Models whole.
    pub fn set_models(&mut self, models: &ProjectModels) -> Result<(), RpcError> {
        let tx = self.db.transaction().map_err(sql)?;
        tx.execute("DELETE FROM role_models", []).map_err(sql)?;
        for role in &models.roles {
            tx.execute(
                "INSERT INTO role_models (role, model, effort) VALUES (?, ?, ?)",
                params![role.role, role.model, role.effort],
            )
            .map_err(sql)?;
        }
        tx.commit().map_err(sql)
    }

    /// A36: store the Model and Effort node `id` runs on.
    pub fn set_pair(
        &mut self,
        id: &str,
        model: Option<&str>,
        effort: Option<&str>,
    ) -> Result<(), RpcError> {
        let changed = self
            .db
            .execute(
                "UPDATE nodes SET model = ?, effort = ? WHERE id = ?",
                params![model, effort, id],
            )
            .map_err(sql)?;
        if changed == 0 {
            return Err(RpcError::not_found(GONE_AGENT));
        }
        Ok(())
    }
}
