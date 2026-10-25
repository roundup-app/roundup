//! Message reads, access checks and RPC dispatch.

use super::*;

impl Messages {
    pub(super) fn get(&self, ctx: &Ctx, p: MessageId) -> Result<Value, RpcError> {
        let message = self.get_or_not_found(p.id)?;
        require_readable(ctx, &message)?;
        ctx.touch(Verb::Read, &item(p.id))?;
        reply(&message)
    }

    pub(super) fn list(&self, ctx: &Ctx, p: ListParams) -> Result<Value, RpcError> {
        let mut messages = match &p.id {
            Some(door) => self.store()?.thread(door)?,
            None => self.store()?.list()?,
        };
        if let Some(to) = &p.to {
            messages.retain(|message| &message.to == to);
        }
        if let Some(status) = p.status {
            messages.retain(|message| message.status == status);
        }
        if ctx.actor.kind != ActorKind::User {
            messages.retain(|message| {
                is_sender(message, &ctx.actor) || is_receiver(&ctx.actor, &message.to)
            });
        }
        reply(&messages)
    }
}

pub(super) fn require_user(ctx: &Ctx, action: &str) -> Result<(), RpcError> {
    if ctx.actor.kind == ActorKind::User {
        return Ok(());
    }
    Err(RpcError::forbidden(format!("only the user may {action}")))
}

/// B11: the user may read any Message; anyone else only one they sent or received.
fn require_readable(ctx: &Ctx, message: &Message) -> Result<(), RpcError> {
    if ctx.actor.kind == ActorKind::User
        || is_sender(message, &ctx.actor)
        || is_receiver(&ctx.actor, &message.to)
    {
        return Ok(());
    }
    Err(RpcError::forbidden(format!(
        "{} may not read message {}",
        ctx.actor.id, message.id
    )))
}

/// Whether `actor` sent `message`: by kind and id together, never id alone, since an Agent and
/// an Extension draw their ids from different namespaces and could share one.
fn is_sender(message: &Message, actor: &Actor) -> bool {
    message.from.kind == actor.kind && message.from.id == actor.id
}

/// Whether `to`, a Message's receiver id, names `actor`: Agents and the user are the only
/// receivers, so an Extension that shares an Agent's id is not that Agent.
pub(super) fn is_receiver(actor: &Actor, to: &str) -> bool {
    matches!(actor.kind, ActorKind::Agent | ActorKind::User) && actor.id == to
}

pub(super) fn item(id: u32) -> String {
    format!("message:{id}")
}

/// B53: a send names its `kind`; a missing or unknown one says which values are allowed.
fn send_params(value: Value) -> Result<SendParams, RpcError> {
    if !matches!(
        value.get("kind").and_then(Value::as_str),
        Some("note" | "question")
    ) {
        return Err(RpcError::new(
            code::INVALID_PARAMS,
            "kind is required and must be `note` or `question`",
        ));
    }
    params(value)
}

#[async_trait]
impl Module for Messages {
    fn namespaces(&self) -> &'static [&'static str] {
        &["message", "route"]
    }

    async fn call(&self, ctx: &Ctx, method: &str, value: Value) -> Result<Value, RpcError> {
        start_listener(&self.inner);
        let result = guarded(method, self.dispatch(ctx, method, value)).await;
        match result {
            Ok(Ok(value)) => Ok(value),
            Ok(Err(err)) => {
                if err.code == code::INTERNAL {
                    log_failure(method, &err.message);
                }
                Err(err)
            }
            Err(cause) => Err(RpcError::internal(format!("{method} failed: {cause}"))),
        }
    }
}

impl Messages {
    async fn dispatch(&self, ctx: &Ctx, method: &str, value: Value) -> Result<Value, RpcError> {
        trip(&self.inner, method).map_err(RpcError::internal)?;
        match method {
            "message.send" => self.send(ctx, send_params(value)?).await,
            "message.get" => self.get(ctx, params(value)?),
            "message.list" => self.list(ctx, params(value)?),
            "message.drop" => self.drop_message(ctx, params(value)?).await,
            "route.set" => self.set_route(ctx, params(value)?).await,
            "route.list" => self.list_routes(),
            _ => Err(RpcError::method_not_found(method)),
        }
    }
}

impl Messages {
    /// A32: every Message sent to or by `door`, in order, each with its Iteration.
    pub fn thread(&self, door: &str) -> Result<Vec<Message>, RpcError> {
        self.store()?.thread(door)
    }

    /// A32: the Iteration `door` is in ends here; returns its number.
    pub fn end_iteration(&self, door: &str) -> Result<u32, RpcError> {
        self.store()?.end_iteration(door)
    }
}

impl Messages {
    pub(super) fn get_or_not_found(&self, id: u32) -> Result<Message, RpcError> {
        self.store()?
            .get(id)?
            .ok_or_else(|| RpcError::not_found(format!("message {id}")))
    }
}
