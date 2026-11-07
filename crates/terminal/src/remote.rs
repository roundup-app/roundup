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
        match self.remotes.locked("remote table") {
            Ok(remotes) => remotes
                .values()
                .map(|remote| remote.owner.clone())
                .collect(),
            Err(err) => {
                eprintln!("terminal owners not listed: {err}");
                Vec::new()
            }
        }
    }

    /// The persistable owner record behind client Terminal `id`; `Ok(None)` for a Terminal this
    /// client owns directly. A poisoned remote table is an error, never "owned directly" (X6570a).
    pub fn terminal_owner(&self, id: &str) -> Result<Option<TerminalOwner>, RpcError> {
        let Ok(number) = id.parse::<u64>() else {
            return Ok(None);
        };
        let remotes = self.remotes.locked("remote table")?;
        Ok(remotes.get(&number).map(|remote| remote.owner.clone()))
    }

    /// X6570a: poison the remote table as a panic in another thread would.
    #[cfg(feature = "test-support")]
    #[allow(
        clippy::panic,
        reason = "only a panic while the lock is taken poisons a Mutex"
    )]
    pub fn poison_remote_table_for_test(&self) {
        let _ = std::thread::scope(|scope| {
            scope
                .spawn(|| {
                    let _guard = self.remotes.lock();
                    panic!("poison the remote table");
                })
                .join()
        });
    }

    /// Attach a persisted owner record of this Terminals' own Project, launching nothing and
    /// sending no input (X8). The record's incarnation is verified before it gets a client id.
    pub async fn reattach_owner(&self, owner: &TerminalOwner) -> Result<Spawned, RpcError> {
        let project = self.project_dir()?;
        self.attach_owner(project, owner).await
    }

    pub(super) async fn start_owner(
        &self,
        helper: &Path,
        params: SpawnParams,
        home: Option<String>,
    ) -> Result<Spawned, Error> {
        let project = self.project_dir()?;
        let scheme = self
            .shared
            .scheme
            .locked("terminal scheme lock")?
            .map(scheme::Palette::params);
        let (owner, mut child) =
            TerminalOwner::start_with(helper, project, params, &self.shared.clean_env, scheme)
                .map_err(Error::internal)?;
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
        if let Some(remote) = self.remotes.locked("remote table")?.get_mut(&number) {
            Arc::get_mut(remote)
                .ok_or_else(|| Error::internal("new attachment is already shared"))?
                .home = home;
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
        let scheme = self
            .shared
            .scheme
            .locked("terminal scheme lock")?
            .map(scheme::Palette::params);
        if let Some(scheme) = scheme {
            remote.call::<()>(
                "terminal.scheme",
                serde_json::to_value(scheme).map_err(Error::internal)?,
            )?;
        }
        let spawned = Spawned {
            id: id.to_string(),
            events,
            output,
        };
        self.remotes
            .locked("remote table")?
            .insert(id, Arc::new(remote));
        Ok(spawned)
    }

    fn project_dir(&self) -> Result<&Path, Error> {
        self.integration_dir
            .parent()
            .ok_or_else(|| Error::internal("integration directory has no Project data"))
    }

    pub(super) fn remote(&self, id: &str) -> Result<Option<Arc<Remote>>, Error> {
        Ok(self
            .remotes
            .locked("remote table")?
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
    ) -> Result<(Self, OutputStream, broadcast::Receiver<Arc<EventData>>), Error> {
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
                Err(error) => { let _ = ready.send(Err(Error::internal(error))); return; }
            };
            runtime.block_on(async move {
                let setup = async {
                    let client = owner.connect(&project).await?;
                    let input_client = owner.connect(&project).await?;
                    let mut event_client = owner.connect(&project).await?;
                    let output = event_client.take_output().ok_or_else(|| Error::internal("owner output"))?;
                    let selected = event_client.request("terminal.output", json!({"id":owner.info.id})).await?;
                    let cut = selected.get("offset").and_then(Value::as_u64).ok_or_else(|| Error::internal("owner offset"))?;
                    let catch_up: contracts::terminal::CatchUp = params(client.request("terminal.catchUp", json!({"id":owner.info.id,"incarnation":owner.info.incarnation,"after":0})).await?)?;
                    {
                    let mut state = pushed.locked("remote output")?;
                    if let contracts::terminal::CatchUp::Contiguous { data, .. } = catch_up {
                        let mut bytes = STANDARD.decode(data).map_err(Error::internal)?;
                        bytes.truncate(usize::try_from(cut).map_err(Error::internal)?);
                        if !bytes.is_empty() && let Some(sender) = state.1.as_ref() { let _ = sender.send(Chunk { offset: 0, bytes: Arc::from(bytes) }); }
                    }
                    state.0 = cut;
                    }
                    // Refuse an exit during stream selection or catch-up before publishing attachment.
                    let infos: Vec<TerminalInfo> = params(client.request("terminal.list", json!({})).await?)?;
                    if !matches!(infos.as_slice(), [only] if only.running && only.incarnation == owner.info.incarnation) {
                        return Err(Error::not_found("live Terminal incarnation"));
                    }
                    Ok((client, input_client, event_client, output))
                };
                let (client, input_client, mut event_client, mut output) = match tokio::time::timeout(DEADLINE, setup).await {
                    Ok(Ok(connected)) => connected,
                    Ok(Err(error)) => { let _ = ready.send(Err(error)); return; }
                    Err(_) => { let _ = ready.send(Err(Error::internal("owner attachment timed out"))); return; }
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
                                            let Ok(mut state) = pushed.locked("remote output") else { break };
                                            publish_output(&mut state, frame.offset, bytes);
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
                                let Ok(after) = pushed.locked("remote output").map(|state| state.0) else { break };
                                let tail = tokio::time::timeout(DEADLINE, client.request("terminal.catchUp", json!({"id":owner.info.id,"incarnation":owner.info.incarnation,"after":after}))).await;
                                let Ok(mut state) = pushed.locked("remote output") else { break };
                                if let Ok(Ok(value)) = tail {
                                    match params::<contracts::terminal::CatchUp>(value) {
                                        Ok(contracts::terminal::CatchUp::Contiguous { from, after, data, .. }) => {
                                            if let Ok(bytes) = STANDARD.decode(data) {
                                                if !bytes.is_empty() { publish_output(&mut state, from, bytes); }
                                                state.0 = after;
                                            }
                                        }
                                        Ok(contracts::terminal::CatchUp::Gap { after, .. }) => {
                                            if let Some(sender) = state.1.as_ref() { let _ = sender.send(Chunk { offset: after, bytes: Arc::from([]) }); }
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
        }).map_err(Error::internal)?;
        result
            .recv_timeout(DEADLINE + Duration::from_secs(1))
            .map_err(Error::internal)??;
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
            .map_err(Error::internal)?;
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
    ) -> Result<T, Error> {
        if let Some(id) = value.get_mut("id") {
            *id = json!(self.original);
        }
        let mut result = request(&self.requests, method, value)?;
        if let Some(id) = result.get_mut("id") {
            *id = json!(self.id);
        }
        Ok(params(result)?)
    }

    pub(super) fn info(&self) -> Result<TerminalInfo, Error> {
        let mut infos: Vec<TerminalInfo> = self.call("terminal.list", json!({}))?;
        let (1, Some(mut info)) = (infos.len(), infos.pop()) else {
            return Err(Error::not_found("owned Terminal"));
        };
        info.id = self.id.clone();
        info.owner = self.home.clone();
        Ok(info)
    }

    /// `info` off the calling thread and bounded by `DEADLINE`: an owner that does not answer is an error.
    pub(super) async fn info_within_deadline(self: &Arc<Self>) -> Result<TerminalInfo, Error> {
        let remote = Arc::clone(self);
        match tokio::time::timeout(DEADLINE, tokio::task::spawn_blocking(move || remote.info()))
            .await
        {
            Ok(Ok(info)) => info,
            _ => Err(Error::unknown_outcome("owner did not answer")),
        }
    }

    pub(super) fn enqueue(&self, input: Input) -> Result<(), Error> {
        self.input.try_send(input).map_err(|error| match error {
            TrySendError::Full(_) => Error::conflict("Terminal input queue full"),
            TrySendError::Disconnected(_) => Error::not_found("Terminal input"),
        })
    }

    pub(super) fn subscribe(&self) -> Result<broadcast::Receiver<Arc<EventData>>, Error> {
        if !self.info()?.running {
            return Err(Error::not_found("running Terminal"));
        }
        Ok(self.events.subscribe())
    }

    pub(super) fn subscribe_output(&self) -> Result<OutputStream, Error> {
        let state = self.output.locked("remote output")?;
        Ok(OutputStream {
            receiver: state
                .1
                .as_ref()
                .ok_or_else(|| Error::not_found("running Terminal"))?
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
) -> Result<Value, Error> {
    let (response, result) = mpsc::sync_channel(1);
    sender
        .try_send((method.to_owned(), value, response))
        .map_err(|_| Error::conflict("owner request queue unavailable"))?;
    result
        .recv_timeout(DEADLINE + Duration::from_secs(1))
        .map_err(|_| Error::unknown_outcome("owner result lost; do not retry"))?
        .map_err(Error::from)
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
    pub(super) async fn close_remote(&self, id: &str) -> Result<bool, Error> {
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
            .locked("remote table")?
            .remove(&parse_terminal_number(id)?);
        self.shared
            .bus
            .emit(Actor::daemon(), EventData::TerminalChanged);
        Ok(true)
    }

    pub(super) async fn close_remote_owned(&self, home: &str) -> Result<bool, Error> {
        let entries: Vec<_> = self
            .remotes
            .locked("remote table")?
            .iter()
            .filter(|(_, remote)| remote.home.as_deref() == Some(home))
            .map(|(id, remote)| (*id, remote.clone()))
            .collect();
        for (number, remote) in &entries {
            if remote.info()?.running {
                self.kill(&number.to_string()).await?;
            }
            self.remotes.locked("remote table")?.remove(number);
        }
        Ok(!entries.is_empty())
    }

    pub(super) fn make_remote_space(&self, home: &str) -> Result<bool, Error> {
        let entries: Vec<_> = self
            .remotes
            .locked("remote table")?
            .iter()
            .filter(|(_, remote)| remote.home.as_deref() == Some(home))
            .map(|(id, remote)| (*id, remote.clone()))
            .collect();
        if entries.len() < OWNED_CAP {
            return Ok(false);
        }
        for (number, remote) in entries {
            if !remote.info()?.running {
                self.remotes.locked("remote table")?.remove(&number);
                return Ok(true);
            }
        }
        Err(Error::conflict(format!(
            "{home} already runs {OWNED_CAP} terminals"
        )))
    }

    pub(super) fn remote_scheme(&self, params: &SchemeParams) -> Result<(), Error> {
        let entries: Vec<_> = self
            .remotes
            .locked("remote table")?
            .values()
            .cloned()
            .collect();
        for remote in entries {
            remote.call::<()>(
                "terminal.scheme",
                serde_json::to_value(params).map_err(Error::internal)?,
            )?;
        }
        Ok(())
    }
}

fn publish_output(
    state: &mut (u64, Option<broadcast::Sender<Chunk>>),
    offset: u64,
    bytes: Vec<u8>,
) {
    if let Some(sender) = &state.1 {
        let length = bytes.len() as u64;
        let _ = sender.send(Chunk {
            offset,
            bytes: Arc::from(bytes),
        });
        state.0 = offset + length;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use stats_alloc::{INSTRUMENTED_SYSTEM, Region, StatsAlloc};
    use std::alloc::System;

    #[global_allocator]
    static ALLOCATOR: &StatsAlloc<System> = &INSTRUMENTED_SYSTEM;

    #[tokio::test]
    async fn x5639c_remote_output_preserves_bytes_offsets_and_tail() {
        let (sender, receiver) = broadcast::channel(2);
        let mut state = (0, Some(sender));
        let mut stream = OutputStream {
            receiver,
            next: 41,
            after_gap: None,
        };
        for (offset, bytes) in [(41, &b"\0\x1b\xff\xc3"[..]), (45, &b"\xa9!"[..])] {
            publish_output(&mut state, offset, bytes.to_vec());
            assert_eq!(state.0, offset + bytes.len() as u64);
            assert_eq!(
                stream.next().await,
                Some(Output::Bytes {
                    offset,
                    bytes: Arc::from(bytes)
                })
            );
        }
        // Simulate lag by overrunning the real bounded receiver, then publish the final catch-up.
        for offset in [47, 48, 80] {
            publish_output(&mut state, offset, vec![b'x']);
        }
        publish_output(&mut state, 81, b"tail\xc3".to_vec());
        assert_eq!(state.0, 86);
        state.1 = None;
        assert_eq!(stream.next().await, Some(Output::Gap { from: 47, to: 80 }));
        assert_eq!(
            stream.next().await,
            Some(Output::Bytes {
                offset: 80,
                bytes: Arc::from(&b"x"[..])
            })
        );
        assert_eq!(
            stream.next().await,
            Some(Output::Bytes {
                offset: 81,
                bytes: Arc::from(&b"tail\xc3"[..])
            })
        );
        assert_eq!(stream.next().await, None);
    }

    #[test]
    fn x5639c_remote_output_avoids_the_temporary_payload_allocation() {
        // Nextest runs each test in its own process; no runtime or other thread allocates here.
        let payload = vec![0xa5; 8192];
        let mut observed = Vec::new();
        for former in [false, true] {
            let bytes = payload.clone();
            let (sender, mut receiver) = broadcast::channel(1);
            let mut state = (0, Some(sender));
            let region = Region::new(ALLOCATOR);
            if former {
                let _ = state.1.as_ref().unwrap().send(Chunk {
                    offset: 41,
                    bytes: Arc::from(bytes.clone()),
                });
                state.0 = 41 + bytes.len() as u64;
            } else {
                publish_output(&mut state, 41, bytes);
            }
            let stats = region.change();
            let chunk = receiver.try_recv().unwrap();
            assert_eq!(chunk.offset, 41);
            assert_eq!(&*chunk.bytes, payload);
            assert_eq!(state.0, 8233);
            observed.push(stats);
        }
        assert_eq!(observed[1].allocations - observed[0].allocations, 1);
        assert_eq!(
            observed[1].bytes_allocated - observed[0].bytes_allocated,
            payload.len()
        );
    }
}
