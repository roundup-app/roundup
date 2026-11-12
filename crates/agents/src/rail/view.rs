//! Loading stored Rail nodes, before live Agent facts are applied.
use super::row::{COLUMNS as NODES, NodeRow};
use super::*;

// R3696c: adding visibility made the compound empty-history read cost 915 VM steps.
// Test the preparation gate once, then read the ordinary rows without per-node predicates.
const PREPARING: &str = "SELECT EXISTS(SELECT 1 FROM closed_sources WHERE published=0)";
pub(super) fn load_nodes(
    db: &Connection,
    include_preparation: bool,
) -> Result<Vec<RailNode>, StoreError> {
    load_with(db, include_preparation, 0, |node, _| node)
}

fn load_with<T>(
    db: &Connection,
    include_preparation: bool,
    capacity: usize,
    mut map: impl FnMut(RailNode, u64) -> T,
) -> Result<Vec<T>, StoreError> {
    let all = include_preparation
        || !db
            .prepare_cached(PREPARING)?
            .query_row([], |row| row.get::<_, bool>(0))?;
    let mut query = if all {
        db.prepare_cached(NODES)
    } else {
        db.prepare_cached(&format!("{NODES} WHERE NOT EXISTS (SELECT 1 FROM closed_sources WHERE published=0 AND (workstream=nodes.id OR agent=nodes.id))"))
    }?;
    let rows = query.query_map([], |row| {
        let node = NodeRow::read(row)?;
        let finished = node.finished;
        Ok(map(node.into_node(), finished))
    })?;
    let mut nodes = Vec::with_capacity(capacity);
    for row in rows {
        nodes.push(row?);
    }
    Ok(nodes)
}

impl Rail {
    /// Every node, each parent before its children, siblings by `order`.
    pub fn tree(&self) -> Result<Vec<RailNode>, StoreError> {
        self.tree_with(|node, _| Ok(node))
    }

    /// Present each reachable node with its finish count from the same SQLite read.
    pub(crate) fn tree_with(
        &self,
        mut present: impl FnMut(RailNode, u64) -> Result<RailNode, RpcError>,
    ) -> Result<Vec<RailNode>, StoreError> {
        // R3696c: the separate finish-count query/map made a forty-Workstream
        // reply allocate 290 times. Keep the count beside its node during traversal.
        // R3696c: growing this buffer costs 19,968 bytes per forty-node reply.
        // A previous length reserves space without the count query that regressed timing.
        let flat = load_with(
            &self.db,
            false,
            self.tree_capacity.get(),
            |node, finished| (node, finished),
        )?;
        // Retain no nodes; bound speculative space after a large tree is removed.
        self.tree_capacity.set(flat.len().min(256));
        ordered(flat, &mut present)
    }

    /// U3566c: the Agent's published finishes; `0` for a node never counted.
    pub(crate) fn finished(&self, id: AgentId) -> Result<u64, StoreError> {
        Ok(self
            .db
            .query_row(
                "SELECT finished FROM nodes WHERE id=?1",
                [id.get()],
                |row| row.get::<_, i64>(0),
            )
            .optional()
            .map(|finished| finished.unwrap_or_default().cast_unsigned())?)
    }

    pub(crate) fn set_finished(&mut self, id: AgentId, finished: u64) -> Result<(), StoreError> {
        Ok(self
            .db
            .execute(
                "UPDATE nodes SET finished=?1 WHERE id=?2",
                params![finished.cast_signed(), id.get()],
            )
            .map(drop)?)
    }

    pub(crate) fn set_mode_prompt(
        &mut self,
        id: AgentId,
        prompt: Option<&str>,
    ) -> Result<bool, StoreError> {
        Ok(self
            .db
            .execute(
                "UPDATE nodes SET opening_prompt=?1 WHERE id=?2 AND kind='agent' AND parent IS NULL AND opening_prompt IS NOT ?1",
                params![prompt, id.get()],
            )
            .map(|changed| changed != 0)?)
    }

    /// FOP5978b: turn every Auto off.
    pub(crate) fn clear_all_auto(&mut self) -> Result<(), StoreError> {
        Ok(self
            .db
            .execute("UPDATE nodes SET auto=0 WHERE auto!=0", [])
            .map(|_| ())?)
    }

    pub(crate) fn set_auto(&mut self, id: AgentId, auto: bool) -> Result<bool, StoreError> {
        Ok(self
            .db
            .execute(
                "UPDATE nodes SET auto=?1 WHERE id=?2 AND auto!=?1",
                params![auto, id.get()],
            )
            .map(|changed| changed != 0)?)
    }
}

struct Topology {
    id: i64,
    parent: Option<i64>,
    order: u32,
    payload: usize,
    children: std::ops::Range<usize>,
}

fn ordered(
    mut flat: Vec<(RailNode, u64)>,
    present: &mut impl FnMut(RailNode, u64) -> Result<RailNode, RpcError>,
) -> Result<Vec<RailNode>, StoreError> {
    // R3696c's root-only allocation bound needs no topology or second payload buffer.
    if flat.iter().all(|(node, _)| node.parent.is_none()) {
        flat.sort_unstable_by_key(|(node, _)| node.order);
        return flat
            .into_iter()
            .map(|(node, finished)| present(node, finished).map_err(StoreError::from))
            .collect();
    }
    let topology = topology(&flat);
    walk(flat, topology, present)
}

struct Walk {
    topology: Vec<Topology>,
    slots: Vec<usize>,
    pending: Vec<usize>,
    broken: bool,
}

fn corrupt() -> StoreError {
    StoreError::internal("stored Rail topology is inconsistent")
}

fn topology(flat: &[(RailNode, u64)]) -> Walk {
    // These ids originate as SQLite integers in load_with, never arbitrary RPC text; one that
    // is not marks the walk `broken`, which `walk` reports before it reads any payload.
    let mut broken = false;
    let mut id = |text: &str| {
        text.parse().unwrap_or_else(|_| {
            broken = true;
            0
        })
    };
    let mut topology: Vec<_> = flat
        .iter()
        .enumerate()
        .map(|(payload, (node, _))| Topology {
            id: id(&node.id),
            parent: node.parent.as_deref().map(&mut id),
            order: node.order,
            payload,
            children: 0..0,
        })
        .collect();
    topology.sort_unstable_by_key(|row| (row.parent, row.order));
    for at in 0..topology.len() {
        let Some(parent) = topology.get(at).map(|row| Some(row.id)) else {
            broken = true;
            break;
        };
        let start = topology.partition_point(|row| row.parent < parent);
        let end = topology.partition_point(|row| row.parent <= parent);
        if let Some(row) = topology.get_mut(at) {
            row.children = start..end;
        }
    }
    // R5636e: reuse the loaded payload allocation instead of allocating another
    // node-sized output buffer. slots keeps moved payload locations current.
    let mut slots = vec![0; flat.len()];
    for (index, row) in topology.iter().enumerate() {
        match slots.get_mut(row.payload) {
            Some(slot) => *slot = index,
            None => broken = true,
        }
    }
    let mut pending = Vec::with_capacity(flat.len());
    pending.extend((0..topology.partition_point(|row| row.parent.is_none())).rev());
    Walk {
        topology,
        slots,
        pending,
        broken,
    }
}

fn walk(
    mut flat: Vec<(RailNode, u64)>,
    prepared: Walk,
    present: &mut impl FnMut(RailNode, u64) -> Result<RailNode, RpcError>,
) -> Result<Vec<RailNode>, StoreError> {
    let Walk {
        mut topology,
        mut slots,
        mut pending,
        broken,
    } = prepared;
    if broken {
        return Err(corrupt());
    }
    let mut emitted = 0;
    while let Some(index) = pending.pop() {
        #[cfg(test)]
        WALKED.with(|count| count.set(count.get() + 1));
        let source = topology.get(index).ok_or_else(corrupt)?.payload;
        let displaced = *slots.get(emitted).ok_or_else(corrupt)?;
        if source >= flat.len() {
            return Err(corrupt());
        }
        flat.swap(source, emitted);
        slots.swap(source, emitted);
        topology.get_mut(displaced).ok_or_else(corrupt)?.payload = source;
        let row = topology.get_mut(index).ok_or_else(corrupt)?;
        row.payload = emitted;
        emitted += 1;
        pending.extend(row.children.clone().rev());
    }
    flat.truncate(emitted);
    flat.into_iter()
        .map(|(node, finished)| present(node, finished).map_err(StoreError::from))
        .collect()
}

#[cfg(test)]
thread_local! { static WALKED: std::cell::Cell<usize> = const { std::cell::Cell::new(0) }; }

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
        for query in [PREPARING, NODES] {
            rail.db
                .prepare_cached(query)
                .unwrap()
                .reset_status(StatementStatus::VmStep);
        }
        let tree = rail.tree().unwrap();
        assert_eq!(tree.len(), 40);
        let steps: i32 = [PREPARING, NODES]
            .into_iter()
            .map(|query| {
                rail.db
                    .prepare_cached(query)
                    .unwrap()
                    .get_status(StatementStatus::VmStep)
            })
            .sum();
        eprintln!("forty Workstreams: {steps} SQLite instructions");
        // Start attribution and the Machine each add one projected column: one instruction per row.
        assert!(
            steps <= 980,
            "Rail read executed {steps} SQLite instructions for forty Workstreams"
        );
    }
    fn nested(count: usize, branching: bool) -> Vec<(RailNode, u64)> {
        // Payload construction is outside the measured traversal, with no database/process.
        let template: RailNode = serde_json::from_value(serde_json::json!({
            "id":"1", "kind":"workstream", "name":"payload", "order":0,
            "can_resume":false, "can_make_workstream":false, "can_save_as_mode":false,
            "yolo":false, "stray":[], "alert_level":"default"
        }))
        .unwrap();
        (0..count)
            .rev()
            .map(|index| {
                let mut node = template.clone();
                node.id = (i64::MAX - i64::try_from(index).unwrap()).to_string();
                node.parent = (index > 0).then(|| {
                    let parent = if branching {
                        (index - 1) / 3
                    } else {
                        index - 1
                    };
                    (i64::MAX - i64::try_from(parent).unwrap()).to_string()
                });
                node.order = u32::try_from(index).unwrap();
                (node, u64::try_from(index).unwrap())
            })
            .collect()
    }

    #[test]
    fn r5636e_nested_rail_allocated_bytes() {
        for count in [40, 400] {
            for branching in [false, true] {
                let flat = nested(count, branching);
                let region = stats_alloc::Region::new(crate::ALLOCATOR);
                let topology = topology(&flat);
                let prepared = region.change();
                let out = walk(flat, topology, &mut |node, _| Ok(node)).unwrap();
                let total = region.change();
                eprintln!(
                    "RAIL count={count} branching={branching} prep={prepared:?} walk={:?} total={total:?}",
                    total - prepared
                );
                // Base 767fa083: 920 bytes/node (36,800 / 368,000) for both shapes.
                assert!(total.bytes_allocated < count * 256);
                std::hint::black_box(out);
            }
        }
    }
    #[test]
    fn r5636c_nested_order_keeps_payloads_and_finish_counts() {
        let mut flat = nested(4, false);
        // Two roots, with an earlier-ordered child that must follow its parent.
        flat[0].0.parent = None;
        flat[0].0.order = 99;
        flat[1].0.parent = Some(i64::MAX.to_string());
        flat[1].0.order = 0;
        flat[2].0.parent = Some(i64::MAX.to_string());
        flat[2].0.order = 5;
        let expected: Vec<_> = [0, 2, 1, 3]
            .into_iter()
            .map(|i| {
                let (node, finished) = &flat[3 - i];
                let mut node = node.clone();
                node.name = format!("finished-{finished}");
                node
            })
            .collect();
        let out = ordered(flat, &mut |mut node, finished| {
            node.name = format!("finished-{finished}");
            Ok(node)
        })
        .unwrap();
        assert_eq!(out, expected);
    }

    #[test]
    fn r5636c_missing_parents_stay_unreachable() {
        let mut flat = nested(4, false);
        flat[2].0.parent = Some("17".into());
        let out = ordered(flat, &mut |node, _| Ok(node)).unwrap();
        assert_eq!(
            out.into_iter().map(|node| node.id).collect::<Vec<_>>(),
            [i64::MAX.to_string()]
        );
    }

    fn expected_order(count: usize, branching: bool) -> Vec<usize> {
        fn branch(at: usize, count: usize, out: &mut Vec<usize>) {
            if at >= count {
                return;
            }
            out.push(at);
            for child in 1..=3 {
                branch(at * 3 + child, count, out);
            }
        }
        let mut out = Vec::new();
        if branching {
            branch(0, count, &mut out);
        } else {
            out.extend(0..count);
        }
        out
    }

    #[test]
    fn r5636c_nested_walk_visits_each_emitted_node_once() {
        for count in [40, 400] {
            for branching in [false, true] {
                let flat = nested(count, branching);
                let topology = topology(&flat);
                WALKED.set(0);
                let out = walk(flat, topology, &mut |node, _| Ok(node)).unwrap();
                assert_eq!(WALKED.get(), count);
                let expected: Vec<_> = expected_order(count, branching)
                    .into_iter()
                    .map(|i| (i64::MAX - i64::try_from(i).unwrap()).to_string())
                    .collect();
                assert_eq!(
                    out.into_iter().map(|node| node.id).collect::<Vec<_>>(),
                    expected
                );
            }
        }
    }
}
