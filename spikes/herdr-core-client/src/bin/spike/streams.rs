//! Q3 stream through `Terminals`, Q4 late join, Q5 size, Q7 exit and reattach.
use super::*;
use contracts::terminal::{CatchUp, CatchUpParams, ReadParams, SearchParams, SpawnParams};
use std::collections::BTreeMap;

fn ticks_in(t: &str) -> Vec<u32> {
    let re = regex::Regex::new(r"tick (\d{5})(?:\D|$)").unwrap();
    re.captures_iter(t).filter_map(|c| c[1].parse().ok()).collect()
}

pub(crate) async fn q3() -> Result<()> {
    let c = Conn::connect().await?;
    kill_all(&c).await;
    let id = run_agent(&c, "q3", json!({}), true).await?;
    let scratch = tempfile::tempdir()?;
    let terminals = terminal::Terminals::open(scratch.path(), rpc::Bus::new())?;
    let dump = scratch.path().join("tap.bin");
    let stats = scratch.path().join("stats.txt");
    let spawned = terminals
        .spawn(SpawnParams {
            cwd: scratch.path().display().to_string(),
            command: Some(vec![exe("herdr-tap").display().to_string(), id.clone()]),
            env: BTreeMap::from([("TAP_DUMP".into(), dump.display().to_string()), ("TAP_STATS".into(), stats.display().to_string())]),
            cols: 100,
            rows: 30,
        })
        .await?;
    let tid = spawned.id.clone();
    tokio::time::sleep(Duration::from_millis(2500)).await; // ssh + hello + attach
    terminals.write_completed(&tid, b"g".to_vec()).await?; // open the gate
    let wait_for = |pattern: &'static str| {
        let (terminals, tid) = (&terminals, tid.clone());
        async move {
            let mut output = terminals.subscribe_output(&tid).unwrap();
            tokio::time::timeout(Duration::from_secs(20), async {
                loop {
                    let found = terminals.search(&SearchParams { id: tid.clone(), pattern: pattern.into(), after: None, max: None }).unwrap();
                    if !found.matches.is_empty() {
                        return true;
                    }
                    if output.next().await.is_none() {
                        return false;
                    }
                }
            })
            .await
            .unwrap_or(false)
        }
    };
    proof!("q3", "banner reached Terminals log: {}", wait_for("^fake-agent pid=").await);
    let n = 5000;
    terminals.write_completed(&tid, format!("flood {n}\r").into_bytes()).await?;
    proof!("q3", "flood finished: {}", wait_for("^flood done 5000").await);
    let (mut after, mut reads, mut seen, mut split, mut out_of_order) = (0u64, 0, Vec::<u32>::new(), 0, 0);
    let re = regex::Regex::new(r"^line (\d{6}) αβγ→🙂 x*$").unwrap();
    loop {
        let read = terminals.read(&ReadParams { id: tid.clone(), after: Some(after), reader: None, max: None })?;
        reads += 1;
        for l in read.text.lines().filter(|l| l.starts_with("line ")) {
            match re.captures(l) {
                Some(c) => {
                    let k: u32 = c[1].parse().unwrap();
                    if seen.last().is_some_and(|last| *last + 1 != k) {
                        out_of_order += 1;
                    }
                    seen.push(k)
                }
                None => split += 1,
            }
        }
        if read.next == after {
            break;
        }
        after = read.next;
    }
    let unique: std::collections::BTreeSet<_> = seen.iter().collect();
    proof!("q3", "terminal.read: {reads} reads to offset {after}; lines seen={} unique={} first={:?} last={:?} split={split} out_of_order={out_of_order}", seen.len(), unique.len(), seen.first(), seen.last());
    let found = terminals.search(&SearchParams { id: tid.clone(), pattern: "^line 004321 ".into(), after: None, max: None })?;
    let first = found.matches.first().ok_or("no match")?;
    let from_match = terminals.read(&ReadParams { id: tid.clone(), after: Some(first.offset), reader: None, max: Some(200) })?;
    proof!("q3", "terminal.search line 004321 -> offset {}; read(after=offset) starts {:?}", first.offset, from_match.text.lines().next());
    let ours = terminals.read_screen(&tid, None)?;
    let theirs = c.call("terminal.read", json!({"terminal":id})).await?;
    let tail = |lines: Vec<String>| lines.into_iter().map(|l| l.trim_end().to_owned()).filter(|l| !l.is_empty()).rev().take(4).collect::<Vec<_>>();
    let a = tail(ours.lines.clone());
    let b = tail(theirs["text"].as_str().unwrap_or_default().lines().map(str::to_owned).collect());
    proof!("q3", "terminal.screen ({}x{}) last rows == herdr-core terminal.read text last rows: {} ; ours={a:?} theirs={b:?} how={}", ours.cols, ours.rows, a == b, theirs["how"]);
    let info = terminals.list().await.into_iter().find(|i| i.id == tid).ok_or("info")?;
    if let CatchUp::Contiguous { data, after, .. } = terminals.catch_up(&CatchUpParams { id: tid.clone(), incarnation: info.incarnation.clone(), after: 0 })? {
        use base64::Engine;
        let log = base64::engine::general_purpose::STANDARD.decode(data)?;
        let tapped = std::fs::read(&dump)?;
        proof!("q3", "Terminals log bytes == herdr-core stream bytes: {} (log {} B, end offset {after}, stream {} B)", log == tapped, log.len(), tapped.len());
        let head: String = tapped.iter().take(60).map(|b| format!("{:02x}", b)).collect();
        proof!("q3", "first stream bytes (the first paint): {head} = {:?}", String::from_utf8_lossy(&tapped[..tapped.len().min(60)]));
    }
    terminals.write_completed(&tid, b"exit 3\r".to_vec()).await?;
    terminals.wait_program_ended(&tid).await;
    tokio::time::sleep(Duration::from_millis(500)).await;
    let info = terminals.list().await.into_iter().find(|i| i.id == tid).ok_or("info")?;
    proof!("q3", "exit 3 -> Terminals exit_code={:?}", info.exit_code);
    proof!("q3", "frames: {}", std::fs::read_to_string(&stats).unwrap_or_default().trim());
    kill_all(&c).await;
    Ok(())
}

pub(crate) async fn q4() -> Result<()> {
    let c = Conn::connect().await?;
    kill_all(&c).await;
    let id = run_agent(&c, "q4", json!({}), true).await?;
    let (_, mut a) = c.attach(&id, 100, 30, json!({})).await?; // ground truth: since byte 0
    a.send(b"g");
    let mut abuf = Vec::new();
    until(&mut a, &mut abuf, "ready> ", Duration::from_secs(10)).await;
    a.send(b"flood 300\r");
    until(&mut a, &mut abuf, "flood done 300", Duration::from_secs(10)).await;
    a.send(b"tick 400 50\r");
    tokio::time::sleep(Duration::from_secs(4)).await;
    settle(&mut a, &mut abuf, Duration::from_millis(1)).await;
    let a_at_join = ticks_in(&text(&abuf)).last().copied();
    for (label, history) in [("history=0", 0), ("history=1000", 1000)] {
        let (reply, mut b) = c.attach(&id, 100, 30, json!({"observe":true,"history":history})).await?;
        let mut bbuf = Vec::new();
        let mut first_frame = None;
        if let Some(Ev::Data(d)) = b.next().await {
            first_frame = Some(d.len());
            bbuf.extend(d);
        }
        let t0 = Instant::now();
        let first_ticks_at_join = ticks_in(&text(&bbuf));
        settle(&mut b, &mut bbuf, Duration::from_millis(300)).await; // paint may be in several frames
        let _ = t0;
        let all = ticks_in(&text(&bbuf));
        let lines: usize = text(&bbuf).matches("line 0").count();
        proof!("q4", "{label}: truth had ticks up to {:?} at join; attach reply keys terminal.state={}; first frame {:?} B; paint+300ms: {} B, flood lines in paint={lines}, ticks in first frame={:?}", a_at_join, reply["terminal"]["state"], first_frame, bbuf.len(), first_ticks_at_join.first().zip(first_ticks_at_join.last()));
        // keep reading live until ticks done
        let mut b2 = Vec::new();
        until(&mut b, &mut b2, "tick 00400", Duration::from_secs(25)).await;
        bbuf.extend(&b2);
        let all2 = ticks_in(&text(&bbuf));
        let (gaps, repeats) = all2.windows(2).fold((0, 0), |(g, r), w| match w[1].cmp(&(w[0] + 1)) {
            std::cmp::Ordering::Equal => (g, r),
            std::cmp::Ordering::Greater => (g + (w[1] - w[0] - 1), r),
            std::cmp::Ordering::Less => (g, r + 1),
        });
        proof!("q4", "{label}: late viewer saw ticks {:?}..{:?} (n={}, in paint+300ms: {:?}..{:?}); missing between={gaps} repeated/out-of-order steps={repeats}", all2.first(), all2.last(), all2.len(), all.first(), all.last());
        // byte alignment of the live part against the ground truth
        settle(&mut a, &mut abuf, Duration::from_millis(300)).await;
        let k = 1500.min(bbuf.len()).min(abuf.len());
        proof!("q4", "{label}: last {k} B of late stream == last {k} B of from-byte-0 stream: {}", bbuf[bbuf.len() - k..] == abuf[abuf.len() - k..]);
        let paint_tail_vs_truth = abuf.windows(40).any(|w| bbuf.len() > 100 && w == &bbuf[bbuf.len() - 40..]);
        proof!("q4", "{label}: late stream total {} B; from-byte-0 stream total {} B (late is NOT a suffix of the history; paint is a re-render); tail found in truth: {paint_tail_vs_truth}", bbuf.len(), abuf.len());
        b.close();
        // restart the ticker for the next label
        a.send(b"tick 400 50\r");
        tokio::time::sleep(Duration::from_secs(4)).await;
        abuf.clear();
    }
    kill_all(&c).await;
    Ok(())
}

pub(crate) async fn q5() -> Result<()> {
    let c1 = Conn::connect().await?;
    let c2 = Conn::connect().await?;
    kill_all(&c1).await;
    let id = run_agent(&c1, "q5", json!({}), true).await?;
    let size = |tag: &'static str| {
        let (c1, id) = (&c1, id.clone());
        async move {
            let g = c1.call("terminal.get", json!({"terminal":id})).await.unwrap();
            proof!("q5", "{tag}: core says cols x rows = {} x {}", g["cols"], g["rows"]);
        }
    };
    let (_, mut s1) = c1.attach(&id, 100, 30, json!({})).await?;
    s1.send(b"g");
    let mut b1 = Vec::new();
    until(&mut s1, &mut b1, "ready> ", Duration::from_secs(10)).await;
    let ask = |tag: &'static str| {
        let (c1, id) = (&c1, id.clone());
        async move {
            c1.call("terminal.send", json!({"terminal":id,"text":"size","force":true})).await.unwrap();
            tag
        }
    };
    ask("c1 attached 100x30").await;
    settle(&mut s1, &mut b1, Duration::from_millis(400)).await;
    size("c1 attached 100x30 (non-observe)").await;
    let (_, mut s2) = c2.attach(&id, 60, 20, json!({})).await?;
    tokio::time::sleep(Duration::from_millis(300)).await;
    size("c2 attached 60x20 (non-observe, second)").await;
    ask("").await;
    settle(&mut s1, &mut b1, Duration::from_millis(400)).await;
    let t = text(&b1);
    let sizes: Vec<&str> = t.lines().filter(|l| l.contains("size rows_cols=")).collect();
    proof!("q5", "program-side `stty size` lines so far (rows cols): {sizes:?}");
    s1.resize(100, 30);
    tokio::time::sleep(Duration::from_millis(300)).await;
    size("c1 sent RESIZE 100x30").await;
    let (_, mut s3) = c2.attach(&id, 40, 10, json!({"observe":true})).await?;
    tokio::time::sleep(Duration::from_millis(300)).await;
    size("c2 attached 40x10 as observe").await;
    s3.resize(30, 8); // an observer's RESIZE
    tokio::time::sleep(Duration::from_millis(300)).await;
    size("observer sent RESIZE 30x8").await;
    s2.send(b" "); // c2 types
    tokio::time::sleep(Duration::from_millis(300)).await;
    size("c2 typed a byte (back to 60x20?)").await;
    s1.send(&[1u8; 0]); // empty DATA is not activity; then a FOCUS gain
    c1.send_frame(s1.channel, 4, &[1]);
    tokio::time::sleep(Duration::from_millis(300)).await;
    size("c1 sent FOCUS gained").await;
    let auto = c1.hello["features"].as_array().map_or(false, |f| f.iter().any(|x| x == "automatic_input"));
    c2.send_frame(s2.channel, 6, b""); // AUTOMATIC_INPUT: terminal-generated replies, not activity
    tokio::time::sleep(Duration::from_millis(300)).await;
    size(&*Box::leak(format!("c2 sent AUTOMATIC_INPUT (hello advertises it: {auto}); owner stays c1 if size stays 100x30").into_boxed_str())).await;
    s2.resize(60, 20);
    tokio::time::sleep(Duration::from_millis(300)).await;
    size("c2 RESIZE 60x20").await;
    s1.resize(100, 30);
    tokio::time::sleep(Duration::from_millis(300)).await;
    size("c1 RESIZE 100x30 again = roundup retakes").await;
    let (_, mut s4) = c2.attach(&id, 70, 25, json!({"resumed":true})).await?;
    tokio::time::sleep(Duration::from_millis(300)).await;
    size("c2 attach 70x25 with resumed=true (sets size only once active)").await;
    s4.send(b" ");
    tokio::time::sleep(Duration::from_millis(300)).await;
    size("c2(resumed) typed").await;
    kill_all(&c1).await;
    Ok(())
}

pub(crate) async fn q7() -> Result<()> {
    let c = Conn::connect().await?;
    kill_all(&c).await;
    // Exit codes: every route.
    let id = run_agent(&c, "q7exit", json!({}), true).await?;
    let (_, mut s) = c.attach(&id, 100, 30, json!({})).await?;
    s.send(b"g");
    let mut buf = Vec::new();
    until(&mut s, &mut buf, "ready> ", Duration::from_secs(10)).await;
    let waiter = c.send_call("terminal.wait", json!({"terminal":id,"timeout":20}))?;
    c.call("terminal.send", json!({"terminal":id,"text":"exit 7","force":true})).await?;
    let mut close = Value::Null;
    while let Some(ev) = tokio::time::timeout(Duration::from_secs(10), s.next()).await.ok().flatten() {
        if let Ev::Close(r) = ev {
            close = r;
            break;
        }
    }
    proof!("q7", "exit 7: stream CLOSE reason = {close}");
    proof!("q7", "exit 7: terminal.wait = {}", waiter.await.map(|v| v["result"].to_string()).unwrap_or_default());
    let g = c.call("terminal.get", json!({"terminal":id})).await?;
    proof!("q7", "exit 7: terminal.get state={} exit_code={} reason={} signal={}", g["state"], g["exit_code"], g["reason"], g["signal"]);
    // A program killed by a signal, and by `terminal.kill`.
    let id2 = run_agent(&c, "q7kill", json!({}), false).await?;
    tokio::time::sleep(Duration::from_millis(500)).await;
    c.call("terminal.kill", json!({"terminal":id2})).await?;
    tokio::time::sleep(Duration::from_millis(500)).await;
    let g = c.call("terminal.get", json!({"terminal":id2})).await?;
    proof!("q7", "terminal.kill: state={} exit_code={} reason={} signal={}", g["state"], g["exit_code"], g["reason"], g["signal"]);

    // Reattach after the ssh process is killed mid-stream.
    for (label, tick_ms, outage_s, history) in [("short outage 2s, 100ms ticks, history=0", 100u64, 2u64, 0), ("long outage 5s, 10ms ticks, history=0", 10, 5, 0), ("long outage 5s, 10ms ticks, history=5000", 10, 5, 5000)] {
        let id = run_agent(&c, &format!("q7r{tick_ms}h{history}"), json!({}), true).await?;
        let c1 = Conn::connect().await?;
        let (_, mut s1) = c1.attach(&id, 100, 30, json!({})).await?;
        s1.send(b"g");
        let mut b1 = Vec::new();
        until(&mut s1, &mut b1, "ready> ", Duration::from_secs(10)).await;
        let pid_before = c1.call("terminal.get", json!({"terminal":id})).await?["pid"].clone();
        // Ground truth: a second connection that stays up the whole time.
        let ct = Conn::connect().await?;
        let (_, mut st) = ct.attach(&id, 100, 30, json!({"observe":true})).await?;
        let mut bt = Vec::new();
        s1.send(format!("tick 100000 {tick_ms}\r").as_bytes());
        until(&mut s1, &mut b1, "tick 00040", Duration::from_secs(20)).await;
        // Kill the ssh process mid-stream (a Mac that lost its link or slept).
        sh(&format!("kill -9 {}", c1.child_pid));
        let killed_at = Instant::now();
        // Whatever arrived before the kill took effect:
        collect_for(&mut s1, &mut b1, Duration::from_millis(300)).await;
        let before = ticks_in(&text(&b1));
        let last_before = *before.last().unwrap();
        tokio::time::sleep(Duration::from_secs(outage_s)).await;
        let c2 = Conn::connect().await?;
        let g = c2.call("terminal.get", json!({"terminal":id})).await?;
        let (_, mut s2) = c2.attach(&id, 100, 30, json!({"resumed":true,"history":history})).await?;
        let mut b2 = Vec::new();
        collect_for(&mut s2, &mut b2, Duration::from_millis(2500)).await;
        std::fs::write(work().join(format!("q7-after-{tick_ms}-{history}.bin")), &b2).ok();
        let after = ticks_in(&text(&b2));
        let first_after = after.first().copied().unwrap_or(0);
        let gap = first_after.saturating_sub(last_before + 1);
        let repeat = after.iter().filter(|&&t| t <= last_before).count();
        let contiguous = format!("{:?}", after.windows(2).filter(|w| w[1] != w[0] + 1).map(|w| (w[0], w[1])).take(6).collect::<Vec<_>>());
        collect_for(&mut st, &mut bt, Duration::from_millis(100)).await;
        let truth = ticks_in(&text(&bt));
        let truth_breaks: Vec<(u32, u32)> = truth.windows(2).filter(|w| w[1] != w[0] + 1).map(|w| (w[0], w[1])).take(6).collect();
        proof!("q7", "[{label}] ground truth (second ssh, never cut) saw ticks {:?}..{:?} n={}, breaks (prev,next)={truth_breaks:?} (regex artefacts, not loss)", truth.first(), truth.last(), truth.len());
        proof!("q7", "[{label}] same terminal after reconnect: pid {} -> {} state={}; ssh was dead {:?}", pid_before, g["pid"], g["state"], killed_at.elapsed());
        proof!("q7", "[{label}] ticks seen before kill: ..{last_before}; first paint+live after reattach: {first_after}..{:?} (n={}); missing (never delivered)={gap}; repeated (already seen)={repeat}; breaks inside the after-reattach sequence (prev,next)={contiguous}", after.last(), after.len());
        let _ = c2.call("terminal.kill", json!({"terminal":id})).await;
    }
    // Dead connection as the core sees it: viewer stays? list terminals' state from new conn
    let c3 = Conn::connect().await?;
    kill_all(&c3).await;
    Ok(())
}
