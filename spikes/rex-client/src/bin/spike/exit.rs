//! Q7: exit codes and reattach after rupd or Rex restarts.
use super::*;

/// Q7a: exit code three ways. Q7b (q7-restart): rupd dies; a new process reattaches by id.
pub(crate) async fn q7(scratch: &Path) -> Result<()> {
    let (argv, env, cwd) = agent_launch(scratch)?;
    let server = Server::own(false)?;
    let control = Control::connect(&server.socket, "roundup", None).await?;
    for keep_open in [true, false] {
        let (session, block) = create(
            &control,
            "q7",
            options(
                rex_command(&argv, &env, cwd.to_str().unwrap(), true),
                None,
                80,
                24,
                keep_open,
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
        let process = control
            .terminal(&session, &block, "process", json!({}))
            .await?;
        proof!(
            "q7",
            "keep_open={keep_open}: before exit child={{pid:{}, name:{}}} last_exit={}",
            process["child"]["pid"],
            process["child"]["name"],
            process["last_exit"]
        );
        control
            .terminal(&session, &block, "write", json!({"data":"exit 7\r"}))
            .await?;
        let event = block_event(&mut events, &block, "child_exited", Duration::from_secs(3)).await;
        drain(
            &mut data,
            &mut splitter,
            &mut program,
            &mut messages,
            "\u{0}never",
            Duration::from_millis(500),
        )
        .await;
        let apc: Vec<_> = messages
            .iter()
            .filter(|m| m["type"] == "child_exited")
            .collect();
        let after = control
            .terminal(&session, &block, "process", json!({}))
            .await;
        proof!(
            "q7",
            "keep_open={keep_open}: event child_exited={event:?}; stream APC={apc:?}; stream close={:?}; process after={}",
            data.close,
            after
                .map(|v| v["last_exit"].to_string())
                .unwrap_or_else(|e| e.to_string())
        );
        let _ = control
            .call("session.destroy", json!({"session_id":session}))
            .await;
    }
    control.close().await;
    Ok(())
}

pub(crate) async fn q7_restart(scratch: &Path) -> Result<()> {
    let (argv, env, cwd) = agent_launch(scratch)?;
    // Restore on, so a Rex restart can be tested on the same state dir afterwards.
    let mut server = Server::own(true)?;
    let state = scratch.join("rupd-state.json");
    // Process 1 ("rupd"): create, own, stream, then die without close frames.
    let first = Command::new(exe("spike-holder"))
        .arg(&server.socket)
        .arg(&state)
        .arg(serde_json::to_string(&options(
            rex_command(&argv, &env, cwd.to_str().unwrap(), true),
            None,
            80,
            24,
            false,
        ))?)
        .status()?;
    let saved: Value = serde_json::from_slice(&std::fs::read(&state)?)?;
    proof!(
        "q7",
        "process 1 exited {first}; saved {{session, block, client_id, child_pid, data_received={}}}",
        saved["received"]
    );
    tokio::time::sleep(Duration::from_secs(3)).await;
    // Process 2: reattach by id with the saved tokens.
    let control =
        Control::connect(&server.socket, "roundup", saved["control_token"].as_str()).await?;
    proof!(
        "q7",
        "process 2 control: resumed={} same client id={}",
        control.welcome["client"]["resumed"],
        control.client_id() == saved["client_id"]
    );
    let (session, block) = (
        saved["session"].as_str().unwrap().to_owned(),
        saved["block"].as_str().unwrap().to_owned(),
    );
    let size = control
        .terminal(&session, &block, "size", json!({}))
        .await?;
    proof!(
        "q7",
        "process 2 still owns block: {}",
        size["owner"] == saved["client_id"]
    );
    let instance_before = control.call("server.status", json!({})).await?["instance_id"].clone();
    let process = control
        .terminal(&session, &block, "process", json!({}))
        .await?;
    proof!(
        "q7",
        "identity: child pid {} == saved {} ; last_exit={}",
        process["child"]["pid"],
        saved["child_pid"],
        process["last_exit"]
    );
    let token: [u8; 16] = serde_json::from_value::<Vec<u8>>(saved["data_token"].clone())?
        .try_into()
        .map_err(|_| "token")?;
    let mut data = Data::resume(&server.socket, token, saved["received"].as_u64().unwrap()).await?;
    let mut splitter = Splitter::resumed(saved["nonce"].as_u64().unwrap());
    let (mut program, mut messages) = (Vec::new(), Vec::new());
    drain(
        &mut data,
        &mut splitter,
        &mut program,
        &mut messages,
        "tick 00040",
        Duration::from_secs(6),
    )
    .await;
    let mut all = std::fs::read(scratch.join("rupd-state.bin"))?;
    all.extend(&program);
    let ticks: Vec<u32> = String::from_utf8_lossy(&all)
        .lines()
        .filter_map(|l| l.trim().strip_prefix("tick ").and_then(|n| n.parse().ok()))
        .collect();
    proof!(
        "q7",
        "process 1 saw {} B of program bytes; resumed connection delivered {} B, ending {:?}",
        all.len() - program.len(),
        program.len(),
        String::from_utf8_lossy(&program[program.len().saturating_sub(40)..])
    );
    proof!(
        "q7",
        "process 1 bytes + resumed bytes: ticks {:?}..{:?}, gaps or repeats={}",
        ticks.first(),
        ticks.last(),
        ticks.windows(2).filter(|w| w[1] != w[0] + 1).count()
    );
    // A stale id: wrong token resumes nothing.
    let stale = Data::resume(&server.socket, [7u8; 16], 0).await;
    proof!(
        "q7",
        "RESUME with a forged token: {:?}",
        stale.err().map(|e| e.to_string())
    );
    data.end().await;
    control.close().await;
    // Rex restart: does the block id come back, and with which process?
    server.stop();
    let dir = server.dir.clone();
    let server = Server::start_in(dir, true)?;
    let control = Control::connect(&server.socket, "roundup", None).await?;
    let sessions = control.call("session.list", json!({})).await?;
    proof!(
        "q7",
        "Rex server instance_id before restart {instance_before}, after {}",
        control.call("server.status", json!({})).await?["instance_id"]
    );
    proof!(
        "q7",
        "after Rex restart (--restore): session.list = {sessions}"
    );
    if control
        .call("session.attach", json!({"session_id":session}))
        .await
        .is_ok()
    {
        let blocks = control
            .call("session.list_blocks", json!({"session_id":session}))
            .await?;
        let process = control
            .terminal(&session, &block, "process", json!({}))
            .await;
        proof!(
            "q7",
            "after Rex restart: blocks={blocks}; same block id process={:?}",
            process
                .map(|p| json!({"child":p["child"]["pid"],"last_exit":p["last_exit"]}))
                .map_err(|e| e.to_string())
        );
        let text = screen_text(&control, &session, &block).await;
        proof!(
            "q7",
            "after Rex restart: screen tail {:?}",
            text.lines().rev().find(|l| !l.trim().is_empty())
        );
        let _ = control
            .call("session.destroy", json!({"session_id":session}))
            .await;
    }
    for s in control.call("session.list", json!({})).await?["sessions"]
        .as_array()
        .into_iter()
        .flatten()
    {
        let _ = control
            .call("session.destroy", json!({"session_id":s["session_id"]}))
            .await;
    }
    control.close().await;
    Ok(())
}
