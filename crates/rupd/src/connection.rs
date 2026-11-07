use super::*;

pub(crate) fn failure(id: &Value, err: &RpcError) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": err })
}

/// One line for the socket writer: a `Value`, or a frame already written as JSON text.
pub(crate) enum Frame {
    Value(Value),
    Json(String),
}

impl From<Value> for Frame {
    fn from(value: Value) -> Self {
        Self::Value(value)
    }
}

impl Frame {
    /// The frame as the client reads it.
    pub(crate) fn into_value(self) -> serde_json::Result<Value> {
        match self {
            Self::Value(value) => Ok(value),
            Self::Json(text) => serde_json::from_str(&text),
        }
    }

    pub(super) fn into_line(self) -> io::Result<Vec<u8>> {
        let mut bytes = match self {
            Self::Value(value) => serde_json::to_vec(&value).map_err(io::Error::other)?,
            Self::Json(text) => text.into_bytes(),
        };
        bytes.push(b'\n');
        Ok(bytes)
    }
}

/// Start the Daemon's watchers once and accept connections until the listener fails. A watcher
/// that ends first fails the serve: a panicked watcher would otherwise vanish. An Extension host
/// starts after the socket is bound and never delays it (UA1).
pub async fn serve(
    listener: UnixListener,
    daemon: Arc<Daemon>,
    watchers: Watchers,
) -> io::Result<()> {
    let mut running = watchers.spawn(&daemon);
    daemon.extensions.start(&daemon);
    tokio::select! {
        accepted = accept(listener, daemon) => accepted,
        Some(ended) = running.join_next() => Err(io::Error::other(match ended {
            Ok(()) => "a watcher ended while the Daemon served".to_owned(),
            Err(err) => format!("a watcher failed: {err}"),
        })),
    }
}

/// Accept connections on a further socket (A12a) until the listener fails; `serve` runs the
/// watchers.
pub async fn accept(listener: UnixListener, daemon: Arc<Daemon>) -> io::Result<()> {
    loop {
        let (stream, _) = listener.accept().await?;
        let daemon = Arc::clone(&daemon);
        tokio::spawn(async move {
            if let Err(err) = handle(stream, daemon).await {
                eprintln!("rupd: connection failed: {err}");
            }
        });
    }
}

pub(crate) async fn handle(stream: UnixStream, daemon: Arc<Daemon>) -> io::Result<()> {
    let stream_pid = stream
        .peer_cred()
        .ok()
        .and_then(|cred| cred.pid())
        .and_then(|pid| u32::try_from(pid).ok());
    let stream = BufReader::new(stream);
    let (read, write) = tokio::io::split(stream);
    let (frames, outbox) = mpsc::unbounded_channel::<Frame>();
    let (port, selected_output) = output::Port::new();
    let (finished, finish) = tokio::sync::oneshot::channel();
    let writer = tokio::spawn(write_frames(write, outbox, selected_output, finish));
    let mut conn = Conn {
        actor: Actor::user(),
        peer: stream_pid,
        events: frames.clone(),
        output: Some(port),
    };
    let mut lines = BufReader::new(read).lines();
    let mut ordinary = tokio::task::JoinSet::new();
    let read_result = loop {
        let line = match lines.next_line().await {
            Ok(Some(line)) => line,
            Ok(None) => break Ok(()),
            Err(err) => break Err(err),
        };
        let request = serde_json::from_str::<Value>(&line).ok();
        // The App's answer to a relayed action call (NA6): a reply line, not a request.
        if let Some(answer) = request.as_ref().filter(|line| {
            line.get("method").is_none()
                && (line.get("result").is_some() || line.get("error").is_some())
        }) {
            daemon.actions.answer(&frames, answer);
            continue;
        }
        let row = request
            .as_ref()
            .and_then(|request| request["method"].as_str())
            .and_then(crate::route::policy::policy);
        // Actor and subscription changes must commit before the next wire request is read.
        if row.is_some_and(|row| row.settles) {
            if let Some(reply) = daemon.dispatch(&mut conn, &line, None).await {
                let _ = frames.send(reply);
            }
            continue;
        }
        use crate::route::policy::Actor as Caller;
        let actor = match row.map(|row| row.actor) {
            Some(Caller::TerminalWriter) => {
                let writer = daemon.terminal_writer(&conn);
                if writer.kind == ActorKind::Agent {
                    writer
                } else {
                    conn.actor.clone()
                }
            }
            Some(Caller::Caller) => daemon.action_actor(&conn),
            Some(Caller::Connection) | None => conn.actor.clone(),
        };
        let mut request_conn = conn.clone();
        let daemon = Arc::clone(&daemon);
        ordinary.spawn(async move {
            let reply = match request {
                Some(request) => {
                    daemon
                        .dispatch_parsed(&mut request_conn, request, Some(actor))
                        .await
                }
                None => daemon.dispatch(&mut request_conn, &line, Some(actor)).await,
            };
            if let Some(reply) = reply {
                let _ = request_conn.events.send(reply);
            }
        });
        while let Some(joined) = ordinary.try_join_next() {
            joined.map_err(io::Error::other)?;
        }
    };
    daemon.actions.closed(&frames);
    // Accepted calls survive a write-side half-close and can still send their replies.
    while let Some(joined) = ordinary.join_next().await {
        joined.map_err(io::Error::other)?;
    }
    drop(conn);
    drop(frames);
    let _ = finished.send(());
    writer.await.map_err(io::Error::other)??;
    read_result
}

pub(super) async fn write_frames(
    mut write: impl tokio::io::AsyncWrite + Unpin,
    mut outbox: mpsc::UnboundedReceiver<Frame>,
    mut selected_output: mpsc::Receiver<Frame>,
    mut finish: tokio::sync::oneshot::Receiver<()>,
) -> io::Result<()> {
    loop {
        let frame = tokio::select! {
            biased;
            _ = &mut finish, if !outbox.is_closed() => {
                outbox.close();
                continue;
            }
            frame = outbox.recv() => match frame {
                Some(frame) => frame,
                None => break,
            },
            // Behind replies, so a flood of selected output cannot starve them.
            Some(frame) = selected_output.recv() => frame,
        };
        write.write_all(&frame.into_line()?).await?;
    }
    io::Result::Ok(())
}
