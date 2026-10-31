//! Q1, Q2 and the exit-code check: which server, and how a block starts.
use super::*;

/// Q1: own server versus the user's app server; what the Rex app can see in each.
pub(crate) async fn q1(scratch: &Path) -> Result<()> {
    let (argv, env, cwd) = agent_launch(scratch)?;
    let command = rex_command(&argv, &env, cwd.to_str().unwrap(), false);
    for (name, mut server) in [("own", Server::own(false)?), ("user", Server::user())] {
        let control = Control::connect(&server.socket, "roundup-spike", None).await?;
        let status = control.call("server.status", json!({})).await?;
        proof!(
            "q1",
            "{name}: server.status endpoint={} host_id={} instance={}",
            status["endpoint"],
            status["host_id"],
            status["instance_id"]
        );
        let mut events = control.events();
        let (session, block) = create(
            &control,
            "roundup-spike-q1",
            options(command.clone(), None, 80, 24, false),
        )
        .await?;
        let text = wait_screen(&control, &session, &block, "ready>").await;
        proof!(
            "q1",
            "{name}: block {block} runs: {:?}",
            lines_of(&text, "fake-agent")
        );
        tokio::time::sleep(Duration::from_secs(3)).await;
        let clients = control
            .call("session.list_clients", json!({"session_id":session}))
            .await?;
        let attached: Vec<_> = clients["clients"].as_array().into_iter().flatten().map(|c| json!({"id":c["client_id"],"kind":c["info"]["kind"],"name":c["info"]["name"],"pid":c["principal"]["pid"]})).collect();
        proof!(
            "q1",
            "{name}: clients attached to the new session after 3 s = {}",
            json!(attached)
        );
        let all = control.call("client.list", json!({})).await?;
        let apps: Vec<_> = all["clients"].as_array().into_iter().flatten().filter(|c| c["info"]["kind"] == "app").map(|c| json!({"id":c["client_id"],"name":c["info"]["name"],"sessions":c["session_ids"]})).collect();
        proof!(
            "q1",
            "{name}: app clients connected to this server = {}",
            json!(apps)
        );
        let size = control
            .terminal(&session, &block, "size", json!({}))
            .await?;
        proof!(
            "q1",
            "{name}: size {}x{} owner={} (me={}) desired={}",
            size["columns"],
            size["rows"],
            size["owner"],
            control.client_id(),
            size["desired"]
        );
        // Q5 on the real app: take the block, set 100x30, and watch 3 s for the app taking it back.
        control
            .call(
                "session.own_block",
                json!({"session_id":session,"block_ids":[block],"mode":"take"}),
            )
            .await?;
        control
            .terminal(&session, &block, "resize", json!({"columns":100,"rows":30}))
            .await?;
        tokio::time::sleep(Duration::from_secs(3)).await;
        let size = control
            .terminal(&session, &block, "size", json!({}))
            .await?;
        proof!(
            "q1",
            "{name}: after take+resize and 3 s: {}x{} owner is me={}",
            size["columns"],
            size["rows"],
            size["owner"] == control.client_id().as_str()
        );
        let mut seen = Vec::new();
        while let Ok(event) = events.try_recv() {
            let inner = &event["payload"]["payload"]["event"];
            let kind = inner["type"].as_str().unwrap_or_default().to_owned();
            if kind == "block_owner_changed"
                || kind == "client_connected"
                || (kind == "block_event" && inner["payload"]["name"] == "size_changed")
            {
                seen.push(json!({"type":kind,"payload":inner["payload"]}));
            }
        }
        proof!(
            "q1",
            "{name}: owner/size/client events seen = {}",
            json!(seen)
        );
        control
            .call("session.destroy", json!({"session_id":session}))
            .await?;
        control.close().await;
        if name == "own" {
            proof!(
                "q1",
                "own: rex ls on own socket: {}",
                rex(&server.socket, &["ls", "--json"])?.replace('\n', "")
            );
            server.stop();
        }
    }
    Ok(())
}

/// Q2: start a block with launch.rs's argv, env and cwd; then a bad cwd.
pub(crate) async fn q2(scratch: &Path) -> Result<()> {
    let (argv, env, cwd) = agent_launch(scratch)?;
    let cwd = cwd.to_str().unwrap().to_owned();
    proof!("q2", "launch.rs argv = {argv:?}");
    proof!(
        "q2",
        "launch env has ROUNDUP_AGENT={:?} RUPD_SOCKET={:?} CLAUDECODE={:?} ({} vars)",
        env.get("ROUNDUP_AGENT"),
        env.get("RUPD_SOCKET"),
        env.get("CLAUDECODE"),
        env.len()
    );
    let server = Server::own(false)?;
    let control = Control::connect(&server.socket, "roundup-spike", None).await?;
    let cases = [
        ("naive", options(argv.clone(), Some(&cwd), 80, 24, true)),
        (
            "wrapped",
            options(rex_command(&argv, &env, &cwd, false), None, 80, 24, true),
        ),
        (
            "naive-bad-cwd",
            options(argv.clone(), Some("/nonexistent/spike"), 80, 24, true),
        ),
        (
            "wrapped-bad-cwd",
            options(
                rex_command(&argv, &env, "/nonexistent/spike", false),
                None,
                80,
                24,
                true,
            ),
        ),
    ];
    for (name, options) in cases {
        let (session, block) = create(&control, &format!("q2-{name}"), options).await?;
        let mut events = control.events();
        let text = wait_screen(&control, &session, &block, "ready>").await;
        let shown: Vec<&str> = text
            .lines()
            .filter(|l| {
                l.starts_with("fake-agent")
                    || l.starts_with("argv")
                    || l.starts_with("env ")
                    || l.starts_with("env:")
            })
            .collect();
        proof!("q2", "{name}: screen = {shown:?}");
        if !text.contains("ready>") {
            let exited = block_event(
                &mut events,
                &block,
                "child_exited",
                Duration::from_millis(300),
            )
            .await;
            let process = control
                .terminal(&session, &block, "process", json!({}))
                .await?;
            proof!(
                "q2",
                "{name}: child_exited={exited:?} last_exit={} block still listed={}",
                process["last_exit"],
                control
                    .call("session.list_blocks", json!({"session_id":session}))
                    .await
                    .map(|b| b.to_string().contains(&block))
                    .unwrap_or(false)
            );
        }
        control
            .call("session.destroy", json!({"session_id":session}))
            .await?;
    }
    control.close().await;
    Ok(())
}

/// Q2/Q7 side check: does Rex report the exit code of a program that fails at once?
pub(crate) async fn exitcodes() -> Result<()> {
    let server = Server::own(false)?;
    let control = Control::connect(&server.socket, "roundup", None).await?;
    let cases: [(&str, Vec<&str>); 7] = [
        (
            "[shell /bin/sh, login false] sh exit 7 after 1 s",
            vec!["SH", "/bin/sh", "-c", "sleep 1; exit 7"],
        ),
        (
            "[login shell] sh exit 7 after 1 s",
            vec!["LOGIN", "/bin/sh", "-c", "sleep 1; exit 7"],
        ),
        (
            "[login shell, closes] sh exit 7 after 1 s",
            vec!["LOGINCLOSE", "/bin/sh", "-c", "sleep 1; exit 7"],
        ),
        ("sh exit 125 at once", vec!["/bin/sh", "-c", "exit 125"]),
        (
            "sh exit 125 after 1 s",
            vec!["/bin/sh", "-c", "sleep 1; exit 125"],
        ),
        (
            "env -C bad",
            vec![
                "/usr/bin/env",
                "-i",
                "-C",
                "/nonexistent/spike",
                "/usr/bin/true",
            ],
        ),
        (
            "env -C bad after 1 s",
            vec![
                "/bin/sh",
                "-c",
                "sleep 1; exec /usr/bin/env -i -C /nonexistent/spike /usr/bin/true",
            ],
        ),
    ];
    for (name, command) in cases {
        let options = match command[0] {
            "LOGIN" => json!({"command":command[1..],"exit":{"on_completion":false}}),
            "SH" => {
                json!({"shell":"/bin/sh","login":false,"command":command[1..],"exit":{"on_completion":false}})
            }
            "LOGINCLOSE" => json!({"command":command[1..]}),
            _ => json!({"shell":"none","command":command,"exit":{"on_completion":false}}),
        };
        let created = control.call("session.create", json!({"label":"exitcodes","initial_windows":[{"layout":{"block":{"flavor":SHELL,"options":options}}}]})).await?;
        let session = created["session_id"].as_str().unwrap().to_owned();
        let block = created["initial_windows"][0]["block_ids"][0]
            .as_str()
            .unwrap()
            .to_owned();
        let mut events = control.events();
        control
            .call("session.attach", json!({"session_id":session}))
            .await?;
        let event = block_event(&mut events, &block, "child_exited", Duration::from_secs(3)).await;
        let process = control
            .terminal(&session, &block, "process", json!({}))
            .await
            .unwrap_or_else(|e| json!({"last_exit": e.to_string()}));
        proof!(
            "exit",
            "{name}: child_exited={:?} last_exit={}",
            event.map(|e| e.to_string()).map_err(|e| e.to_string()),
            process["last_exit"]
        );
        control
            .call("session.destroy", json!({"session_id":session}))
            .await?;
    }
    control.close().await;
    Ok(())
}
