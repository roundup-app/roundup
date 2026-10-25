use super::*;

/// Feed queued writes to the PTY. It blocks on a program that does not read, which is why it has a
/// thread of its own instead of one from the pool `kill` also needs.
pub(super) fn type_queued(
    number: u64,
    queued: mpsc::Receiver<Input>,
    mut writer: Box<dyn Write + Send>,
) {
    for input in queued {
        match input {
            Input::Bytes(bytes) => {
                if let Err(err) = writer.write_all(&bytes).and_then(|()| writer.flush()) {
                    eprintln!("terminal {number}: input stopped: {err}");
                    return;
                }
            }
            Input::Effect(effect, completed) => {
                if !completed.is_closed() {
                    let _ = completed.send(effect(&mut *writer));
                }
            }
        }
    }
}

/// Wait for the program to end without holding the lock while it runs, so `kill` can take it.
pub(super) fn reap(program: &Program) -> std::io::Result<portable_pty::ExitStatus> {
    loop {
        let status = program.lock().expect("terminal program lock").try_wait()?;
        match status {
            Some(status) => return Ok(status),
            None => std::thread::sleep(REAP_POLL),
        }
    }
}

/// Read until the program closes the PTY, publishing each chunk, then report how it ended.
pub(super) fn pump(
    shared: &Shared,
    number: u64,
    mut reader: Box<dyn Read + Send>,
    program: &Program,
    screen: &Mutex<ScreenState>,
    output: broadcast::Sender<Chunk>,
    exit_hold: Option<&ExitHold>,
) {
    let mut chunk = [0u8; READ_CHUNK];
    // Linux reports the closed PTY as an error, macOS as end of file: both mean "no more output".
    while let Ok(read) = reader.read(&mut chunk) {
        if read == 0 {
            break;
        }
        let seen = {
            let mut state = screen.lock().expect("terminal screen lock");
            let offset = state.after;
            let parsed = state.ensure_parser().map(|parser| {
                catch_unwind(AssertUnwindSafe(|| {
                    parser.process(&chunk[..read]);
                    std::mem::take(parser.callbacks_mut())
                }))
            });
            state.after += read as u64;
            state.log.push(&chunk[..read]);
            // Sent under the lock so a snapshot's `after` and a subscription's start never straddle a chunk.
            let _ = output.send(Chunk {
                offset,
                bytes: Arc::from(&chunk[..read]),
            });
            match parsed {
                Some(Ok(seen)) => {
                    for request in &seen.requests {
                        if let scheme::Request::Notices(on) = request {
                            state.scheme_notices = *on;
                        }
                    }
                    seen
                }
                Some(Err(_)) => {
                    eprintln!("terminal {number}: screen parser panicked; snapshots are off");
                    state.parser = ScreenParser::Failed;
                    Seen::default()
                }
                None => Seen::default(),
            }
        };
        shared.answer(number, &seen.requests);
        seen.titles
            .into_iter()
            .for_each(|title| shared.retitle(number, title));
    }
    let code = match reap(program) {
        Ok(status) if status.signal().is_some() => None,
        Ok(status) => Some(i32::try_from(status.exit_code()).unwrap_or(i32::MAX)),
        Err(err) => {
            // `None` means "killed by a signal"; an unknown ending must not look like one.
            eprintln!("terminal {number}: cannot wait for program: {err}");
            Some(-1)
        }
    };
    if let Some(hold) = exit_hold {
        hold();
    }
    drop(output);
    shared.finish(number, code);
}
