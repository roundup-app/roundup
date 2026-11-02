//! Q5 and Q6: size authority (also with the real app) and input order.
use super::*;

/// Q5: size authority between roundup and another client (and the real app on the user's server).
pub(crate) async fn q5(scratch: &Path) -> Result<()> {
    let (argv, env, cwd) = agent_launch(scratch)?;
    let server = Server::own(false)?;
    let roundup = Control::connect(&server.socket, "roundup", None).await?;
    let (session, block) = create(
        &roundup,
        "q5",
        options(
            rex_command(&argv, &env, cwd.to_str().unwrap(), false),
            None,
            80,
            24,
            false,
        ),
    )
    .await?;
    wait_screen(&roundup, &session, &block, "ready>").await;
    let show = |label: &str, v: &Value| {
        proof!(
            "q5",
            "{label}: {}x{} owner={}",
            v["columns"],
            v["rows"],
            v["owner"]
        )
    };
    show(
        "created by roundup",
        &roundup
            .terminal(&session, &block, "size", json!({}))
            .await?,
    );
    roundup
        .call(
            "session.own_block",
            json!({"session_id":session,"block_ids":[block],"mode":"take"}),
        )
        .await?;
    roundup
        .terminal(&session, &block, "resize", json!({"columns":100,"rows":30}))
        .await?;
    show(
        "roundup own_block take + resize 100x30",
        &roundup
            .terminal(&session, &block, "size", json!({}))
            .await?,
    );
    let app = Control::connect(&server.socket, "Rex.app-stand-in", None).await?;
    app.call("session.attach", json!({"session_id":session}))
        .await?;
    app.terminal(&session, &block, "resize", json!({"columns":60,"rows":20}))
        .await?;
    show(
        "second client resize 60x20 without owning",
        &roundup
            .terminal(&session, &block, "size", json!({}))
            .await?,
    );
    app.call(
        "session.own_block",
        json!({"session_id":session,"block_ids":[block],"mode":"request"}),
    )
    .await?;
    show(
        "second client own_block request",
        &roundup
            .terminal(&session, &block, "size", json!({}))
            .await?,
    );
    app.call(
        "session.own_block",
        json!({"session_id":session,"block_ids":[block],"mode":"take"}),
    )
    .await?;
    show(
        "second client own_block take",
        &roundup
            .terminal(&session, &block, "size", json!({}))
            .await?,
    );
    roundup.write_stty(&session, &block).await?;
    tokio::time::sleep(Duration::from_millis(200)).await;
    proof!(
        "q5",
        "program sees: {:?}",
        lines_of(
            &screen_text(&roundup, &session, &block).await,
            "size rows_cols"
        )
        .last()
    );
    roundup
        .call(
            "session.own_block",
            json!({"session_id":session,"block_ids":[block],"mode":"take"}),
        )
        .await?;
    show(
        "roundup takes back",
        &roundup
            .terminal(&session, &block, "size", json!({}))
            .await?,
    );
    app.close().await;
    roundup
        .call("session.destroy", json!({"session_id":session}))
        .await?;
    roundup.close().await;
    Ok(())
}

pub(crate) trait Stty {
    async fn write_stty(&self, session: &str, block: &str) -> Result<()>;
}

impl Stty for Control {
    async fn write_stty(&self, session: &str, block: &str) -> Result<()> {
        self.terminal(session, block, "write", json!({"data":"size\r"}))
            .await
            .map(|_| ())
    }
}

/// Q6: write versus block.event; ordering of a bracketed paste then a separate `\r`.
pub(crate) async fn q6(scratch: &Path) -> Result<()> {
    let (argv, env, cwd) = agent_launch(scratch)?;
    let server = Server::own(false)?;
    let control = Control::connect(&server.socket, "roundup", None).await?;
    let (session, block) = create(
        &control,
        "q6",
        options(
            rex_command(&argv, &env, cwd.to_str().unwrap(), true),
            None,
            200,
            50,
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
    let rounds = 100;
    for mode in ["write-pipelined", "write-awaited", "event-pipelined"] {
        let start = program.len();
        let t0 = Instant::now();
        for i in 0..rounds {
            let text = format!("prompt {mode} {i:03}");
            match mode {
                "write-pipelined" => {
                    let paste = control.terminal(
                        &session,
                        &block,
                        "write",
                        json!({"data":format!("\x1b[200~{text}\x1b[201~")}),
                    );
                    let enter = control.terminal(&session, &block, "write", json!({"data":"\r"}));
                    let (a, b) = tokio::join!(paste, enter);
                    a?;
                    b?;
                }
                "write-awaited" => {
                    let r = control
                        .terminal(
                            &session,
                            &block,
                            "write",
                            json!({"data":format!("\x1b[200~{text}\x1b[201~")}),
                        )
                        .await?;
                    if i == 0 {
                        proof!("q6", "write result = {r}");
                    }
                    control
                        .terminal(&session, &block, "write", json!({"data":"\r"}))
                        .await?;
                }
                _ => {
                    let event = |e: Value| {
                        control.call(
                            "block.event",
                            json!({"session_id":session,"block_id":block,"event":e}),
                        )
                    };
                    let paste = event(json!({"type":"paste","payload":{"text":text}}));
                    let enter = event(
                        json!({"type":"key","payload":{"key":"enter","mods":"","consumed_mods":"","text":"\r","unshifted_codepoint":13,"composing":false,"action":"press"}}),
                    );
                    let (a, b) = tokio::join!(paste, enter);
                    let a = a?;
                    if i == 0 {
                        proof!("q6", "block.event result = {a}; key result = {:?}", b);
                    }
                }
            }
        }
        let sent = t0.elapsed();
        let last = format!("prompt {mode} {:03}", rounds - 1);
        drain(
            &mut data,
            &mut splitter,
            &mut program,
            &mut messages,
            &format!("{last}\"\r\n"),
            Duration::from_secs(5),
        )
        .await;
        let out = String::from_utf8_lossy(&program[start..]).to_string();
        let turns: Vec<&str> = out.lines().filter(|l| l.contains("turn ")).collect();
        let good = turns
            .iter()
            .filter(|l| l.contains("paste=true") && l.contains(&format!("prompt {mode} ")))
            .count();
        let bad: Vec<&&str> = turns
            .iter()
            .filter(|l| !(l.contains("paste=true") && l.contains(&format!("prompt {mode} "))))
            .take(3)
            .collect();
        proof!(
            "q6",
            "{mode}: {rounds} paste+\\r pairs in {:?}; turns={} intact={good} broken examples={bad:?}",
            sent,
            turns.len()
        );
    }
    data.end().await;
    control
        .call("session.destroy", json!({"session_id":session}))
        .await?;
    control.close().await;
    Ok(())
}

/// Q5 with the real Rex app: hold roundup's server and block, log every owner and size change.
/// `touch DIR/retake` makes roundup take the block back; `touch DIR/stop` ends the run.
pub(crate) async fn q5_app(scratch: &Path) -> Result<()> {
    let dir = PathBuf::from("/tmp/rxs.app");
    std::fs::create_dir_all(&dir)?;
    let (argv, env, cwd) = agent_launch(scratch)?;
    let server = Server::start_in(dir.clone(), false)?;
    let control = Control::connect(&server.socket, "roundup", None).await?;
    let mut events = control.events();
    let (session, block) = create(
        &control,
        "roundup-spike-q5",
        options(
            rex_command(&argv, &env, cwd.to_str().unwrap(), false),
            None,
            80,
            24,
            false,
        ),
    )
    .await?;
    wait_screen(&control, &session, &block, "ready>").await;
    control
        .call(
            "session.own_block",
            json!({"session_id":session,"block_ids":[block],"mode":"take"}),
        )
        .await?;
    control
        .terminal(&session, &block, "resize", json!({"columns":100,"rows":30}))
        .await?;
    let me = control.client_id();
    let start = Instant::now();
    let report = |label: String, size: &Value| {
        let owner = size["owner"].as_str().unwrap_or("none");
        let who = if owner == me {
            "roundup".to_owned()
        } else {
            owner.to_owned()
        };
        println!(
            "PROOF q5app t={:.1}s {label}: {}x{} owner={who} desired={}",
            start.elapsed().as_secs_f64(),
            size["columns"],
            size["rows"],
            size["desired"]
        );
    };
    println!(
        "PROOF q5app socket={} session={session} block={block} roundup={me}",
        server.socket.display()
    );
    report(
        "start".into(),
        &control
            .terminal(&session, &block, "size", json!({}))
            .await?,
    );
    let mut tick = tokio::time::interval(Duration::from_secs(5));
    loop {
        tokio::select! {
            event = events.recv() => {
                let Ok(event) = event else { continue };
                let inner = &event["payload"]["payload"]["event"];
                let name = match inner["type"].as_str() {
                    Some("block_event") => inner["payload"]["name"].as_str().unwrap_or_default().to_owned(),
                    Some(other) => other.to_owned(),
                    None => continue,
                };
                if ["block_owner_changed", "size_changed", "client_connected", "client_disconnected"].contains(&name.as_str()) {
                    println!("PROOF q5app t={:.1}s event {name} {}", start.elapsed().as_secs_f64(), inner["payload"]);
                    report(format!("after {name}"), &control.terminal(&session, &block, "size", json!({})).await?);
                }
            }
            _ = tick.tick() => {
                if dir.join("retake").exists() {
                    std::fs::remove_file(dir.join("retake"))?;
                    control.call("session.own_block", json!({"session_id":session,"block_ids":[block],"mode":"take"})).await?;
                    report("roundup took the block back".into(), &control.terminal(&session, &block, "size", json!({})).await?);
                }
                if dir.join("stop").exists() || start.elapsed() > Duration::from_secs(1800) { break }
                let clients = control.call("session.list_clients", json!({"session_id":session})).await?;
                let names: Vec<_> = clients["clients"].as_array().into_iter().flatten().map(|c| c["info"]["name"].clone()).collect();
                report(format!("poll clients={}", json!(names)), &control.terminal(&session, &block, "size", json!({})).await?);
            }
        }
    }
    control
        .call("session.destroy", json!({"session_id":session}))
        .await?;
    control.close().await;
    drop(server);
    Ok(())
}
