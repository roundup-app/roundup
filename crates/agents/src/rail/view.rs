//! Loading stored Rail nodes, before live Agent facts are applied.
use super::*;

const NODES: &str = "SELECT id, kind, name, parent, ord, attempt, terminal_id,
                worktree_path, worktree_branch, worktree_base, work, model, effort, iteration,
                conversation_id IS NOT NULL AND conversation_cwd IS NOT NULL, auto, finished FROM nodes
                WHERE ? OR NOT EXISTS (SELECT 1 FROM closed_sources WHERE published=0
                    AND (workstream=nodes.id OR agent=nodes.id))";

pub(super) fn load_nodes(
    db: &Connection,
    include_preparation: bool,
) -> Result<Vec<RailNode>, RpcError> {
    load_with(db, include_preparation, |node, _| node)
}

fn load_with<T>(
    db: &Connection,
    include_preparation: bool,
    mut map: impl FnMut(RailNode, u64) -> T,
) -> Result<Vec<T>, RpcError> {
    let mut query = db.prepare_cached(NODES).map_err(sql)?;
    let rows = query
        .query_map([include_preparation], |row| {
            let kind = match row.get_ref(1)?.as_str()? {
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
                .get_ref(10)?
                .as_str_or_null()?
                .and_then(|json| serde_json::from_str(json).ok());
            let work = match kind {
                NodeKind::Workstream => Some(stored.unwrap_or_else(workstream_order)),
                NodeKind::Agent => stored,
            };
            let node = RailNode {
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
            };
            Ok(map(node, row.get::<_, i64>(16)?.cast_unsigned()))
        })
        .map_err(sql)?;
    rows.collect::<Result<_, _>>().map_err(sql)
}

impl Rail {
    /// Every node, each parent before its children, siblings by `order`.
    pub fn tree(&self) -> Result<Vec<RailNode>, RpcError> {
        self.tree_with(|node, _| Ok(node))
    }

    /// Present each reachable node with its finish count from the same SQLite read.
    pub(crate) fn tree_with(
        &self,
        mut present: impl FnMut(RailNode, u64) -> Result<RailNode, RpcError>,
    ) -> Result<Vec<RailNode>, RpcError> {
        // R3696c: the separate finish-count query/map made a forty-Workstream
        // reply allocate 290 times. Keep the count beside its node during traversal.
        let mut flat = load_with(&self.db, false, |node, finished| (node, finished))?;
        // Sibling orders are unique (A6); equal orders across parents need no stability.
        // R3696c: avoid the stable sort's scratch copy of these large nodes.
        flat.sort_unstable_by_key(|(node, _)| node.order);
        let mut out = Vec::with_capacity(flat.len());
        let mut flat: Vec<_> = flat.into_iter().map(Some).collect();
        descend(&mut flat, None, &mut out, &mut present)?;
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

// R3696c: a forty-Workstream reply allocated 530 times (181 KB). Move the
// loaded nodes into traversal order rather than cloning their strings and Orders.
fn descend(
    nodes: &mut [Option<(RailNode, u64)>],
    parent: Option<&str>,
    out: &mut Vec<RailNode>,
    present: &mut impl FnMut(RailNode, u64) -> Result<RailNode, RpcError>,
) -> Result<(), RpcError> {
    for index in 0..nodes.len() {
        if !nodes[index]
            .as_ref()
            .is_some_and(|(node, _)| node.parent.as_deref() == parent)
        {
            continue;
        }
        let (node, finished) = nodes[index].take().expect("selected node");
        let mut node = present(node, finished)?;
        // Keep the id locally during recursion so neither it nor the node is copied.
        let id = std::mem::take(&mut node.id);
        let at = out.len();
        out.push(node);
        descend(nodes, Some(&id), out, present)?;
        out[at].id = id;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::StatementStatus;

    #[test]
    fn r3696c_forty_workstreams_avoid_per_node_preparation_queries() {
        let dir = tempfile::tempdir().unwrap();
        let mut rail = Rail::open(&dir.path().join("agents.db")).unwrap();
        for i in 0..40 {
            rail.insert(NodeKind::Workstream, &format!("workstream-{i}"), None, None)
                .unwrap();
        }
        rail.tree().unwrap();
        rail.db
            .prepare_cached(NODES)
            .unwrap()
            .reset_status(StatementStatus::VmStep);
        let tree = rail.tree().unwrap();
        assert_eq!(tree.len(), 40);
        let steps = rail
            .db
            .prepare_cached(NODES)
            .unwrap()
            .get_status(StatementStatus::VmStep);
        assert!(
            steps <= 1350,
            "Rail read executed {steps} SQLite instructions for forty Workstreams"
        );
    }
}
