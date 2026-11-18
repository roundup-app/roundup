//! T20 to T23: a Todo's comment thread, which is no Change to the Todo.
use contracts::todo::{Comment, CommentParams, TodoId, UnreadComment};
use contracts::{EventData, Verb};
use rpc::Ctx;

use super::{Todos, item};
use crate::error::Error;

/// T21: the longest line an Agent's comment shows.
const MAX_AGENT_COMMENT: usize = 280;

/// T21: the most bytes an Agent's closing `For Agents` fold may hold, its tags included.
const MAX_AGENT_COMMENT_FOLD: usize = 4096;

const FOLD_OPEN: &str = "<details><summary>For Agents</summary>";

const FOLD_CLOSE: &str = "</details>";

/// T21: one line of at most 280 characters, then at most one closed `For Agents` fold, last,
/// its tags on their own lines.
fn agent_comment_fits(body: &str) -> bool {
    let (line, rest) = body.split_once('\n').unwrap_or((body, ""));
    let fold = rest.trim_start_matches('\n');
    let inner = fold
        .strip_prefix(FOLD_OPEN)
        .and_then(|fold| fold.strip_suffix(FOLD_CLOSE));
    line.chars().count() <= MAX_AGENT_COMMENT
        && (rest.is_empty()
            || fold.len() <= MAX_AGENT_COMMENT_FOLD
                && inner.is_some_and(|inner| {
                    inner.starts_with('\n')
                        && inner.ends_with('\n')
                        && !inner.contains("<details")
                        && !inner.contains(FOLD_CLOSE)
                }))
}

impl Todos {
    /// T20, T21: the author is the calling Actor. An Agent's comment is one short line and may end in one closed `For Agents` fold.
    pub(crate) async fn comment(&self, ctx: &Ctx, p: CommentParams) -> Result<Comment, Error> {
        let body = p.body.trim();
        let invalid = |why: &str| Error::InvalidParams(why.into());
        if body.is_empty() {
            return Err(invalid("a comment needs a body"));
        }
        if ctx.actor.kind == contracts::ActorKind::Agent && !agent_comment_fits(body) {
            return Err(invalid(&format!(
                "an Agent comment is one line of at most {MAX_AGENT_COMMENT} characters, then at most one closed `{FOLD_OPEN}` fold of at most {MAX_AGENT_COMMENT_FOLD} bytes"
            )));
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
