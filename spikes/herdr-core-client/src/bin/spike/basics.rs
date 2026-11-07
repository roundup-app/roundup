//! Q1 connect, Q2 spawn, Q6 input, Q8 status.
use super::*;

pub(crate) async fn q1() -> Result<()> {
    // Plain mode first, on a raw ssh pipe: hello without `framed`, then a call.
    let t = Instant::now();
    let out = {
        use std::io::Write;
        let mut child = Command::new("ssh")
            .args(["-T", "-o", "BatchMode=yes", herdr_core_client_spike::HOST, "herdr-core connect"])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .spawn()?;
        let mut stdin = child.stdin.take().unwrap();
        stdin.write_all(b"{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"hello\",\"params\":{\"generation\":1}}\n{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"terminal.list\",\"params\":{}}\n")?;
        drop(stdin);
        String::from_utf8_lossy(&child.wait_with_output()?.stdout).into_owned()
    };
    let lines: Vec<&str> = out.lines().collect();
    let h: Value = serde_json::from_str(lines[0])?;
    proof!("q1", "plain mode: {} lines back in {:?}; hello.framed={} generation={} version={} core={}", lines.len(), t.elapsed(), h["result"]["framed"], h["result"]["generation"], h["result"]["version"], h["result"]["core"]);
    proof!("q1", "plain mode terminal.list reply: {}", lines.get(1).unwrap_or(&""));
    let t = Instant::now();
    let c = Conn::connect().await?;
    proof!("q1", "framed connect+hello in {:?} (ssh spawn, auth, core start, hello)", t.elapsed());
    proof!("q1", "framed hello: generation={} version={} framed={} features={} methods={}", c.hello["generation"], c.hello["version"], c.hello["framed"], c.hello["features"], c.hello["methods"].as_array().map_or(0, Vec::len));
    let status = c.call("server.status", json!({})).await?;
    proof!("q1", "server.status over framed channel 0: {status}");
    let mut rtt = Vec::new();
    for _ in 0..30 {
        let t = Instant::now();
        c.call("server.status", json!({})).await?;
        rtt.push(t.elapsed().as_secs_f64() * 1e3);
    }
    rtt.sort_by(|a, b| a.partial_cmp(b).unwrap());
    proof!("q1", "server.status round trip n=30 p50={:.1}ms p95={:.1}ms", pct(&rtt, 0.5), pct(&rtt, 0.95));
    let err = c.call_raw("terminal.get", json!({"terminal":"t999"})).await?;
    proof!("q1", "error shape: {}", err["error"]);
    let bad = c.call_raw("terminal.nope", json!({})).await?;
    proof!("q1", "unknown method: {}", bad["error"]);
    let g2 = c.call_raw("hello", json!({"generation":2})).await?;
    proof!("q1", "hello generation=2 (future): {}", g2);
    Ok(())
}

pub(crate) async fn q2() -> Result<()> {
    // Restart the core with marker variables in the environment of the ssh session that starts it:
    // `herdr-core connect` autostarts the core, which inherits that session's environment.
    {
        let c = Conn::connect().await?;
        let _ = c.call("server.stop", json!({})).await;
    }
    tokio::time::sleep(Duration::from_secs(1)).await;
    let c = Conn::connect_with(&["-T", "-o", "BatchMode=yes"], "env CLAUDECODE=1 CLAUDE_CODE_SESSION_ID=leaked SPIKE_MARK=from-core-start herdr-core connect").await?;
    proof!("q2", "core restarted with CLAUDECODE=1 CLAUDE_CODE_SESSION_ID=leaked SPIKE_MARK=from-core-start in the starting ssh session; core pid {}", c.call("server.status", json!({})).await?["pid"]);
    let show = |name: &'static str, id: String| {
        let c = &c;
        async move {
            let mut s = c.attach(&id, 100, 30, json!({"observe":true})).await.unwrap().1;
            let mut buf = Vec::new();
            until(&mut s, &mut buf, "ready> ", Duration::from_secs(5)).await;
            let t = text(&buf);
            for l in t.lines().filter(|l| l.starts_with("fake-agent") || l.starts_with("env ") || l.starts_with("argv") || l.starts_with("size")) {
                proof!("q2", "{name}: {}", l.trim_end());
            }
            s.close();
        }
    };
    std::fs::create_dir_all("/tmp/hs").ok();
    remote("mkdir -p /tmp/q2cwd");
    // (a) env + cwd + argv taken as given
    let r = c.call("terminal.run", json!({"argv":["fake-agent","--flag","two words"],"cwd":"/tmp/q2cwd","env":{"ROUNDUP_AGENT":"7","RUPD_SOCKET":"/home/boxd/rupd.sock","TERM":"xterm-256color"},"name":"q2a","size":{"cols":100,"rows":30}})).await?;
    proof!("q2", "run reply keys: state={} cwd={} argv={} pid={}", r["state"], r["cwd"], r["argv"], r["pid"]);
    show("env-passed", "q2a".into()).await;
    // (b) clearing the leaked markers: env value "" , and `env -u`
    c.call("terminal.run", json!({"argv":["fake-agent"],"cwd":"/tmp","env":{"CLAUDECODE":"","SPIKE_MARK":""},"name":"q2b","size":{"cols":100,"rows":30}})).await?;
    show("env-empty-string", "q2b".into()).await;
    c.call("terminal.run", json!({"argv":["env","-u","CLAUDECODE","-u","CLAUDE_CODE_SESSION_ID","-u","SPIKE_MARK","fake-agent"],"cwd":"/tmp","env":{"ROUNDUP_AGENT":"8"},"name":"q2c","size":{"cols":100,"rows":30}})).await?;
    show("env-u-wrapper", "q2c".into()).await;
    c.call("terminal.run", json!({"argv":["env","-i","PATH=/usr/local/bin:/usr/bin:/bin","TERM=xterm-256color","ROUNDUP_AGENT=9","fake-agent"],"cwd":"/tmp","name":"q2d","size":{"cols":100,"rows":30}})).await?;
    show("env-i-wrapper", "q2d".into()).await;
    // (c) bad cwd
    let bad = c.call_raw("terminal.run", json!({"argv":["fake-agent"],"cwd":"/nonexistent/dir","name":"q2e","size":{"cols":100,"rows":30}})).await?;
    proof!("q2", "bad cwd reply: {}", serde_json::to_string(&bad)?.chars().take(700).collect::<String>());
    if bad.get("result").is_some() {
        tokio::time::sleep(Duration::from_secs(1)).await;
        let g = c.call("terminal.get", json!({"terminal":"q2e"})).await?;
        proof!("q2", "bad cwd terminal.get: state={} exit_code={} reason={} cwd={} screen={:?}", g["state"], g["exit_code"], g["reason"], g["cwd"], g["screen"]);
    }
    let bad2 = c.call_raw("terminal.run", json!({"argv":["no-such-program"],"cwd":"/tmp","name":"q2f","size":{"cols":100,"rows":30}})).await?;
    proof!("q2", "bad program reply: {}", serde_json::to_string(&bad2)?.chars().take(500).collect::<String>());
    tokio::time::sleep(Duration::from_millis(500)).await;
    if bad2.get("result").is_some() {
        let g = c.call("terminal.get", json!({"terminal":"q2f"})).await?;
        proof!("q2", "bad program terminal.get: state={} exit_code={} reason={}", g["state"], g["exit_code"], g["reason"]);
    }
    kill_all(&c).await;
    Ok(())
}

pub(crate) async fn q6() -> Result<()> {
    let c = Conn::connect().await?;
    kill_all(&c).await;
    let id = run_agent(&c, "q6", json!({}), true).await?;
    let (_, mut s) = c.attach(&id, 100, 30, json!({})).await?;
    s.send(b"g"); // open the gate
    let mut buf = Vec::new();
    until(&mut s, &mut buf, "ready> ", Duration::from_secs(10)).await;
    // The fake agent prints `turn N paste=<bool> got="<text>"` per Enter.
    let check = |buf: &[u8], tag: &str, n: usize| {
        let t = text(buf);
        let mut intact = 0;
        for i in 0..n {
            if t.contains(&format!("paste=true got=\"{tag}{i:03}\"")) {
                intact += 1;
            }
        }
        intact
    };
    // A. terminal.send: paste, 200 ms pause, Enter; awaited one at a time (reply = after the Enter).
    let t0 = Instant::now();
    let mut reply_kinds = String::new();
    for i in 0..100 {
        let r = c.call("terminal.send", json!({"terminal":id,"text":format!("A{i:03}"),"force":true})).await?;
        if i == 0 {
            reply_kinds = r.to_string();
        }
    }
    let a_dur = t0.elapsed();
    settle(&mut s, &mut buf, Duration::from_millis(500)).await;
    proof!("q6", "A terminal.send awaited x100: intact={} in {:?}; reply={}", check(&buf, "A", 100), a_dur, reply_kinds);
    // B. terminal.send pipelined (no await between): ordering of 100 sends on one connection.
    let t0 = Instant::now();
    let rxs: Vec<_> = (0..100).map(|i| c.send_call("terminal.send", json!({"terminal":id,"text":format!("B{i:03}"),"force":true})).unwrap()).collect();
    for rx in rxs {
        let _ = rx.await;
    }
    settle(&mut s, &mut buf, Duration::from_millis(500)).await;
    let t = text(&buf);
    let order: Vec<usize> = (0..100).filter_map(|i| t.find(&format!("got=\"B{i:03}\""))).collect();
    proof!("q6", "B terminal.send pipelined x100: intact={} in-order={} in {:?}", check(&buf, "B", 100), order.windows(2).all(|w| w[0] < w[1]), t0.elapsed());
    // C. attach channel DATA: bracketed paste, then \r as a separate DATA frame, pipelined.
    for i in 0..100 {
        s.send(format!("\x1b[200~C{i:03}\x1b[201~").as_bytes());
        s.send(b"\r");
    }
    settle(&mut s, &mut buf, Duration::from_millis(800)).await;
    proof!("q6", "C channel DATA paste + separate \\r frame, pipelined x100: intact={}", check(&buf, "C", 100));
    // D. channel DATA paste, then terminal.keys enter over RPC, pipelined (two paths: stream vs channel 0).
    let mut rxs = Vec::new();
    for i in 0..100 {
        s.send(format!("\x1b[200~D{i:03}\x1b[201~").as_bytes());
        rxs.push(c.send_call("terminal.keys", json!({"terminal":id,"keys":["enter"]}))?);
    }
    for rx in rxs {
        let _ = rx.await;
    }
    settle(&mut s, &mut buf, Duration::from_millis(800)).await;
    proof!("q6", "D channel DATA paste + RPC terminal.keys enter, pipelined x100: intact={}", check(&buf, "D", 100));
    // E. same, awaiting the keys reply before the next paste (reply = what?).
    let t0 = Instant::now();
    for i in 0..20 {
        s.send(format!("\x1b[200~E{i:03}\x1b[201~").as_bytes());
        c.call("terminal.keys", json!({"terminal":id,"keys":["enter"]})).await?;
    }
    settle(&mut s, &mut buf, Duration::from_millis(800)).await;
    proof!("q6", "E channel DATA paste then awaited RPC terminal.keys enter x20: intact={} in {:?} (each keys call waits out the viewer's quiet period)", check(&buf, "E", 20), t0.elapsed());
    // F. what does the reply confirm? Time the reply against the echo of the key on the stream.
    let (mut before, mut after) = (0, 0);
    for i in 0..30 {
        let mark = format!("Z{i:02}");
        let n0 = buf.len();
        let rx = c.send_call("terminal.keys", json!({"terminal":id,"keys":[mark.chars().next().unwrap().to_string()]}))?;
        let _ = rx.await; // reply received
        // Is the echoed byte already in the stream the instant the reply arrives?
        let mut got = false;
        for _ in 0..3 {
            if let Ok(Some(Ev::Data(b))) = tokio::time::timeout(Duration::from_millis(1), s.next()).await {
                buf.extend(b);
            }
        }
        if buf.len() > n0 {
            got = true;
        }
        if got { before += 1 } else { after += 1 }
        let _ = c.call("terminal.keys", json!({"terminal":id,"keys":["enter"]})).await;
        settle(&mut s, &mut buf, Duration::from_millis(50)).await;
    }
    proof!("q6", "F echo already on the stream within 1-3 ms of the keys reply: {before}/30 (not yet: {after}/30)");
    let rk = c.call("terminal.keys", json!({"terminal":id,"keys":["a"]})).await?;
    proof!("q6", "terminal.keys reply: {rk}");
    let sk = c.call_raw("terminal.send", json!({"terminal":id,"text":"x","if":"working"})).await?;
    proof!("q6", "terminal.send if=working while status unreported: {}", sk);
    kill_all(&c).await;
    Ok(())
}

pub(crate) async fn q8() -> Result<()> {
    let c = Conn::connect().await?;
    kill_all(&c).await;
    let id = run_agent(&c, "q8", json!({}), true).await?;
    let (_, mut stream) = c.attach(&id, 100, 30, json!({})).await?;
    // events.subscribe: framed mode gives a channel for the notifications.
    let sub = c.call("events.subscribe", json!({})).await?;
    proof!("q8", "events.subscribe reply: seq={} terminals={} channel={}", sub["seq"], sub["terminals"].as_array().map_or(0, Vec::len), sub["channel"]);
    let mut events = sub["channel"].as_u64().map(|ch| c.open_channel(ch as u32));
    stream.send(b"g");
    let mut buf = Vec::new();
    until(&mut stream, &mut buf, "ready> ", Duration::from_secs(10)).await;
    let t_send = Instant::now();
    stream.send(b"status working reading files\r");
    let mut ev_bytes = Vec::new();
    let mut t_stream = None;
    let mut t_event = None;
    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline && (t_stream.is_none() || t_event.is_none()) {
        tokio::select! {
            ev = stream.next() => if let Some(Ev::Data(b)) = ev {
                buf.extend(b);
                if t_stream.is_none() && find(&buf, b"state=working:msg=").is_some() { t_stream = Some(t_send.elapsed()); }
            },
            ev = async { match events.as_mut() { Some(e) => e.next().await, None => std::future::pending().await } } => if let Some(Ev::Data(b)) = ev {
                ev_bytes.extend(&b);
                if t_event.is_none() && String::from_utf8_lossy(&b).contains("\"working\"") { t_event = Some(t_send.elapsed()); }
            },
            _ = tokio::time::sleep(Duration::from_millis(100)) => {}
        }
    }
    let esc = find(&buf, b"\x1b]7501;state=working:msg=").map(|i| &buf[i..]);
    let osc: Vec<u8> = esc.map(|b| b.iter().cloned().take_while(|&x| x != b'\\').chain(std::iter::once(b'\\')).collect()).unwrap_or_default();
    proof!("q8", "stream carries OSC 7501 bytes: {:?} (printed by the agent: \"\\x1b]7501;state=working:msg=cmVhZGluZyBmaWxlcw==\\x1b\\\\\") after {:?}", String::from_utf8_lossy(&osc), t_stream);
    proof!("q8", "stream OSC exactly as printed: {}", osc == b"\x1b]7501;state=working:msg=cmVhZGluZyBmaWxlcw==\x1b\\");
    proof!("q8", "events.subscribe status event after {:?}; raw: {}", t_event, text(&ev_bytes).replace("\n", " | ").chars().take(1200).collect::<String>());
    let g = c.call("terminal.get", json!({"terminal":id})).await?;
    proof!("q8", "terminal.get status={} reported={} records={}", g["status"], g["reported"], g["records"]);
    stream.send(b"title my title\r");
    let mut ev2 = Vec::new();
    if let Some(e) = events.as_mut() {
        let end = Instant::now() + Duration::from_secs(2);
        while let Ok(Some(Ev::Data(b))) = tokio::time::timeout(end.saturating_duration_since(Instant::now()), e.next()).await {
            ev2.extend(b);
        }
    }
    proof!("q8", "title event: {}", text(&ev2).lines().filter(|l| l.contains("title")).collect::<Vec<_>>().join(" | "));
    kill_all(&c).await;
    Ok(())
}
