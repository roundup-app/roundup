//! Authenticated Message acceptance and atomic allocation.

use contracts::message::Delivery;

use super::*;
use receiver_view::send_status;

const OPEN_BOUND: u32 = 32;

impl Messages {
    pub(super) async fn send(&self, ctx: &Ctx, p: SendParams) -> Result<Value, RpcError> {
        // B51(f): the authenticated sender hears when the inbox format is unavailable.
        let uses_inbox = inbox::is_inbox_send(&p);
        if uses_inbox {
            self.refuse_repeat(ctx, &p).await?;
        }
        let message = self.send_message(ctx, p, false).await?;
        if uses_inbox {
            inbox::refuse_mismatch(&self.inner, &message).await?;
        }
        reply(&message)
    }

    /// B51(g): a new send is refused before allocating a Message or question chain.
    async fn refuse_repeat(&self, ctx: &Ctx, p: &SendParams) -> Result<(), RpcError> {
        let Ok(Some(receiver)) = self.resolve_receiver(&p.to).await else {
            return Ok(());
        };
        if self
            .store()?
            .is_inbox_repeat(&ctx.actor, &p.to, &p.body, binding(&receiver).0, None)?
        {
            return Err(RpcError::conflict(inbox::REPEAT));
        }
        Ok(())
    }

    /// `message.send`. `merge` makes the Message the merge of the two oldest pushed digests to
    /// `p.to`, which it drops in the same write (B22), and ignores `p.body` but for its prefix.
    pub(super) async fn send_message(
        &self,
        ctx: &Ctx,
        p: SendParams,
        merge: bool,
    ) -> Result<Message, RpcError> {
        self.send_message_with(ctx, p, merge, None, None, None)
            .await
    }

    /// `send_message`; with `wake`, the Wake request of that number is fired in the same write (B42);
    /// with `reaction`, the firing is accepted in the same write (NR3).
    pub(super) async fn send_message_with(
        &self,
        ctx: &Ctx,
        p: SendParams,
        merge: bool,
        wake: Option<u32>,
        reaction: Option<&reaction::Fire>,
        continuation: Option<&continuation::Continue>,
    ) -> Result<Message, RpcError> {
        if is_receiver(&ctx.actor, &p.to) {
            return Err(RpcError::new(
                code::INVALID_PARAMS,
                "a Message cannot be sent to its own sender",
            ));
        }
        let receiver_status = self.resolve_receiver(&p.to).await?;
        if p.body.is_empty() || p.body.len() > MAX_BODY_BYTES {
            return Err(RpcError::new(
                code::INVALID_PARAMS,
                format!("body must be 1 to {MAX_BODY_BYTES} bytes"),
            ));
        }
        if let Some(status) = &receiver_status
            && ended(status)
        {
            return Err(RpcError::conflict(format!(
                "{} cannot receive a Message: its Kind is {:?}",
                p.to, status.status
            )));
        }
        // The reply-to check, the bound check and the insert run while one lock is taken, so a
        // second sender racing for the same receiver's last open slot cannot pass its own check
        // before this one's insert lands (B1).
        let digest = p.kind == MessageKind::Note && pushes::is_digest(&ctx.actor, &p.body);
        let (message, merged) = {
            let mut store = self.store()?;
            // Outside the transaction: a refusal keeps the drops `accept_receiver` reconciled.
            if let Some(node) = &receiver_status {
                accept_receiver(&self.inner, &mut store, node)?;
            }
            store.atomically(|store| {
                if let Some(reply_to) = p.reply_to
                    && store.get(reply_to)?.is_none()
                {
                    return Err(RpcError::new(
                        code::INVALID_PARAMS,
                        format!("replyTo names no Message: {reply_to}"),
                    ));
                }
                if let Some(wake) = wake {
                    self.fire_inside(store, wake)?;
                }
                if let Some(fire) = reaction {
                    store.check_firing(fire)?;
                }
                if let Some(c) = continuation
                    && store.accepted(c)?.is_some()
                {
                    return Err(RpcError::conflict("an action was already accepted"));
                }
                if !digest
                    && wake.is_none()
                    && reaction.is_none()
                    && continuation.is_none()
                    && store.count_open(&p.to)? >= OPEN_BOUND
                {
                    return Err(RpcError::conflict(format!(
                        "{} already has {OPEN_BOUND} pending Messages",
                        p.to
                    )));
                }
                // B10: a Message to the user is delivered at once, whatever Routes exist; the
                // user has no `idle` for B2's pending-until-idle rule to wait on.
                let (status, reason) = if p.to == Actor::user().id {
                    (MessageStatus::Delivered, None)
                } else {
                    let route = store
                        .get_route(&ctx.actor.id, &p.to)?
                        .unwrap_or(Delivery::Auto);
                    (send_status(ctx.actor.kind == ActorKind::User, route), None)
                };
                let mut folded = Vec::new();
                let mut body = p.body.clone();
                if merge {
                    let oldest = store.open_digests(&p.to)?;
                    let [first, second, ..] = oldest.as_slice() else {
                        return Err(RpcError::conflict("fewer than two pushed digests to merge"));
                    };
                    body = pushes::merged_body(first, second);
                    folded = vec![first.id, second.id];
                } else if digest && pushes::is_plain_push(&p.body) {
                    // B34: a plain push of a child stands for the older ones it waits with.
                    let names = pushes::names_in(&p.body);
                    let older: Vec<Message> = store
                        .open_digests(&p.to)?
                        .into_iter()
                        .filter(|m| {
                            pushes::is_plain_push(&m.body) && pushes::names_in(&m.body) == names
                        })
                        .collect();
                    let weight = 1 + older.iter().map(|m| pushes::weight(&m.body)).sum::<u32>();
                    body = pushes::counted(&p.body, weight);
                    folded = older.iter().map(|m| m.id).collect();
                }
                let message = store.insert(
                    &ctx.actor,
                    &p.to,
                    p.kind,
                    &body,
                    p.reply_to,
                    status,
                    reason,
                    (self.inner.clock)(),
                    receiver_status.as_ref().map_or((0, 0), binding),
                )?;
                if wake.is_some() {
                    (self.inner.fault)("wake").map_err(RpcError::internal)?;
                }
                if let Some(fire) = reaction {
                    store.accept_firing(fire, message.id)?;
                    (self.inner.fault)("reaction").map_err(RpcError::internal)?;
                }
                if let Some(c) = continuation {
                    store.accept_continuation(c, message.id)?;
                    (self.inner.fault)("continuation").map_err(RpcError::internal)?;
                }
                let mut merged = Vec::new();
                for id in folded {
                    if store.drop_merged(id)? {
                        merged.extend(store.get(id)?);
                    }
                }
                Ok((message, merged))
            })?
        };
        ctx.touch(Verb::Wrote, &item(message.id))?;
        ctx.emit(EventData::MessageSent(message.clone().into()));
        for folded in merged {
            ctx.emit(EventData::MessageDropped(folded.into()));
        }
        match message.status {
            MessageStatus::Delivered => {
                ctx.emit(EventData::MessageDelivered(message.clone().into()))
            }
            MessageStatus::Dropped => ctx.emit(EventData::MessageDropped(message.clone().into())),
            MessageStatus::Pending => {}
        }
        {
            let routing = async {
                // The Status read before the insert may be stale: an `idle` that landed between that read
                // and the insert found nothing pending and no other will follow. Read it again now that
                // the Message is stored; an `idle` after this read finds the Message itself.
                if message.status == MessageStatus::Pending && receiver_status.is_some() {
                    nudge(&self.inner, &p.to).await;
                }
            };
            // A ready future never blocked its caller. Retain evidence only after the
            // existing routing operation yields Pending, never pending-Message duration.
            let mut routing = std::pin::pin!(routing);
            let mut waiting = None;
            std::future::poll_fn(|cx| {
                let poll = routing.as_mut().poll(cx);
                if poll.is_pending() && waiting.is_none() && ctx.actor.kind == ActorKind::Agent {
                    waiting = self
                        .inner
                        .agents
                        .observe_coordination(&ctx.actor.id, message.id);
                }
                poll
            })
            .await;
            drop(waiting);
        }
        Ok(message)
    }
}
