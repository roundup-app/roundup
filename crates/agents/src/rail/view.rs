//! Loading stored Rail nodes, before live Agent facts are applied.
use super::*;

pub(super) fn load_nodes(
    db: &Connection,
    include_preparation: bool,
) -> Result<Vec<RailNode>, RpcError> {
    let mut query = db
        .prepare(
            "SELECT id, kind, name, parent, ord, attempt, terminal_id,
                worktree_path, worktree_branch, worktree_base, work, model, effort, iteration,
                conversation_id IS NOT NULL AND conversation_cwd IS NOT NULL, auto FROM nodes
                WHERE ? OR NOT EXISTS (SELECT 1 FROM closed_sources WHERE published=0
                    AND (workstream=nodes.id OR agent=nodes.id))",
        )
        .map_err(sql)?;
    let rows = query
        .query_map([include_preparation], |row| {
            let kind = match row.get::<_, String>(1)?.as_str() {
                "group" | "workstream" => NodeKind::Workstream,
                _ => NodeKind::Agent,
            };
            let worktree = match (
                row.get::<_, Option<String>>(7)?,
                row.get::<_, Option<String>>(8)?,
                row.get::<_, Option<String>>(9)?,
            ) {
                (Some(path), Some(branch), Some(base)) => Some(Worktree { path, branch, base }),
                _ => None,
            };
            let stored = row
                .get::<_, Option<String>>(10)?
                .and_then(|json| serde_json::from_str(&json).ok());
            let work = match kind {
                NodeKind::Workstream => Some(stored.unwrap_or_else(workstream_order)),
                NodeKind::Agent => stored,
            };
            Ok(RailNode {
                auto: (kind == NodeKind::Workstream)
                    .then(|| row.get(15))
                    .transpose()?,
                id: row.get::<_, i64>(0)?.to_string(),
                kind,
                name: row.get(2)?,
                parent: row.get::<_, Option<i64>>(3)?.map(|id| id.to_string()),
                order: row.get(4)?,
                status: None,
                status_revision: None,
                attempt: match row.get::<_, i64>(5)? {
                    0 => None,
                    n => Some(n.to_string()),
                },
                terminal_id: row.get(6)?,
                worktree,
                // R16/#1365: 40 per-row conversation queries cost 209 µs in the release
                // profile. Load availability here; presentation gates it on the live Attempt.
                can_resume: row.get(14)?,
                yolo: false,
                channel: None,
                stray: Vec::new(),
                work,
                model: row.get(11)?,
                effort: row.get(12)?,
                iteration: (kind == NodeKind::Workstream)
                    .then(|| row.get(13))
                    .transpose()?,
                inbox: None,
                tool_call: None,
                overview: None,
            })
        })
        .map_err(sql)?;
    rows.collect::<Result<_, _>>().map_err(sql)
}

impl Rail {
    pub(crate) fn set_auto(&mut self, id: &str, auto: bool) -> Result<bool, RpcError> {
        self.db
            .execute(
                "UPDATE nodes SET auto=?1 WHERE CAST(id AS TEXT)=?2 AND auto!=?1",
                params![auto, id],
            )
            .map(|changed| changed != 0)
            .map_err(sql)
    }
}
