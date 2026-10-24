use super::*;

pub(crate) fn failure(id: &Value, err: &RpcError) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": err })
}

/// Accept connections until the listener fails.
pub async fn serve(listener: UnixListener, daemon: Arc<Daemon>) -> io::Result<()> {
    daemon.agents.observe_measurements();
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
    let (frames, mut outbox) = mpsc::unbounded_channel::<Value>();
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
            let mut bytes = serde_json::to_vec(&frame).map_err(io::Error::other)?;
            bytes.push(b'\n');
            write.write_all(&bytes).await?;
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
                    | "agent.instructions"
                    | "workstream.rewind"
                    | "workstream.rewindPlan"
            )
        ) {
            daemon.action_actor(&conn)
        } else {
            conn.actor.clone()
        };
        let mut request_conn = conn.clone();
        let daemon = Arc::clone(&daemon);
        ordinary.spawn(async move {
            if let Some(reply) = daemon.dispatch(&mut request_conn, &line, Some(actor)).await {
                let _ = request_conn.events.send(reply);
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
