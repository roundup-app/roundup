//! Loading stored Rail nodes, before live Agent facts are applied.
use super::*;

pub(super) fn load_nodes(
    db: &Connection,
    include_preparation: bool,
) -> Result<Vec<RailNode>, RpcError> {
    let mut query = db
        .prepare_cached(
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
    /// Every node, each parent before its children, siblings by `order`.
    pub fn tree(&self) -> Result<Vec<RailNode>, RpcError> {
        let mut flat = load(&self.db)?;
        flat.sort_by_key(|node| node.order);
        let mut out = Vec::with_capacity(flat.len());
        descend(&flat, None, &mut out);
        Ok(out)
    }

    /// U3566c: the Agent's published finishes; `0` for a node never counted.
    pub(crate) fn finished(&self, id: &str) -> Result<u64, RpcError> {
        self.db
            .query_row(
                "SELECT finished FROM nodes WHERE CAST(id AS TEXT)=?1",
                [id],
                |row| row.get::<_, i64>(0),
            )
            .optional()
            .map(|finished| finished.unwrap_or_default().cast_unsigned())
            .map_err(sql)
    }

    /// `finished` of every node at once, so a tree read is one query and not one per node.
    pub(crate) fn finished_all(&self) -> Result<std::collections::HashMap<String, u64>, RpcError> {
        let mut query = self
            .db
            .prepare_cached("SELECT id, finished FROM nodes")
            .map_err(sql)?;
        let rows = query
            .query_map([], |row| {
                Ok((
                    row.get::<_, i64>(0)?.to_string(),
                    row.get::<_, i64>(1)?.cast_unsigned(),
                ))
            })
            .map_err(sql)?;
        rows.collect::<Result<_, _>>().map_err(sql)
    }

    pub(crate) fn set_finished(&mut self, id: &str, finished: u64) -> Result<(), RpcError> {
        self.db
            .execute(
                "UPDATE nodes SET finished=?1 WHERE CAST(id AS TEXT)=?2",
                params![finished.cast_signed(), id],
            )
            .map(drop)
            .map_err(sql)
    }

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

fn descend(nodes: &[RailNode], parent: Option<&str>, out: &mut Vec<RailNode>) {
    for node in nodes.iter().filter(|node| node.parent.as_deref() == parent) {
        out.push(node.clone());
        descend(nodes, Some(&node.id), out);
    }
}
