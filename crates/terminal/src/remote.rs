//! The existing Rust seam over a verified owner connection. Closures stay on the local input
//! thread; its writer awaits the owner's physical write, without retrying an uncertain result.
use super::*;
use serde::de::DeserializeOwned;
use serde_json::json;

type Request = (String, Value, mpsc::SyncSender<Result<Value, RpcError>>);
const DEADLINE: Duration = Duration::from_secs(5);

pub(super) struct Remote {
    owner: TerminalOwner,
    home: Option<String>,
    id: String,
    original: String,
    requests: tokio::sync::mpsc::Sender<Request>,
    input: SyncSender<Input>,
    events: broadcast::Sender<Arc<EventData>>,
    output: Arc<Mutex<(u64, Option<broadcast::Sender<Chunk>>)>>,
}

impl Terminals {
    /// Opt into independent owners for subsequent spawns. Opening still starts nothing.
    pub fn with_terminal_owner(mut self, helper: &Path) -> Self {
        self.owner_helper = Some(helper.to_owned());
        self
    }

    /// Persist these verified records for explicit attachment in a fresh client.
    pub fn terminal_owners(&self) -> Vec<TerminalOwner> {
        self.remotes
            .lock()
            .expect("remote table")
            .values()
            .map(|remote| remote.owner.clone())
            .collect()
    }

    /// The persistable owner record behind client Terminal `id`; `None` for a Terminal this
    /// client owns directly.
    pub fn terminal_owner(&self, id: &str) -> Option<TerminalOwner> {
        let number = id.parse().ok()?;
        self.remotes
            .lock()
            .expect("remote table")
            .get(&number)
            .map(|remote| remote.owner.clone())
    }

    /// Attach a persisted owner record of this Terminals' own Project, launching nothing and
    /// sending no input (X8). The record's incarnation is verified before it gets a client id.
    pub async fn reattach_owner(&self, owner: &TerminalOwner) -> Result<Spawned, RpcError> {
        let project = self.integration_dir.parent().expect("Project data");
        self.attach_owner(project, owner).await
    }

    pub(super) async fn start_owner(
        &self,
        helper: &Path,
        params: SpawnParams,
        home: Option<String>,
    ) -> Result<Spawned, RpcError> {
        let project = self.integration_dir.parent().expect("Project data");
        let (owner, mut child) =
            TerminalOwner::start_with(helper, project, params, &self.shared.clean_env)
                .map_err(RpcError::internal)?;
        let result = self.attach_owner(project, &owner).await;
        if result.is_err()
            && let Ok(client) = owner.connect(project).await
        {
            let _ = tokio::time::timeout(
                DEADLINE,
                client.request("terminal.kill", json!({"id":owner.info.id})),
            )
            .await;
        }
        std::thread::spawn(move || {
            let _ = child.wait();
        });
        let spawned = result?;
        let number = parse_terminal_number(&spawned.id)?;
        if let Some(remote) = self.remotes.lock().expect("remote table").get_mut(&number) {
            Arc::get_mut(remote).expect("new attachment").home = home;
        }
        Ok(spawned)
    }

    /// Attach an explicitly supplied persisted owner record, without starting anything. A client
    /// id is allocated independently of the owner's local id and routes only to this incarnation.
    pub async fn attach_owner(
        &self,
        project: &Path,
        owner: &TerminalOwner,
    ) -> Result<Spawned, RpcError> {
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        let (remote, output, events) =
            Remote::connect(id.to_string(), project, owner, self.shared.bus.clone())?;
        let spawned = Spawned {
            id: id.to_string(),
            events,
            output,
        };
        self.remotes
            .lock()
            .expect("remote table")
            .insert(id, Arc::new(remote));
        Ok(spawned)
    }

    pub(super) fn remote(&self, id: &str) -> Result<Option<Arc<Remote>>, RpcError> {
        Ok(self
            .remotes
            .lock()
            .expect("remote table")
            .get(&parse_terminal_number(id)?)
            .cloned())
    }
}

impl Remote {
    fn connect(
        id: String,
        project: &Path,
        owner: &TerminalOwner,
        bus: Bus,
    ) -> Result<(Self, OutputStream, broadcast::Receiver<Arc<EventData>>), RpcError> {
        let project = project.to_owned();
        let record = owner.clone();
        let owner = owner.clone();
        let original = owner.info.id.clone();
        let (requests, mut received) = tokio::sync::mpsc::channel::<Request>(WRITE_BACKLOG);
        let (ready, result) = mpsc::sync_channel(1);
        let (events, event_receiver) = broadcast::channel(EVENT_BACKLOG);
        let (chunks, receiver) = broadcast::channel(OUTPUT_BACKLOG);
        let output = Arc::new(Mutex::new((0, Some(chunks))));
        let pushed = output.clone();
        let published = events.clone();
        let client_id = id.clone();
        std::thread::Builder::new().name(format!("terminal-owner-{id}")).spawn(move || {
            let runtime = match tokio::runtime::Builder::new_current_thread().enable_all().build() {
                Ok(runtime) => runtime,
                Err(error) => { let _ = ready.send(Err(RpcError::internal(error))); return; }
            };
            runtime.block_on(async move {
                let setup = async {
                    let client = owner.connect(&project).await?;
                    let input_client = owner.connect(&project).await?;
                    let mut event_client = owner.connect(&project).await?;
                    let output = event_client.take_output().ok_or_else(|| RpcError::internal("owner output"))?;
                    let selected = event_client.request("terminal.output", json!({"id":owner.info.id})).await?;
                    let cut = selected["offset"].as_u64().ok_or_else(|| RpcError::internal("owner offset"))?;
                    let catch_up: contracts::terminal::CatchUp = params(client.request("terminal.catchUp", json!({"id":owner.info.id,"incarnation":owner.info.incarnation,"after":0})).await?)?;
                    {
                    let mut state = pushed.lock().expect("remote output");
                    if let contracts::terminal::CatchUp::Contiguous { data, .. } = catch_up {
                        let mut bytes = STANDARD.decode(data).map_err(RpcError::internal)?;
                        bytes.truncate(usize::try_from(cut).map_err(RpcError::internal)?);
                        if !bytes.is_empty() { let _ = state.1.as_ref().expect("output sender").send(Chunk { offset: 0, bytes: Arc::from(bytes) }); }
                    }
                    state.0 = cut;
                    }
                    // Refuse an exit during stream selection or catch-up before publishing attachment.
                    let infos: Vec<TerminalInfo> = params(client.request("terminal.list", json!({})).await?)?;
                    if infos.len() != 1 || !infos[0].running || infos[0].incarnation != owner.info.incarnation {
                        return Err(RpcError::not_found("live Terminal incarnation"));
                    }
                    Ok((client, input_client, event_client, output))
                };
                let (client, input_client, mut event_client, mut output) = match tokio::time::timeout(DEADLINE, setup).await {
                    Ok(Ok(connected)) => connected,
                    Ok(Err(error)) => { let _ = ready.send(Err(error)); return; }
                    Err(_) => { let _ = ready.send(Err(RpcError::internal("owner attachment timed out"))); return; }
                };
                let _ = ready.send(Ok(()));
                let client = Arc::new(client);
                let input_client = Arc::new(input_client);
                let mut calls = tokio::task::JoinSet::new();
                loop {
                    tokio::select! {
                        request = received.recv(), if calls.len() < WRITE_BACKLOG => {
                            let Some((method, value, response)) = request else { break; };
                            let client = if method == "terminal.write" { input_client.clone() } else { client.clone() };
                            calls.spawn(async move {
                                let result = tokio::time::timeout(DEADLINE, client.request(&method, value)).await
                                    .unwrap_or_else(|_| Err(RpcError::unknown_outcome("owner result lost; do not retry")));
                                let _ = response.send(result);
                            });
                        }
                        Some(_) = calls.join_next() => {}
                        frame = output.recv() => {
                            match frame {
                                Ok(rpc::OutputFrame::Bytes(frame)) => {
                                    match STANDARD.decode(frame.data) {
                                        Ok(bytes) => {
                                            let mut state = pushed.lock().expect("remote output");
                                            if let Some(sender) = &state.1 {
                                                let _ = sender.send(Chunk { offset: frame.offset, bytes: Arc::from(bytes.clone()) });
                                                state.0 = frame.offset + bytes.len() as u64;
                                            }
                                        }
                                        Err(_) => break,
                                    }
                                }
                                Ok(rpc::OutputFrame::Gap(_)) | Err(broadcast::error::RecvError::Lagged(_)) => {
                                    // The next byte chunk retains its authoritative offset; OutputStream reports the gap.
                                }
                                Err(broadcast::error::RecvError::Closed) => break,
                            }
                        }
                        event = event_client.next_event() => {
                            let Some(event) = event else { break; };
                            let mut data = event.data;
                            match &mut data {
                                EventData::TerminalTitle(event) => event.id = client_id.clone(),
                                EventData::TerminalExited(event) => event.id = client_id.clone(),
                                _ => continue,
                            }
                            if matches!(data, EventData::TerminalExited(_)) {
                                let after = pushed.lock().expect("remote output").0;
                                let tail = tokio::time::timeout(DEADLINE, client.request("terminal.catchUp", json!({"id":owner.info.id,"incarnation":owner.info.incarnation,"after":after}))).await;
                                let mut state = pushed.lock().expect("remote output");
                                if let Ok(Ok(value)) = tail {
                                    match params::<contracts::terminal::CatchUp>(value) {
                                        Ok(contracts::terminal::CatchUp::Contiguous { from, after, data, .. }) => {
                                            if let Ok(bytes) = STANDARD.decode(data) {
                                                if !bytes.is_empty() { let _ = state.1.as_ref().expect("output sender").send(Chunk { offset: from, bytes: Arc::from(bytes) }); }
                                                state.0 = after;
                                            }
                                        }
                                        Ok(contracts::terminal::CatchUp::Gap { after, .. }) => {
                                            let _ = state.1.as_ref().expect("output sender").send(Chunk { offset: after, bytes: Arc::from([]) });
                                            state.0 = after;
                                        }
                                        Err(_) => {}
                                    }
                                }
                                state.1 = None;
                            }
                            bus.emit(Actor::daemon(), data.clone());
                            let _ = published.send(Arc::new(data));
                        }
                    }
                }
            });
        }).map_err(RpcError::internal)?;
        result
            .recv_timeout(DEADLINE + Duration::from_secs(1))
            .map_err(RpcError::internal)??;
        let (input, queued) = mpsc::sync_channel(WRITE_BACKLOG);
        let writer = RemoteWriter {
            requests: requests.clone(),
            original: original.clone(),
        };
        std::thread::Builder::new()
            .name(format!("terminal-input-{id}"))
            .spawn(move || {
                pty::type_queued(0, queued, Box::new(writer), recorder::clock());
            })
            .map_err(RpcError::internal)?;
        Ok((
            Self {
                owner: record,
                home: None,
                id,
                original,
                requests,
                input,
                events,
                output,
            },
            OutputStream {
                receiver,
                next: 0,
                after_gap: None,
            },
            event_receiver,
        ))
    }

    pub(super) fn call<T: DeserializeOwned>(
        &self,
        method: &str,
        mut value: Value,
    ) -> Result<T, RpcError> {
        if let Some(id) = value.get_mut("id") {
            *id = json!(self.original);
        }
        let mut result = request(&self.requests, method, value)?;
        if let Some(id) = result.get_mut("id") {
            *id = json!(self.id);
        }
        params(result)
    }

    pub(super) fn info(&self) -> Result<TerminalInfo, RpcError> {
        let mut infos: Vec<TerminalInfo> = self.call("terminal.list", json!({}))?;
        if infos.len() != 1 {
            return Err(RpcError::not_found("owned Terminal"));
        }
        let mut info = infos.remove(0);
        info.id = self.id.clone();
        info.owner = self.home.clone();
        Ok(info)
    }

    /// `info` off the calling thread and bounded by `DEADLINE`: an owner that does not answer is an error.
    pub(super) async fn info_within_deadline(self: &Arc<Self>) -> Result<TerminalInfo, RpcError> {
        let remote = Arc::clone(self);
        match tokio::time::timeout(DEADLINE, tokio::task::spawn_blocking(move || remote.info()))
            .await
        {
            Ok(Ok(info)) => info,
            _ => Err(RpcError::unknown_outcome("owner did not answer")),
        }
    }

    pub(super) fn enqueue(&self, input: Input) -> Result<(), RpcError> {
        self.input.try_send(input).map_err(|error| match error {
            TrySendError::Full(_) => RpcError::conflict("Terminal input queue full"),
            TrySendError::Disconnected(_) => RpcError::not_found("Terminal input"),
        })
    }

    pub(super) fn subscribe(&self) -> Result<broadcast::Receiver<Arc<EventData>>, RpcError> {
        if !self.info()?.running {
            return Err(RpcError::not_found("running Terminal"));
        }
        Ok(self.events.subscribe())
    }

    pub(super) fn subscribe_output(&self) -> Result<OutputStream, RpcError> {
        let state = self.output.lock().expect("remote output");
        Ok(OutputStream {
            receiver: state
                .1
                .as_ref()
                .ok_or_else(|| RpcError::not_found("running Terminal"))?
                .subscribe(),
            next: state.0,
            after_gap: None,
        })
    }
}

fn request(
    sender: &tokio::sync::mpsc::Sender<Request>,
    method: &str,
    value: Value,
) -> Result<Value, RpcError> {
    let (response, result) = mpsc::sync_channel(1);
    sender
        .try_send((method.to_owned(), value, response))
        .map_err(|_| RpcError::conflict("owner request queue unavailable"))?;
    result
        .recv_timeout(DEADLINE + Duration::from_secs(1))
        .map_err(|_| RpcError::unknown_outcome("owner result lost; do not retry"))?
}

struct RemoteWriter {
    requests: tokio::sync::mpsc::Sender<Request>,
    original: String,
}

impl Write for RemoteWriter {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        request(
            &self.requests,
            "terminal.write",
            json!({"id":self.original,"data":STANDARD.encode(bytes)}),
        )
        .map_err(std::io::Error::other)?;
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

impl Terminals {
    pub(super) async fn close_remote(&self, id: &str) -> Result<bool, RpcError> {
        let Some(remote) = self.remote(id)? else {
            return Ok(false);
        };
        if remote.home.is_none() {
            return Err(invalid("Terminal has no owner to close it"));
        }
        if remote.info()?.running {
            self.kill(id).await?;
        }
        self.remotes
            .lock()
            .expect("remote table")
            .remove(&parse_terminal_number(id)?);
        self.shared
            .bus
            .emit(Actor::daemon(), EventData::TerminalChanged);
        Ok(true)
    }

    pub(super) async fn close_remote_owned(&self, home: &str) -> Result<bool, RpcError> {
        let entries: Vec<_> = self
            .remotes
            .lock()
            .expect("remote table")
            .iter()
            .filter(|(_, remote)| remote.home.as_deref() == Some(home))
            .map(|(id, remote)| (*id, remote.clone()))
            .collect();
        for (number, remote) in &entries {
            if remote.info()?.running {
                self.kill(&number.to_string()).await?;
            }
            self.remotes.lock().expect("remote table").remove(number);
        }
        Ok(!entries.is_empty())
    }

    pub(super) fn make_remote_space(&self, home: &str) -> Result<bool, RpcError> {
        let entries: Vec<_> = self
            .remotes
            .lock()
            .expect("remote table")
            .iter()
            .filter(|(_, remote)| remote.home.as_deref() == Some(home))
            .map(|(id, remote)| (*id, remote.clone()))
            .collect();
        if entries.len() < OWNED_CAP {
            return Ok(false);
        }
        for (number, remote) in entries {
            if !remote.info()?.running {
                self.remotes.lock().expect("remote table").remove(&number);
                return Ok(true);
            }
        }
        Err(RpcError::conflict(format!(
            "{home} already runs {OWNED_CAP} terminals"
        )))
    }

    pub(super) fn remote_scheme(&self, params: &SchemeParams) -> Result<(), RpcError> {
        let entries: Vec<_> = self
            .remotes
            .lock()
            .expect("remote table")
            .values()
            .cloned()
            .collect();
        for remote in entries {
            remote.call::<()>(
                "terminal.scheme",
                serde_json::to_value(params).map_err(RpcError::internal)?,
            )?;
        }
        Ok(())
    }
}
