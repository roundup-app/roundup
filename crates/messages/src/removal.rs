//! B3, U3782: the user takes a `pending` Message of theirs back; it is dropped as `removed`.
//! `lib.rs` routes the call and `store.rs` keeps the rows.

use contracts::message::{MessageId, MessageStatus, Reason};
use contracts::{ActorKind, EventData, Verb};
use rpc::{Ctx, RpcError, reply};
use rusqlite::params;
use serde_json::Value;

use super::receiver_view::user_drop_moves;
use super::store::{Store, text_of};
use super::{Messages, item, require_user};

impl Messages {
    pub(super) async fn drop_message(&self, ctx: &Ctx, p: MessageId) -> Result<Value, RpcError> {
        require_user(ctx, "drop a Message")?;
        let message = self.get_or_not_found(p.id)?;
        if message.status != MessageStatus::Pending || message.from.kind != ActorKind::User {
            return Err(RpcError::conflict(format!(
                "message {} is not a pending Message of the user",
                p.id
            )));
        }
        let moves = user_drop_moves(&self.store()?.list_pending_to(&message.to)?, p.id);
        if !moves || !self.store()?.drop_pending(p.id, Reason::Removed)? {
            return Err(RpcError::conflict(format!("message {} is in flight", p.id)));
        }
        ctx.touch(Verb::Wrote, &item(p.id))?;
        let dropped = self.get_or_not_found(p.id)?;
        ctx.emit(EventData::MessageDropped(dropped.clone().into()));
        reply(&dropped)
    }
}

impl Store {
    /// B3: the user removes a `pending` Message of theirs that was never typed. `false` when it
    /// is not `pending` or has an in-flight record (B39(a)).
    pub(crate) fn drop_pending(&self, id: u32, reason: Reason) -> Result<bool, RpcError> {
        let changed = self
            .db
            .execute(
                "UPDATE messages SET status = 'dropped', reason = ?2
                 WHERE id = ?1 AND status = 'pending'
                   AND NOT EXISTS(SELECT 1 FROM message_flight WHERE message_id = ?1)",
                params![id, text_of(reason)],
            )
            .map_err(RpcError::internal)?;
        Ok(changed == 1)
    }
}
