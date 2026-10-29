//! A40–A42: durable intake and user-authorized Steers, separate from Message delivery.
use crate::*;
use contracts::ask::{
    Ask, AskPart as Part, PickParams, Placement as Place, SendParams, State, Target,
};
use placement::{Destination, EarlierAsk, Placement, Request};
use std::collections::HashSet;

mod store;
use store::Store;

pub struct Asks {
    shared: Arc<Intake>,
}
struct Intake {
    store: Mutex<Store>,
    agents: Arc<Agents>,
    placement: Arc<dyn Placement>,
    bus: Bus,
    /// Serialize call results in send order; delivery has one independent worker per Door.
    placing: Mutex<bool>,
    recovered: AtomicBool,
    doors: Mutex<HashSet<String>>,
}

impl Agents {
    /// A39: use the same Adapter program as Door launches.
    pub fn placement_call(&self) -> impl Placement + use<> {
        self.launcher
            .placement()
            .in_project(&self.shared.project_dir)
    }
}

impl Asks {
    pub fn open(
        dir: &Path,
        bus: Bus,
        agents: Arc<Agents>,
        placement: Arc<dyn Placement>,
    ) -> Result<Self, OpenError> {
        Ok(Self {
            shared: Arc::new(Intake {
                store: Mutex::new(Store::open(dir)?),
                agents,
                placement,
                bus,
                placing: Mutex::new(false),
                recovered: AtomicBool::new(false),
                doors: Mutex::new(HashSet::new()),
            }),
        })
    }
}

impl Intake {
    fn store(&self) -> MutexGuard<'_, Store> {
        agent_lock(&self.store).expect("Ask store lock")
    }
    fn emit(&self, id: &str) -> Result<Ask, RpcError> {
        let ask = self.store().get(id)?;
        self.bus.emit(
            Actor::user(),
            EventData::AskChanged {
                ask: Box::new(ask.clone()),
            },
        );
        Ok(ask)
    }

    fn enqueue(self: &Arc<Self>, ctx: Ctx) {
        let mut active = self.placing.lock().expect("Ask placement worker");
        if *active {
            return;
        }
        *active = true;
        let shared = self.clone();
        tokio::spawn(async move {
            loop {
                let next = {
                    let mut active = shared.placing.lock().expect("Ask placement worker");
                    let next = shared.store().next_placing().expect("read pending Ask");
                    if next.is_none() {
                        *active = false;
                    }
                    next
                };
                let Some(ask) = next else {
                    return;
                };
                if let Err(err) = shared.clone().place(user_ctx(&ctx), ask).await {
                    panic!("Ask placement worker: {err}");
                }
            }
        });
    }

    fn recover(self: &Arc<Self>, ctx: &Ctx) -> Result<(), RpcError> {
        if self.recovered.swap(true, Ordering::SeqCst) {
            return Ok(());
        }
        let asks = self.store().list()?;
        for ask in asks {
            for (ord, part) in ask.parts.iter().enumerate() {
                if part.state != State::Queued {
                    continue;
                }
                match &part.placement {
                    Place::Routed { workstream } => self.wake(ctx, workstream),
                    Place::New { .. } => self.start_new(ctx, &ask.id, ord),
                    _ => {}
                }
            }
        }
        Ok(())
    }

    async fn place(self: Arc<Self>, ctx: Ctx, ask: Ask) -> Result<(), RpcError> {
        let rail = self.agents.shared.tree()?;
        let captured = ask.parts.first().and_then(|part| match &part.placement {
            Place::Routed { workstream } => Some(workstream.clone()),
            _ => None,
        });
        let named = ask
            .text
            .strip_prefix('@')
            .filter(|_| captured.is_none())
            .and_then(|rest| {
                // Names may contain spaces. Match the longest supplied name before its separator.
                let max_prefix = rail
                    .iter()
                    .map(|node| node.name.chars().count() * 4)
                    .max()
                    .unwrap_or(0);
                rest.match_indices(' ')
                    .rev()
                    .filter(|(at, _)| *at <= max_prefix)
                    .find_map(|(at, _)| {
                        rail.iter()
                            .any(|node| {
                                node.kind == NodeKind::Workstream
                                    && node.name.to_lowercase() == rest[..at].to_lowercase()
                            })
                            .then_some((&rest[..at], &rest[at + 1..]))
                    })
                    .or_else(|| rest.split_once(' '))
            });
        let parts = if let Some(workstream) = captured {
            if !rail
                .iter()
                .any(|node| node.id == workstream && node.kind == NodeKind::Workstream)
            {
                return self.fail(
                    &ask.id,
                    0,
                    ask.parts[0].clone(),
                    "the Workstream was removed".into(),
                );
            }
            vec![placement::AskPart {
                text: ask.text.clone(),
                destination: Destination::Routed { workstream },
            }]
        } else if let Some((name, text)) = named {
            let ids: Vec<_> = rail
                .iter()
                .filter(|node| {
                    node.kind == NodeKind::Workstream
                        && node.name.to_lowercase() == name.to_lowercase()
                })
                .map(|node| node.id.clone())
                .collect();
            let destination = match ids.as_slice() {
                [id] => Destination::Routed {
                    workstream: id.clone(),
                },
                [] => Destination::Unclear {
                    question: format!("No Workstream is named {name}"),
                    candidates: ids,
                },
                _ => Destination::Unclear {
                    question: format!("{} Workstreams are named {name}", ids.len()),
                    candidates: ids,
                },
            };
            vec![placement::AskPart {
                text: text.into(),
                destination,
            }]
        } else {
            let mut earlier = self.store().list()?;
            // Discard newer sends, including sends whose placement is still pending.
            let at = earlier
                .iter()
                .position(|item| item.id == ask.id)
                .expect("stored Ask");
            earlier.drain(..=at);
            let earlier = earlier
                .into_iter()
                .take(5)
                .map(|ask| EarlierAsk {
                    at: ask.at,
                    parts: ask
                        .parts
                        .into_iter()
                        .map(|part| placement::AskPart {
                            text: part.text,
                            destination: match part.placement {
                                Place::Routed { workstream } => Destination::Routed { workstream },
                                Place::New { title, workstream } => workstream
                                    .map_or(Destination::New { title }, |workstream| {
                                        Destination::Routed { workstream }
                                    }),
                                Place::Unclear {
                                    question,
                                    candidates,
                                } => Destination::Unclear {
                                    question,
                                    candidates,
                                },
                            },
                        })
                        .collect(),
                })
                .collect();
            placement::place(
                self.placement.as_ref(),
                &ask.id,
                &Request::new(ask.text.clone(), earlier, rail),
                |id, cause| eprintln!("agents: Ask {id}: {cause}"),
            )
            .await
        };
        let parts: Vec<_> = parts
            .into_iter()
            .map(|part| {
                let placement = match part.destination {
                    Destination::Routed { workstream } => Place::Routed { workstream },
                    Destination::New { title } => Place::New {
                        title,
                        workstream: None,
                    },
                    Destination::Unclear {
                        question,
                        candidates,
                    } => Place::Unclear {
                        question,
                        candidates,
                    },
                };
                let state = if matches!(placement, Place::Unclear { .. }) {
                    State::Waiting
                } else {
                    State::Queued
                };
                Part {
                    text: part.text,
                    placement,
                    state,
                    reason: None,
                }
            })
            .collect();
        self.store().replace(&ask.id, &parts)?;
        self.emit(&ask.id)?;
        for (ord, part) in parts.into_iter().enumerate() {
            match part.placement {
                Place::Routed { workstream } => self.wake(&ctx, &workstream),
                Place::New { .. } => self.start_new(&ctx, &ask.id, ord),
                _ => {}
            }
        }
        Ok(())
    }

    fn start_new(self: &Arc<Self>, ctx: &Ctx, id: &str, ord: usize) {
        let shared = self.clone();
        let ctx = user_ctx(ctx);
        let id = id.to_owned();
        tokio::spawn(async move {
            if let Err(err) = shared.new_part(&ctx, &id, ord).await {
                panic!("Ask {id} creation worker: {err}");
            }
        });
    }

    /// A42, A4452d: type the part's words byte for byte into the new Door once it takes input.
    async fn type_part(&self, workstream: &str, attempt: &str, text: &str) -> Result<(), RpcError> {
        loop {
            let observed = self.agents.shared.events.observed.notified();
            let deadline = match self.agents.shared.runs().get(workstream) {
                Some(Slot::Running(run))
                    if run.attempt == attempt && !run.ended && !run.closing =>
                {
                    run.session_started
                        .map(|started| started + START_DOOR_ACK_BOUND)
                }
                _ => return Err(RpcError::not_accepted("prompt not accepted")),
            };
            let Some(deadline) = deadline else {
                observed.await;
                continue;
            };
            match self
                .agents
                .shared
                .prompt(
                    workstream,
                    text,
                    None,
                    true,
                    Some(PromptRecord {
                        attempt: Some(attempt.to_owned()),
                        revision: None,
                        written: None,
                    }),
                )
                .await
                .map_err(PromptError::from)
            {
                Ok(()) => return Ok(()),
                Err(PromptError::Busy { .. }) if tokio::time::Instant::now() < deadline => {
                    tokio::time::timeout_at(deadline, observed)
                        .await
                        .map_err(|_| RpcError::not_accepted("prompt not accepted"))?;
                }
                Err(_) => return Err(RpcError::not_accepted("prompt not accepted")),
            }
        }
    }

    async fn new_part(&self, ctx: &Ctx, id: &str, ord: usize) -> Result<(), RpcError> {
        let mut part = self.store().get(id)?.parts[ord].clone();
        let Place::New { title, .. } = &part.placement else {
            return Ok(());
        };
        let title = title.clone();
        // Claim before creating a Workstream; a crash may lose an effect, never duplicate it.
        part.state = State::Placing;
        if !self.store().update(id, ord, &part, State::Queued)? {
            return Ok(());
        }
        self.emit(id)?;
        let created = self.agents.call(ctx, "rail.createWorkstream", serde_json::json!({"name":title,"parent":null,"order":{"kind":"work","title":title,"ask":part.text,"limits":[]}})).await;
        let result = match created {
            Err(err) => Err(err),
            Ok(node) => {
                let workstream = node["id"]
                    .as_str()
                    .expect("created Workstream id")
                    .to_owned();
                part.placement = Place::New {
                    title,
                    workstream: Some(workstream.clone()),
                };
                self.store().update(id, ord, &part, State::Placing)?;
                self.emit(id)?;
                let result = self
                    .agents
                    .start_door_with(
                        ctx,
                        StartDoorParams {
                            cols: None,
                            rows: None,
                            id: workstream.clone(),
                            model: None,
                            effort: None,
                            engine: None,
                            permission_mode: None,
                        },
                        None,
                        false,
                    )
                    .await;
                match result {
                    Ok(node) => {
                        let attempt = node.attempt.expect("started Door attempt");
                        match self
                            .agents
                            .first_steer_completion(&workstream, &attempt)
                            .await
                        {
                            Ok(FirstSteerCompletion::Submitted) => {
                                // A4452d: the Order went to the inbox; the user's words are typed.
                                self.type_part(&workstream, &attempt, &part.text).await
                            }
                            _ => Err(RpcError::not_accepted("prompt not accepted")),
                        }
                    }
                    Err(err) => {
                        self.agents.shared.rail().remove(&workstream)?;
                        ctx.emit(EventData::RailChanged);
                        part.placement = match part.placement {
                            Place::New { title, .. } => Place::New {
                                title,
                                workstream: None,
                            },
                            _ => unreachable!(),
                        };
                        Err(err)
                    }
                }
            }
        };
        match result {
            Ok(()) => part.state = State::Typed,
            Err(err) => {
                part.state = State::Failed;
                part.reason = Some(err.message);
            }
        }
        self.store().update(id, ord, &part, State::Placing)?;
        self.emit(id)?;
        Ok(())
    }

    fn wake(self: &Arc<Self>, ctx: &Ctx, workstream: &str) {
        let mut doors = self.doors.lock().expect("Ask workers lock");
        if !doors.insert(workstream.into()) {
            return;
        }
        let shared = self.clone();
        let ctx = user_ctx(ctx);
        let workstream = workstream.to_owned();
        // Subscribe before scheduling so the first idle cannot be missed.
        let events = self.bus.subscribe();
        tokio::spawn(async move {
            if let Err(err) = shared.deliver(&ctx, &workstream, events).await {
                panic!("Ask Door worker {workstream}: {err}");
            }
        });
    }

    async fn deliver(
        self: &Arc<Self>,
        ctx: &Ctx,
        workstream: &str,
        mut events: Receiver<contracts::Event>,
    ) -> Result<(), RpcError> {
        loop {
            let pending = {
                // Same lock order as wake/finish so a concurrent enqueue cannot lose its wake.
                let mut doors = self.doors.lock().expect("Ask workers lock");
                let asks = self.store().list()?;
                let next = asks.into_iter().rev().find_map(|ask| ask.parts.into_iter().enumerate().find(|(_,part)| part.state == State::Queued && matches!(&part.placement,Place::Routed { workstream: id } if id == workstream)).map(|(ord,part)|(ask.id,ord,part)));
                if next.is_none() {
                    doors.remove(workstream);
                }
                next
            };
            let Some((id, ord, mut part)) = pending else {
                return Ok(());
            };
            let node = self.agents.shared.node(workstream);
            let result: Result<(), String> = match node {
                Err(_) => Err("the Workstream was removed".to_owned()),
                Ok(node) => {
                    if node.terminal_id.is_none() {
                        match self
                            .agents
                            .start_door(
                                ctx,
                                StartDoorParams {
                                    cols: None,
                                    rows: None,
                                    id: workstream.into(),
                                    model: None,
                                    effort: None,
                                    engine: None,
                                    permission_mode: None,
                                },
                            )
                            .await
                        {
                            Ok(started) => {
                                if let Some(attempt) = started.attempt {
                                    match self
                                        .agents
                                        .first_steer_completion(workstream, &attempt)
                                        .await
                                    {
                                        Ok(_) => continue,
                                        Err(err) => {
                                            self.fail(&id, ord, part, err.to_string())?;
                                            continue;
                                        }
                                    }
                                }
                            }
                            Err(err) => {
                                let reason = if self.agents.shared.node(workstream).is_err() {
                                    "the Workstream was removed".to_owned()
                                } else {
                                    err.message
                                };
                                self.fail(&id, ord, part, reason)?;
                                continue;
                            }
                        }
                    }
                    if node
                        .status
                        .as_ref()
                        .is_none_or(|status| status.kind != Kind::Idle)
                        || node.terminal_id.is_none()
                    {
                        match events.recv().await {
                            Ok(_) | Err(RecvError::Lagged(_)) => continue,
                            Err(RecvError::Closed) => return Ok(()),
                        }
                    }
                    // Claim before prompt. BUSY guarantees no bytes and is the only retry.
                    part.state = State::Typed;
                    if !self.store().update(&id, ord, &part, State::Queued)? {
                        continue;
                    }
                    let intake = self.clone();
                    let ask_id = id.clone();
                    match self
                        .agents
                        .shared
                        .prompt(
                            workstream,
                            &part.text,
                            None,
                            true,
                            Some(crate::PromptRecord {
                                attempt: None,
                                revision: None,
                                written: Some(Arc::new(move |_| intake.emit(&ask_id).map(|_| ()))),
                            }),
                        )
                        .await
                        .map_err(PromptError::from)
                    {
                        Ok(()) => continue,
                        Err(PromptError::Busy { .. }) => {
                            part.state = State::Queued;
                            self.store().update(&id, ord, &part, State::Typed)?;
                            match events.recv().await {
                                Ok(_) | Err(RecvError::Lagged(_)) => continue,
                                Err(RecvError::Closed) => return Ok(()),
                            }
                        }
                        Err(PromptError::NotFound { .. }) => {
                            Err("the Door ended before this reached it".into())
                        }
                        Err(err) => Err(err.to_string()),
                    }
                }
            };
            if let Err(reason) = result {
                self.fail(&id, ord, part, reason)?;
            }
        }
    }

    fn fail(&self, id: &str, ord: usize, mut part: Part, reason: String) -> Result<(), RpcError> {
        let from = part.state;
        part.state = State::Failed;
        part.reason = Some(reason);
        self.store().update(id, ord, &part, from)?;
        self.emit(id)?;
        Ok(())
    }
}

fn user_ctx(ctx: &Ctx) -> Ctx {
    Ctx {
        actor: Actor::user(),
        bus: ctx.bus.clone(),
        touches: ctx.touches.clone(),
    }
}

#[async_trait]
impl Module for Asks {
    fn namespaces(&self) -> &'static [&'static str] {
        &["ask"]
    }
    async fn call(&self, ctx: &Ctx, method: &str, value: Value) -> Result<Value, RpcError> {
        if ctx.actor.kind != ActorKind::User {
            return Err(RpcError::forbidden(
                "Ask methods carry a Steer from the user",
            ));
        }
        contracts::asks_methods!(rpc::dispatch_methods, self, ctx, method, value)
    }
}

impl Asks {
    async fn rpc_ask_send(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        let shared = &self.shared;
        {
            let SendParams {
                text,
                submission,
                workstream,
            } = params(value)?;
            if submission
                .as_ref()
                .is_some_and(|id| id.is_empty() || id.len() > 128)
            {
                return Err(RpcError::new(
                    code::INVALID_PARAMS,
                    "invalid Ask submission identity",
                ));
            }
            if text.trim().is_empty() || text.len() > 32_768 {
                return Err(RpcError::new(
                    code::INVALID_PARAMS,
                    "Ask text must be non-empty and at most 32768 bytes",
                ));
            }
            let ask = {
                let mut store = shared.store();
                if let Some(id) = &submission
                    && let Some(ask) = store.replay(id, &text, workstream.as_deref())?
                {
                    return reply(&ask);
                }
                if let Some(id) = &workstream {
                    let node = shared.agents.shared.node(id)?;
                    if node.kind != NodeKind::Workstream {
                        return Err(RpcError::new(
                            code::INVALID_PARAMS,
                            "target must be a Workstream",
                        ));
                    }
                }
                store.insert(text, (shared.agents.shared.clock)(), submission, workstream)?
            };
            shared.recover(ctx)?;
            shared.emit(&ask.id)?;
            shared.enqueue(user_ctx(ctx));
            reply(&ask)
        }
    }

    async fn rpc_ask_list(
        &self,
        _ctx: &Ctx,
        _method: &str,
        _value: Value,
    ) -> Result<Value, RpcError> {
        let shared = &self.shared;
        reply(&shared.store().list()?)
    }

    async fn rpc_ask_pick(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        let shared = &self.shared;
        {
            shared.recover(ctx)?;
            let PickParams {
                id,
                part: ord,
                target,
            } = params(value)?;
            let mut store = shared.store();
            let ask = store.get(&id)?;
            let mut part = ask
                .parts
                .get(ord)
                .ok_or_else(|| RpcError::new(code::INVALID_PARAMS, "unknown Ask part"))?
                .clone();
            if !matches!(part.state, State::Waiting | State::Failed) {
                return Err(RpcError::conflict("Ask part is not waiting or failed"));
            }
            let from = part.state;
            match target {
                Target::Drop => part.state = State::Dropped,
                Target::Workstream { id } => {
                    if shared
                        .agents
                        .shared
                        .node(&id)
                        .map_err(|_| RpcError::new(code::INVALID_PARAMS, "unknown Workstream"))?
                        .kind
                        != NodeKind::Workstream
                    {
                        return Err(RpcError::new(
                            code::INVALID_PARAMS,
                            "target must be a Workstream",
                        ));
                    }
                    part.placement = Place::Routed { workstream: id };
                    part.state = State::Queued;
                }
                Target::New { title } => {
                    let title = title.unwrap_or_else(|| {
                        part.text
                            .split_whitespace()
                            .take(6)
                            .collect::<Vec<_>>()
                            .join(" ")
                    });
                    Order::Work {
                        title: Some(title.clone()),
                        ask: part.text.clone(),
                        done: None,
                        limits: vec![],
                    }
                    .validate_explicit()
                    .map_err(|err| RpcError::new(code::INVALID_PARAMS, err))?;
                    part.placement = Place::New {
                        title,
                        workstream: None,
                    };
                    part.state = State::Queued;
                }
            }
            part.reason = None;
            store.update(&id, ord, &part, from)?;
            drop(store);
            let ask = shared.emit(&id)?;
            match part.placement {
                Place::Routed { workstream } if part.state == State::Queued => {
                    shared.wake(ctx, &workstream)
                }
                Place::New { .. } if part.state == State::Queued => shared.start_new(ctx, &id, ord),
                _ => {}
            }
            reply(&ask)
        }
    }
}

#[cfg(test)]
#[path = "asks/readiness_tests.rs"]
mod readiness_tests;
