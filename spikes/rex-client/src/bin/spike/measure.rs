//! Q8, Q9 and Q10: status, key delay and memory.
use super::*;

/// Q8: OSC 7501 in the stream versus the program_status_changed event.
pub(crate) async fn q8(scratch: &Path) -> Result<()> {
    let (argv, env, cwd) = agent_launch(scratch)?;
    let server = Server::own(false)?;
    let control = Control::connect(&server.socket, "roundup", None).await?;
    let (session, block) = create(
        &control,
        "q8",
        options(
            rex_command(&argv, &env, cwd.to_str().unwrap(), true),
            None,
            80,
            24,
            false,
        ),
    )
    .await?;
    let mut events = control.events();
    let mut data = stream(&control, &server.socket, &session, &block).await?;
    let mut splitter = Splitter::new(data.nonce);
    let (mut program, mut messages) = (Vec::new(), Vec::new());
    control
        .terminal(&session, &block, "write", json!({"data":"g"}))
        .await?;
    drain(
        &mut data,
        &mut splitter,
        &mut program,
        &mut messages,
        "ready> ",
        Duration::from_secs(3),
    )
    .await;
    for (state, msg) in [
        ("working", "reading files"),
        ("blocked", "needs you"),
        ("done", "ok"),
    ] {
        let start = program.len();
        while events.try_recv().is_ok() {}
        let t0 = Instant::now();
        control
            .terminal(
                &session,
                &block,
                "write",
                json!({"data":format!("status {state} {msg}\r")}),
            )
            .await?;
        let needle = "\x1b]7501;state=".to_owned() + state;
        drain(
            &mut data,
            &mut splitter,
            &mut program,
            &mut messages,
            &needle,
            Duration::from_secs(3),
        )
        .await;
        let stream_ms = t0.elapsed().as_secs_f64() * 1000.0;
        let osc_at = rex_client_spike::find(&program[start..], b"\x1b]7501").unwrap_or(0);
        let end = rex_client_spike::find(&program[start + osc_at..], b"\x1b\\")
            .map(|e| e + 2)
            .unwrap_or(40);
        let raw =
            String::from_utf8_lossy(&program[start + osc_at..start + osc_at + end]).to_string();
        let mut event = block_event(
            &mut events,
            &block,
            "program_status_changed",
            Duration::from_secs(3),
        )
        .await?;
        while event["record"]["state"] != state {
            event = block_event(
                &mut events,
                &block,
                "program_status_changed",
                Duration::from_secs(3),
            )
            .await?;
        }
        let event_ms = t0.elapsed().as_secs_f64() * 1000.0;
        proof!(
            "q8",
            "{state}: stream bytes {raw:?} at {stream_ms:.1} ms; event record={} reason={} at {event_ms:.1} ms",
            json!({"state":event["record"]["state"],"msg":event["record"]["msg"],"owner":event["record"]["owner"]}),
            event["reason"]
        );
    }
    let polled = control
        .terminal(&session, &block, "program_status", json!({}))
        .await?;
    proof!("q8", "program_status (poll) = {polled}");
    control
        .terminal(
            &session,
            &block,
            "write",
            json!({"data":"title ◐ Working on spike\r"}),
        )
        .await?;
    let title = block_event(&mut events, &block, "title_changed", Duration::from_secs(3)).await;
    proof!("q8", "title_changed event = {title:?}");
    data.end().await;
    control
        .call("session.destroy", json!({"session_id":session}))
        .await?;
    control.close().await;
    Ok(())
}

/// Q9: key to echoed byte, through Rex versus a direct PTY (Terminals).
pub(crate) async fn q9(scratch: &Path) -> Result<()> {
    let tries = 200;
    // Direct PTY, as rupd does today.
    let terminals = terminal::Terminals::open(scratch, rpc::Bus::new())?;
    let spawned = terminals
        .spawn(SpawnParams {
            cwd: scratch.display().to_string(),
            command: Some(vec![exe("fake-agent").display().to_string()]),
            env: BTreeMap::new(),
            cols: 80,
            rows: 24,
        })
        .await?;
    let (id, mut output) = (spawned.id, spawned.output);
    let mut seen = Vec::new();
    while rex_client_spike::find(&seen, b"ready> ").is_none() {
        if let Some(terminal::Output::Bytes { bytes, .. }) = output.next().await {
            seen.extend_from_slice(&bytes)
        }
    }
    let mut direct = Vec::new();
    let mut echoed_direct = 0usize;
    for i in 0..tries {
        let key = [b'a' + (i % 26) as u8];
        let t0 = Instant::now();
        terminals.write(&id, &key).await?;
        // The agent echoes exactly one byte per key and prints nothing else: wait for byte i+1.
        while echoed_direct < i + 1 {
            if let Some(terminal::Output::Bytes { bytes, .. }) = output.next().await {
                echoed_direct += bytes.len()
            }
        }
        direct.push(t0.elapsed().as_secs_f64() * 1000.0);
    }
    terminals
        .write_completed(&id, b"\rexit 0\r".to_vec())
        .await?;
    // Through Rex: control write, echo on the data stream.
    let (argv, env, cwd) = agent_launch(scratch)?;
    let server = Server::own(false)?;
    let control = Control::connect(&server.socket, "roundup", None).await?;
    let (session, block) = create(
        &control,
        "q9",
        options(
            rex_command(&argv, &env, cwd.to_str().unwrap(), true),
            None,
            80,
            24,
            false,
        ),
    )
    .await?;
    let mut data = stream(&control, &server.socket, &session, &block).await?;
    let mut splitter = Splitter::new(data.nonce);
    let (mut program, mut messages) = (Vec::new(), Vec::new());
    control
        .terminal(&session, &block, "write", json!({"data":"g"}))
        .await?;
    drain(
        &mut data,
        &mut splitter,
        &mut program,
        &mut messages,
        "ready> ",
        Duration::from_secs(3),
    )
    .await;
    let mut via_rex = Vec::new();
    let mut via_event = Vec::new();
    for (samples, event) in [(&mut via_rex, false), (&mut via_event, true)] {
        for i in 0..tries {
            let key = (b'a' + (i % 26) as u8) as char;
            let t0 = Instant::now();
            let (method, payload) = if event {
                (
                    "block.event",
                    json!({"session_id":session,"block_id":block,"event":{"type":"key","payload":{"key":format!("key_{key}"),"mods":"","consumed_mods":"","text":key.to_string(),"unshifted_codepoint":key as u32,"composing":false,"action":"press"}}}),
                )
            } else {
                (
                    "com.superlogical.terminal.write",
                    json!({"session_id":session,"block_id":block,"args":{"data":key.to_string()}}),
                )
            };
            let send = control.call(method, payload);
            let echo = async {
                let mut got = 0;
                while got < 1 {
                    let bytes = data.next().await.ok_or("stream ended")?;
                    for p in splitter.push(&bytes) {
                        if let Piece::Program(b) = p {
                            if b != [key as u8] {
                                return Err(format!("unexpected {b:?}").into());
                            }
                            got += b.len()
                        }
                    }
                }
                Ok::<_, rex_client_spike::Error>(())
            };
            let (sent, echoed) = tokio::join!(send, echo);
            sent?;
            echoed?;
            samples.push(t0.elapsed().as_secs_f64() * 1000.0);
        }
    }
    for (name, samples) in [
        ("direct PTY (Terminals.write → output)", &mut direct),
        ("Rex write → data stream", &mut via_rex),
        ("Rex block.event key → data stream", &mut via_event),
    ] {
        samples.sort_by(f64::total_cmp);
        proof!(
            "q9",
            "{name}: n={} p50={:.3} ms p95={:.3} ms max={:.3} ms",
            samples.len(),
            percentile(samples, 0.5),
            percentile(samples, 0.95),
            samples.last().unwrap()
        );
    }
    data.end().await;
    control
        .call("session.destroy", json!({"session_id":session}))
        .await?;
    control.close().await;
    Ok(())
}

/// Q10: 10 idle fake agents: rupd's growth today versus rupd + Rex server growth.
pub(crate) async fn q10(scratch: &Path) -> Result<()> {
    let me = std::process::id();
    let settle = || tokio::time::sleep(Duration::from_secs(2));
    // Today: ten PTYs in this process (Terminals), each with its log and vt100 mirror.
    settle().await;
    let before = rss_kb(me);
    let terminals = terminal::Terminals::open(scratch, rpc::Bus::new())?;
    let mut ids = Vec::new();
    for _ in 0..10 {
        let s = terminals
            .spawn(SpawnParams {
                cwd: scratch.display().to_string(),
                command: Some(vec![exe("fake-agent").display().to_string()]),
                env: BTreeMap::new(),
                cols: 120,
                rows: 40,
            })
            .await?;
        ids.push(s.id);
    }
    settle().await;
    let today = rss_kb(me) - before;
    proof!(
        "q10",
        "today: Terminals with 10 fake agents grew this process by {today} KB"
    );
    for id in &ids {
        let _ = terminals.write_completed(id, b"exit 0\r".to_vec()).await;
    }
    drop(terminals);
    // Rex: a fresh own server, ten blocks; this process holds one control and ten streams,
    // each fed into a vt100 mirror as roundup's would be.
    let (argv, env, cwd) = agent_launch(scratch)?;
    let server = Server::own(false)?;
    let control = Control::connect(&server.socket, "roundup", None).await?;
    settle().await;
    let (server_before, me_before) = (rss_kb(server.pid().unwrap()), rss_kb(me));
    let created = control
        .call("session.create", json!({"label":"q10"}))
        .await?;
    let session = created["session_id"].as_str().unwrap().to_owned();
    control
        .call("session.attach", json!({"session_id":session}))
        .await?;
    let mut mirrors = Vec::new();
    for _ in 0..10 {
        let w = control.call("session.new_window", json!({"session_id":session,"layout":{"block":{"flavor":SHELL,"options":options(rex_command(&argv, &env, cwd.to_str().unwrap(), true), None, 120, 40, false)}}})).await?;
        let block = w["block_ids"][0]
            .as_str()
            .ok_or_else(|| format!("new_window: {w}"))?
            .to_owned();
        let mut data = stream(&control, &server.socket, &session, &block).await?;
        control
            .terminal(&session, &block, "write", json!({"data":"g"}))
            .await?;
        let task = tokio::spawn(async move {
            let mut parser = vt100::Parser::new(40, 120, 1000);
            let mut splitter = Splitter::new(data.nonce);
            while let Some(bytes) = data.next().await {
                for p in splitter.push(&bytes) {
                    if let Piece::Program(b) = p {
                        parser.process(&b)
                    }
                }
            }
        });
        mirrors.push(task);
    }
    settle().await;
    let (server_after, me_after) = (rss_kb(server.pid().unwrap()), rss_kb(me));
    proof!(
        "q10",
        "Rex: server {server_before}→{server_after} KB (+{}), this client {me_before}→{me_after} KB (+{}), total +{} KB",
        server_after - server_before,
        me_after.saturating_sub(me_before),
        server_after - server_before + me_after.saturating_sub(me_before)
    );
    control
        .call("session.destroy", json!({"session_id":session}))
        .await?;
    control.close().await;
    for m in mirrors {
        m.abort();
    }
    Ok(())
}
