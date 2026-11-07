//! T20 to T23: a Todo's comment thread, which is no Change to the Todo.
use contracts::todo::{Comment, CommentParams, TodoId, UnreadComment};
use contracts::{EventData, Verb};
use rpc::Ctx;

use super::{Todos, item};
use crate::error::Error;

/// T21: the longest comment an Agent may leave.
const MAX_AGENT_COMMENT: usize = 280;

impl Todos {
    /// T20, T21: the author is the calling Actor. An Agent's comment is one short line.
    pub(crate) async fn comment(&self, ctx: &Ctx, p: CommentParams) -> Result<Comment, Error> {
        let body = p.body.trim();
        let invalid = |why: &str| Error::InvalidParams(why.into());
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
        let added = comments
            .last()
            .ok_or_else(|| Error::internal("a comment was just added"))?;
        Ok(added.clone())
    }

    pub(crate) async fn comments(&self, _ctx: &Ctx, p: TodoId) -> Result<Vec<Comment>, Error> {
        self.store()?.comments(p.id)
    }

    pub(crate) async fn unread(&self, _ctx: &Ctx) -> Result<Vec<UnreadComment>, Error> {
        self.store()?.unread()
    }

    /// T23: marks read, logs no Touch, and emits only when something changed.
    pub(crate) async fn mark_comments_read(&self, ctx: &Ctx, p: TodoId) -> Result<(), Error> {
        if self.store()?.mark_comments_read(p.id)? {
            ctx.emit(EventData::TodoCommentsRead(p));
        }
        Ok(())
    }
}
