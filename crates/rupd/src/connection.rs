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
    #[cfg(test)]
    pub(crate) fn into_value(self) -> Value {
        match self {
            Self::Value(value) => value,
            Self::Json(text) => serde_json::from_str(&text).expect("a written frame is JSON"),
        }
    }

    fn into_line(self) -> io::Result<Vec<u8>> {
        let mut bytes = match self {
            Self::Value(value) => serde_json::to_vec(&value).map_err(io::Error::other)?,
            Self::Json(text) => text.into_bytes(),
        };
        bytes.push(b'\n');
        Ok(bytes)
    }
}

/// Accept connections until the listener fails.
pub async fn serve(listener: UnixListener, daemon: Arc<Daemon>) -> io::Result<()> {
    daemon.agents.observe_measurements();
    let mut exits = daemon.bus.subscribe();
    daemon.reconcile_actions().await.map_err(io::Error::other)?;
    let weak = Arc::downgrade(&daemon);
    tokio::spawn(async move {
        loop {
            match exits.recv().await {
                Ok(event) => {
                    // User release can still be typing a recorded Message; its router call
                    // owns that later cut. Only the Daemon's exit release runs here.
                    if let contracts::EventData::TakeoverChanged(change) = &event.data
                        && event.actor == Actor::daemon()
                        && !change.on
                    {
                        let Some(daemon) = weak.upgrade() else { return };
                        let _child = daemon.child_effects(&change.agent).write_owned().await;
                        if !daemon
                            .sender
                            .get()
                            .is_some_and(|m| m.takeover_active(&change.agent))
                            && let Err(e) = daemon.release_actions(&change.agent).await
                        {
                            eprintln!("rupd: held action release failed: {}", e.message);
                            return;
                        }
                    }
                    if let contracts::EventData::TerminalExited(exit) = event.data {
                        let Some(daemon) = weak.upgrade() else { return };
                        if let Err(e) = daemon.resize_exit(&exit.id).await {
                            eprintln!("rupd: resize exit accounting failed: {}", e.message);
                            return;
                        }
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                    // A missed exit must not silently strand an accepted resize.
                    let Some(daemon) = weak.upgrade() else { return };
                    if let Err(e) = daemon.reconcile_actions().await {
                        eprintln!("rupd: resize exit reconciliation failed: {}", e.message);
                        return;
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => return,
            }
        }
    });
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
    daemon.clears.me.get_or_init(|| Arc::downgrade(&daemon));
    let stream_pid = stream
        .peer_cred()
        .ok()
        .and_then(|cred| cred.pid())
        .and_then(|pid| u32::try_from(pid).ok());
    let stream = BufReader::new(stream);
    let (read, mut write) = tokio::io::split(stream);
    let (frames, mut outbox) = mpsc::unbounded_channel::<Frame>();
    let (port, mut selected_output) = output::Port::new();
    let (finished, mut finish) = tokio::sync::oneshot::channel();
    let writer = tokio::spawn(async move {
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
    });
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
        let method = request
            .as_ref()
            .and_then(|request| request["method"].as_str().map(str::to_owned));
        // Actor and subscription changes must commit before the next wire request is read.
        if matches!(
            method.as_deref(),
            Some(
                "daemon.identify" | "events.subscribe" | "terminal.output" | "terminal.outputStop"
            )
        ) {
            if let Some(reply) = daemon.dispatch(&mut conn, &line, None).await {
                let _ = frames.send(reply);
            }
            continue;
        }
        let actor = if method.as_deref() == Some("terminal.write") {
            let writer = daemon.terminal_writer(&conn);
            if writer.kind == ActorKind::Agent {
                writer
            } else {
                conn.actor.clone()
            }
        } else if method.as_deref().is_some_and(|m| {
            m.starts_with("deliverable.")
                || m.starts_with("reaction.")
                || matches!(
                    m,
                    "message.progress"
                        | "message.report"
                        | "message.acceptResult"
                        | "message.verifyResult"
                        | "message.resolveResult"
                        | "message.reconcileWork"
                        | "message.resumeWork"
                )
        }) || matches!(
            method.as_deref(),
            Some(
                "rail.rename"
                    | "workstream.setAuto"
                    | "agent.spawn"
                    | "agent.stop"
                    | "agent.interrupt"
                    | "agent.prompt"
                    | "agent.setOrder"
                    | "agent.resume"
                    | "agent.actionHistory"
                    | "agent.instructions"
                    | "workstream.rewind"
                    | "workstream.rewindPlan"
            )
        ) {
            daemon.action_actor(&conn)
        } else {
            conn.actor.clone()
        };
        let params = request
            .as_ref()
            .and_then(|r| r.get("params"))
            .unwrap_or(&Value::Null);
        // Register before spawning so scheduler order cannot overtake wire arrival.
        let child_arrival = match daemon
            .door_effect_children(&actor, method.as_deref().unwrap_or_default(), params)
            .await
        {
            Ok(children) => children
                .into_iter()
                .map(|child| {
                    daemon.held_actions.arrive(
                        child,
                        matches!(
                            method.as_deref(),
                            Some(
                                "terminal.resize"
                                    | "terminal.close"
                                    | "terminal.kill"
                                    | "terminal.write"
                                    | "rail.rename"
                                    | "agent.stop"
                                    | "agent.interrupt"
                                    | "agent.prompt"
                                    | "workstream.rewind"
                            )
                        ),
                    )
                })
                .collect::<Vec<_>>(),
            Err(error) => {
                // Reject the original target; a later target must not revive an invalid call.
                if let Some(id) = request.as_ref().and_then(|r| r.get("id")) {
                    let _ = frames.send(failure(id, &error).into());
                }
                continue;
            }
        };
        let mut request_conn = conn.clone();
        let daemon = Arc::clone(&daemon);
        ordinary.spawn(async move {
            let mut completed = Vec::new();
            for (before, done) in child_arrival {
                if let Some(mut before) = before {
                    let _ = before.wait_for(|done| *done).await;
                }
                if let Some(done) = done {
                    completed.push(done);
                }
            }
            if let Some(reply) = daemon.dispatch(&mut request_conn, &line, Some(actor)).await {
                let _ = request_conn.events.send(reply);
            }
            for done in completed {
                daemon.held_actions.finish_arrival(done);
            }
        });
        while let Some(joined) = ordinary.try_join_next() {
            joined.map_err(io::Error::other)?;
        }
    };
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
