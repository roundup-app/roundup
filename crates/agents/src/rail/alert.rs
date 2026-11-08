//! U5501: one committed choice for the current scope, with no future inheritance.
use super::*;
use contracts::agent::AlertLevel;

impl Rail {
    pub(crate) fn set_alert_level(
        &mut self,
        id: AgentId,
        level: AlertLevel,
    ) -> Result<(), StoreError> {
        let tx = self.db.transaction()?;
        let nodes = load(&tx)?;
        let target = find(&nodes, id)?;
        let stored = serde_json::to_string(&level)?;
        for node in &nodes {
            if (node.kind == NodeKind::Agent || node.attempt.is_some())
                && (AgentId::parse(&node.id) == Some(id)
                    || (target.kind == NodeKind::Workstream && is_within(&nodes, &node.id, &id.to_string())))
            {
                tx.execute(
                    "UPDATE nodes SET alert_level=? WHERE id=?",
                    params![stored, node.id],
                )?;
            }
        }
        Ok(tx.commit()?)
    }
}

impl Rail {
    pub(crate) fn set_visibility(
        &self,
        id: AgentId,
        visibility: contracts::agent::RailVisibility,
    ) -> Result<bool, StoreError> {
        let value = match visibility {
            contracts::agent::RailVisibility::Shown => "shown",
            contracts::agent::RailVisibility::Internal => "internal",
        };
        Ok(self
            .db
            .execute(
                "UPDATE nodes SET visibility=?1 WHERE id=?2 AND visibility<>?1",
                params![value, id.get()],
            )
            .map(|n| n != 0)?)
    }
}
