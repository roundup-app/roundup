//! Q9 delay, Q10 memory.
use super::*;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

fn rss_kb(pid: u32) -> u64 {
    sh(&format!("ps -o rss= -p {pid}")).trim().parse().unwrap_or(0)
}

pub(crate) async fn q9() -> Result<()> {
    let c = Conn::connect().await?;
    kill_all(&c).await;
    let id = run_agent(&c, "q9", json!({}), true).await?;
    let (_, mut s) = c.attach(&id, 100, 30, json!({})).await?;
    s.send(b"g");
    let mut buf = Vec::new();
    until(&mut s, &mut buf, "ready> ", Duration::from_secs(10)).await;
    // Baseline: plain `ssh host cat`, its own ssh connection, one byte in, one byte out.
    let mut cat = tokio::process::Command::new("ssh")
        .args(["-T", "-o", "BatchMode=yes", herdr_core_client_spike::HOST, "cat"])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .spawn()?;
    let mut cin = cat.stdin.take().unwrap();
    let mut cout = cat.stdout.take().unwrap();
    let mut b = [0u8; 1];
    for _ in 0..20 {
        cin.write_all(b"w").await?;
        cout.read_exact(&mut b).await?;
    }
    for _ in 0..20 {
        s.send(b"w");
        let mut sink = Vec::new();
        until(&mut s, &mut sink, "w", Duration::from_secs(2)).await;
    }
    let (mut base, mut core) = (Vec::new(), Vec::new());
    let n = 200;
    for i in 0..n {
        // Interleave A/B so drift (ssh path jitter) hits both alike.
        let t = Instant::now();
        cin.write_all(b"x").await?;
        cout.read_exact(&mut b).await?;
        base.push(t.elapsed().as_secs_f64() * 1e3);
        let t = Instant::now();
        s.send(b"x");
        loop {
            match tokio::time::timeout(Duration::from_secs(5), s.next()).await {
                Ok(Some(Ev::Data(d))) if d.contains(&b'x') => break,
                Ok(Some(_)) => {}
                _ => return Err("echo timed out".into()),
            }
        }
        core.push(t.elapsed().as_secs_f64() * 1e3);
        if i % 20 == 0 {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    }
    let diffs: Vec<f64> = core.iter().zip(&base).map(|(a, b)| a - b).collect();
    let mut sb = base.clone();
    let mut sc = core.clone();
    let mut sd = diffs.clone();
    for v in [&mut sb, &mut sc, &mut sd] {
        v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    }
    proof!("q9", "n={n} interleaved. baseline `ssh cat` echo: p50={:.3}ms p95={:.3}ms | through herdr-core attach stream: p50={:.3}ms p95={:.3}ms", pct(&sb, 0.5), pct(&sb, 0.95), pct(&sc, 0.5), pct(&sc, 0.95));
    proof!("q9", "added by herdr-core (core-minus-baseline): p50 of pairwise difference={:.3}ms p95={:.3}ms; difference of p50s={:.3}ms; difference of p95s={:.3}ms", pct(&sd, 0.5), pct(&sd, 0.95), pct(&sc, 0.5) - pct(&sb, 0.5), pct(&sc, 0.95) - pct(&sb, 0.95));
    proof!("q9", "baseline min={:.3}ms; core min={:.3}ms (the quiet-path floor)", sb[0], sc[0]);
    // The core's own cost without ssh: same echo, measured on the machine over the core's Unix socket.
    drop(cin);
    let _ = cat.kill().await;
    s.close();
    let out = remote(&format!("corebench {id} 500"));
    for l in out.lines() {
        proof!("q9", "on the machine, no ssh: {l}");
    }
    kill_all(&c).await;
    Ok(())
}

pub(crate) async fn q10() -> Result<()> {
    let me = std::process::id();
    let c = Conn::connect().await?;
    kill_all(&c).await;
    tokio::time::sleep(Duration::from_secs(1)).await;
    let rem = || remote("ps -eo rss=,comm= | awk '/herdr|holder/ {s+=$1; n++; print} END {print \"TOTAL_KB\", s, \"procs\", n}'");
    let r0 = rem();
    let (mac0, ssh0) = (rss_kb(me), rss_kb(c.child_pid));
    proof!("q10", "baseline (0 terminals): spike client RSS {} KB, its ssh {} KB; remote herdr procs:\n{}", mac0, ssh0, r0.trim());
    let mut ids = Vec::new();
    let mut streams = Vec::new();
    let mut parsers = Vec::new();
    for i in 0..10 {
        let id = run_agent(&c, &format!("m{i}"), json!({}), true).await?;
        let (_, mut s) = c.attach(&id, 100, 30, json!({})).await?;
        s.send(b"g");
        let mut b = Vec::new();
        until(&mut s, &mut b, "ready> ", Duration::from_secs(10)).await;
        let mut p = vt100::Parser::new(30, 100, 1000);
        p.process(&b);
        parsers.push(p);
        streams.push(s);
        ids.push(id);
    }
    for s in &streams {
        s.send(b"flood 200\r");
    }
    // Feed every stream into its vt100 mirror, as roundup's ScreenState would.
    let end = Instant::now() + Duration::from_secs(8);
    let mut done = 0;
    while done < 10 && Instant::now() < end {
        done = 0;
        for (s, p) in streams.iter_mut().zip(parsers.iter_mut()) {
            while let Ok(ev) = s.rx.try_recv() {
                if let Ev::Data(d) = ev {
                    p.process(&d);
                }
            }
            if p.screen().contents().contains("flood done 200") {
                done += 1;
            }
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    let (mac1, ssh1) = (rss_kb(me), rss_kb(c.child_pid));
    let r1 = rem();
    proof!("q10", "10 fake agents, each attached, flooded 200 lines, mirrored in vt100 (1000-line scrollback), {done}/10 done: spike client RSS {} KB (+{} KB), its single ssh {} KB (+{} KB)", mac1, mac1 as i64 - mac0 as i64, ssh1, ssh1 as i64 - ssh0 as i64);
    proof!("q10", "remote herdr procs with 10 terminals:\n{}", r1.trim());
    proof!("q10", "remote free: {}", remote("free -m | head -2 | tail -1").trim());
    kill_all(&c).await;
    Ok(())
}
