//! U5501: one committed choice for the current scope, with no future inheritance.
use super::*;
use contracts::agent::AlertLevel;

impl Rail {
    pub(crate) fn set_alert_level(&mut self, id: &str, level: AlertLevel) -> Result<(), RpcError> {
        let tx = self.db.transaction().map_err(sql)?;
        let nodes = load(&tx)?;
        let target = find(&nodes, id)?;
        let stored = serde_json::to_string(&level).map_err(RpcError::internal)?;
        for node in &nodes {
            if (node.kind == NodeKind::Agent || node.attempt.is_some())
                && (node.id == id
                    || (target.kind == NodeKind::Workstream && is_within(&nodes, &node.id, id)))
            {
                tx.execute(
                    "UPDATE nodes SET alert_level=? WHERE id=?",
                    params![stored, node.id],
                )
                .map_err(sql)?;
            }
        }
        tx.commit().map_err(sql)
    }
}
