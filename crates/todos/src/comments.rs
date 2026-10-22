//! T20 to T23: a Todo's comment thread, which is no Change to the Todo.
use contracts::todo::{CommentParams, TodoId};
use contracts::{EventData, Verb};
use rpc::{Ctx, RpcError, reply};
use serde_json::Value;

use super::{Todos, item};

/// T21: the longest comment an Agent may leave.
const MAX_AGENT_COMMENT: usize = 280;

impl Todos {
    /// T20, T21: the author is the calling Actor. An Agent's comment is one short line.
    pub(crate) fn comment(&self, ctx: &Ctx, p: CommentParams) -> Result<Value, RpcError> {
        let body = p.body.trim();
        let invalid = |why: &str| RpcError::new(rpc::code::INVALID_PARAMS, why);
        if body.is_empty() {
            return Err(invalid("a comment needs a body"));
        }
        if ctx.actor.kind == contracts::ActorKind::Agent
            && (body.chars().count() > MAX_AGENT_COMMENT || body.contains('\n'))
        {
            return Err(invalid(
                "an Agent comment is one line of at most 280 characters",
            ));
        }
        let store = self.store()?;
        store.add_comment(p.id, &ctx.actor, body)?;
        ctx.touch(Verb::Wrote, &item(p.id))?;
        ctx.emit(EventData::TodoCommented(TodoId { id: p.id }));
        let comments = store.comments(p.id)?;
        reply(comments.last().expect("a comment was just added"))
    }

    pub(crate) fn comments(&self, p: TodoId) -> Result<Value, RpcError> {
        reply(&self.store()?.comments(p.id)?)
    }

    pub(crate) fn unread(&self) -> Result<Value, RpcError> {
        reply(&self.store()?.unread()?)
    }

    /// T23: marks read, logs no Touch, and emits only when something changed.
    pub(crate) fn mark_comments_read(&self, ctx: &Ctx, p: TodoId) -> Result<Value, RpcError> {
        if self.store()?.mark_comments_read(p.id)? {
            ctx.emit(EventData::TodoCommentsRead(p));
        }
        Ok(Value::Null)
    }
}
