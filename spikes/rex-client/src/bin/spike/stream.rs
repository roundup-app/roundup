//! Q3 and Q4: the Rex stream through roundup's terminal crate, and late join.
use super::*;

/// Q3: Rex's raw stream through roundup's unchanged terminal crate (via rex-tap as the program).
pub(crate) async fn q3(scratch: &Path) -> Result<()> {
    let (argv, env, cwd) = agent_launch(scratch)?;
    let server = Server::own(false)?;
    let control = Control::connect(&server.socket, "roundup-spike", None).await?;
    let (session, block) = create(
        &control,
        "q3",
        options(
            rex_command(&argv, &env, cwd.to_str().unwrap(), true),
            None,
            100,
            30,
            false,
        ),
    )
    .await?;
    let terminals = terminal::Terminals::open(scratch, rpc::Bus::new())?;
    let dump = scratch.join("tap.bin");
    let spawned = terminals
        .spawn(SpawnParams {
            cwd: scratch.display().to_string(),
            command: Some(vec![
                exe("rex-tap").display().to_string(),
                server.socket.display().to_string(),
                session.clone(),
                block.clone(),
            ]),
            env: BTreeMap::from([("TAP_DUMP".into(), dump.display().to_string())]),
            cols: 100,
            rows: 30,
        })
        .await?;
    let id = spawned.id.clone();
    tokio::time::sleep(Duration::from_millis(500)).await;
    terminals.write_completed(&id, b"g".to_vec()).await?; // open the gate
    let wait_for = |pattern: &'static str| {
        let terminals = &terminals;
        let id = id.clone();
        async move {
            for _ in 0..200 {
                let found = terminals.search(&SearchParams {
                    id: id.clone(),
                    pattern: pattern.into(),
                    after: None,
                    max: None,
                });
                if found.map(|s| !s.matches.is_empty()).unwrap_or(false) {
                    return true;
                }
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
            false
        }
    };
    let banner = wait_for("^fake-agent pid=").await;
    proof!("q3", "banner reached Terminals log: {banner}");
    if !banner {
        let info = terminals
            .list()
            .await
            .into_iter()
            .find(|i| i.id == id)
            .ok_or("info")?;
        if let contracts::terminal::CatchUp::Contiguous { data, .. } =
            terminals.catch_up(&CatchUpParams {
                id: id.clone(),
                incarnation: info.incarnation.clone(),
                after: 0,
            })?
        {
            use base64::Engine;
            proof!(
                "q3",
                "log holds: {:?}",
                String::from_utf8_lossy(&base64::engine::general_purpose::STANDARD.decode(data)?)
            );
        }
    }
    let n = 5000;
    terminals
        .write_completed(&id, format!("flood {n}\r").into_bytes())
        .await?;
    proof!(
        "q3",
        "flood finished: {}",
        wait_for("^flood done 5000").await
    );
    // Read the whole log with `after` offsets, as `rup terminal read` does.
    let (mut after, mut reads, mut seen, mut split, mut out_of_order) =
        (0u64, 0, Vec::<u32>::new(), 0, 0);
    let line = regex_lite(r"^line (\d{6}) αβγ→🙂 x*$");
    loop {
        let read = terminals.read(&ReadParams {
            id: id.clone(),
            after: Some(after),
            reader: None,
            max: None,
        })?;
        reads += 1;
        for l in read.text.lines().filter(|l| l.starts_with("line ")) {
            match line(l) {
                Some(k) => {
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
    proof!(
        "q3",
        "terminal.read: {reads} reads to offset {after}; lines seen={} unique={} first={:?} last={:?} split={split} out_of_order={out_of_order}",
        seen.len(),
        unique.len(),
        seen.first(),
        seen.last()
    );
    let found = terminals.search(&SearchParams {
        id: id.clone(),
        pattern: "^line 004321 ".into(),
        after: None,
        max: None,
    })?;
    let first = found.matches.first().ok_or("no match")?;
    let from_match = terminals.read(&ReadParams {
        id: id.clone(),
        after: Some(first.offset),
        reader: None,
        max: Some(200),
    })?;
    proof!(
        "q3",
        "terminal.search line 004321 -> offset {}; read(after=offset) starts {:?}",
        first.offset,
        from_match.text.lines().next()
    );
    let ours = terminals.read_screen(&id, None)?;
    let theirs = screen_text(&control, &session, &block).await;
    let tail = |lines: Vec<String>| {
        lines
            .into_iter()
            .filter(|l| !l.trim().is_empty())
            .rev()
            .take(4)
            .collect::<Vec<_>>()
    };
    let a = tail(ours.lines.clone());
    let b = tail(theirs.lines().map(str::to_owned).collect());
    proof!(
        "q3",
        "terminal.screen ({}x{}) last rows == Rex format text last rows: {} ; ours={a:?}",
        ours.cols,
        ours.rows,
        a == b
    );
    let info = terminals
        .list()
        .await
        .into_iter()
        .find(|i| i.id == id)
        .ok_or("info")?;
    let caught = terminals.catch_up(&CatchUpParams {
        id: id.clone(),
        incarnation: info.incarnation.clone(),
        after: 0,
    })?;
    if let contracts::terminal::CatchUp::Contiguous { data, after, .. } = caught {
        use base64::Engine;
        let log = base64::engine::general_purpose::STANDARD.decode(data)?;
        let tapped = std::fs::read(&dump)?;
        proof!(
            "q3",
            "Terminals log bytes == Rex stream program bytes: {} (log {} B, end offset {after}, Rex program bytes {} B)",
            log == tapped,
            log.len(),
            tapped.len()
        );
    }
    terminals.write_completed(&id, b"exit 3\r".to_vec()).await?;
    terminals.wait_program_ended(&id).await;
    let info = terminals
        .list()
        .await
        .into_iter()
        .find(|i| i.id == id)
        .ok_or("info")?;
    proof!(
        "q3",
        "after `exit 3`: Terminals exit_code={:?} running={}",
        info.exit_code,
        info.running
    );
    let _ = control
        .call("session.destroy", json!({"session_id":session}))
        .await;
    control.close().await;
    Ok(())
}

pub(crate) fn regex_lite(pattern: &str) -> impl Fn(&str) -> Option<u32> {
    let re = regex::Regex::new(pattern).expect("regex");
    move |text| re.captures(text).and_then(|c| c[1].parse().ok())
}

/// Q4: late join. Snapshot bytes, `format vt` catch-up versus the live stream, and RESUME.
pub(crate) async fn q4(scratch: &Path) -> Result<()> {
    let (argv, env, cwd) = agent_launch(scratch)?;
    let server = Server::own(false)?;
    let control = Control::connect(&server.socket, "roundup-spike", None).await?;
    let (session, block) = create(
        &control,
        "q4",
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
    let every: u64 = std::env::var("TICK_MS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(20);
    let count = 1200 / every.max(1) + 40;
    proof!(
        "q4",
        "program prints one tick every {every} ms, {count} ticks"
    );
    control
        .terminal(
            &session,
            &block,
            "write",
            json!({"data":format!("tick {count} {every}\r")}),
        )
        .await?;
    tokio::time::sleep(Duration::from_millis(400)).await;
    // A late joiner while output flows: stream (snapshot at T0) and `format vt` (at T1).
    let late = Control::connect(&server.socket, "late-joiner", None).await?;
    late.call("session.attach", json!({"session_id":session}))
        .await?;
    let mut data = stream(&late, &server.socket, &session, &block).await?;
    let delay: u64 = std::env::var("FORMAT_DELAY_MS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    tokio::time::sleep(Duration::from_millis(delay)).await;
    let vt = late
        .terminal(&session, &block, "format", json!({"format":"vt"}))
        .await?;
    proof!(
        "q4",
        "format vt requested {delay} ms after the stream's WELCOME"
    );
    let mut splitter = Splitter::new(data.nonce);
    let (mut snapshot, mut program, mut messages) = (Vec::new(), Vec::new(), Vec::new());
    let deadline = Instant::now() + Duration::from_secs(2);
    while Instant::now() < deadline {
        let Ok(Some(bytes)) = tokio::time::timeout(Duration::from_millis(200), data.next()).await
        else {
            continue;
        };
        for piece in splitter.push(&bytes) {
            match piece {
                Piece::Snapshot(b) => snapshot.extend(b),
                Piece::Program(b) => program.extend(b),
                Piece::Rex(m) => messages.push(m),
            }
        }
    }
    std::fs::write(scratch.join("snapshot.bin"), &snapshot)?;
    proof!(
        "q4",
        "snapshot: {} B, magic {:?}, header {:02x?}; first Rex messages {:?}",
        snapshot.len(),
        String::from_utf8_lossy(&snapshot[..8.min(snapshot.len())]),
        &snapshot[8..24.min(snapshot.len())],
        messages.iter().take(2).collect::<Vec<_>>()
    );
    let ticks_in_snapshot = String::from_utf8_lossy(&snapshot).matches("tick ").count();
    proof!(
        "q4",
        "snapshot holds ticks as plain text: {ticks_in_snapshot} occurrences of \"tick \" (cell data, not VT)"
    );
    // Splice: format vt then live program bytes, into the same vt100 roundup's mirror uses.
    let vt_text = vt["content"].as_str().unwrap_or_default();
    let mut parser = vt100::Parser::new(24, 80, 1000);
    parser.process(vt_text.as_bytes());
    parser.process(&program);
    let spliced: Vec<u32> = all_ticks(&parser);
    let dupes = spliced.windows(2).filter(|w| w[1] <= w[0]).count();
    let holes = spliced.windows(2).filter(|w| w[1] > w[0] + 1).count();
    let nums = |t: &str| {
        t.lines()
            .filter_map(|l| {
                l.trim()
                    .strip_prefix("tick ")
                    .and_then(|n| n.get(..5))
                    .and_then(|n| n.parse::<u32>().ok())
            })
            .collect::<Vec<_>>()
    };
    let (vt_ticks, live_ticks) = (nums(vt_text), nums(&String::from_utf8_lossy(&program)));
    proof!(
        "q4",
        "format vt ticks {:?}..{:?}; live stream ticks {:?}..{:?}; overlap={}",
        vt_ticks.first(),
        vt_ticks.last(),
        live_ticks.first(),
        live_ticks.last(),
        vt_ticks.iter().filter(|t| live_ticks.contains(t)).count()
    );
    proof!(
        "q4",
        "format vt + live bytes: ticks {:?}..{:?}, repeated={dupes}, missing={holes} (vt has {} ticks, live has {})",
        spliced.first(),
        spliced.last(),
        vt_text.matches("tick ").count(),
        String::from_utf8_lossy(&program).matches("tick ").count()
    );
    // RESUME: drop the connection without a close frame, keep counting, resume.
    let (token, received, nonce) = (data.token, data.received, data.nonce);
    drop(data);
    tokio::time::sleep(Duration::from_millis(600)).await;
    let mut resumed = Data::resume(&server.socket, token, received).await?;
    proof!(
        "q4",
        "RESUME after 600 ms away: welcome nonce same={} keep_ms={}",
        resumed.nonce == nonce,
        resumed.keep_ms
    );
    let mut after = Vec::new();
    let mut ignore = Vec::new();
    drain(
        &mut resumed,
        &mut splitter,
        &mut after,
        &mut ignore,
        &format!("tick {count:05}"),
        Duration::from_secs(5),
    )
    .await;
    let mut both = program.clone();
    both.extend(&after);
    let ticks: Vec<u32> = String::from_utf8_lossy(&both)
        .lines()
        .filter_map(|l| l.trim().strip_prefix("tick ").and_then(|n| n.parse().ok()))
        .collect();
    let gaps = ticks.windows(2).filter(|w| w[1] != w[0] + 1).count();
    proof!(
        "q4",
        "live + resumed program bytes: ticks {:?}..{:?}, gaps or repeats={gaps}",
        ticks.first(),
        ticks.last()
    );
    resumed.end().await;
    let _ = control
        .call("session.destroy", json!({"session_id":session}))
        .await;
    late.close().await;
    control.close().await;
    Ok(())
}

pub(crate) fn all_ticks(parser: &vt100::Parser) -> Vec<u32> {
    let mut parser = parser.clone();
    let mut rows = Vec::new();
    let screen = parser.screen_mut();
    screen.set_scrollback(usize::MAX);
    let back = screen.scrollback();
    for offset in (0..=back).rev() {
        parser.screen_mut().set_scrollback(offset);
        let top = parser.screen().rows(0, 80).next().unwrap_or_default();
        rows.push(top);
    }
    rows.extend(parser.screen().rows(0, 80).skip(1));
    rows.iter()
        .filter_map(|l| l.trim().strip_prefix("tick ").and_then(|n| n.parse().ok()))
        .collect()
}
