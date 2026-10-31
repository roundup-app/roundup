use super::*;

/// Feed queued writes to the PTY. It blocks on a program that does not read, which is why it has a
/// thread of its own instead of one from the pool `kill` also needs.
pub(super) fn type_queued(
    number: u64,
    queued: mpsc::Receiver<Input>,
    mut writer: Box<dyn Write + Send>,
    clock: Arc<dyn Fn() -> f64 + Send + Sync>,
) {
    for input in queued {
        match input {
            Input::Bytes(bytes, samples) => {
                if let Err(err) = writer.write_all(&bytes).and_then(|()| writer.flush()) {
                    eprintln!("terminal {number}: input stopped: {err}");
                    return;
                }
                let written = if samples.is_empty() {
                    None
                } else {
                    Some(clock())
                };
                for sample in samples {
                    let mut sample = sample.lock().expect("sample lock");
                    sample.written = written;
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

/// Read until the PTY closes, publishing every chunk before the reader reports the exit.
pub(super) fn read(
    shared: &Shared,
    number: u64,
    mut reader: Box<dyn Read + Send>,
    handle: &Handle,
    screen: &Mutex<ScreenState>,
    output: &broadcast::Sender<Chunk>,
) {
    let mut chunk = [0u8; READ_CHUNK];
    // Linux reports the closed PTY as an error, macOS as end of file: both mean "no more output".
    while let Ok(read) = reader.read(&mut chunk) {
        if read == 0 {
            break;
        }
        if let Some(recorder) = handle.recorder.get() {
            let at = (shared.clock)();
            recorder
                .lock()
                .expect("recorder lock")
                .read(&chunk[..read], at);
        }
        let (seen, reported) = {
            let mut state = screen.lock().expect("terminal screen lock");
            let offset = state.after;
            let parsed = state.ensure_parser().map(|parser| {
                catch_unwind(AssertUnwindSafe(|| {
                    parser.process(&chunk[..read]);
                    std::mem::take(parser.callbacks_mut())
                }))
            });
            let reported = state.status.feed(&chunk[..read], (shared.clock)());
            state.after += read as u64;
            state.log.push(&chunk[..read]);
            // Sent under the lock so a snapshot's `after` and a subscription's start never straddle a chunk.
            let _ = output.send(Chunk {
                offset,
                bytes: Arc::from(&chunk[..read]),
            });
            let seen = match parsed {
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
            };
            (seen, reported)
        };
        if !reported.reply.is_empty() {
            shared.type_into(number, reported.reply);
        }
        for records in reported.changes {
            shared.changed(number, records);
        }
        shared.answer(number, &seen.requests);
        seen.titles
            .into_iter()
            .for_each(|title| shared.retitle(number, title));
    }
}

/// Exercise the same PTY reader and exit publication with an in-process observer's child.
#[cfg(test)]
pub(super) fn pump(
    shared: &Shared,
    number: u64,
    reader: Box<dyn Read + Send>,
    handle: &Handle,
    screen: &Mutex<ScreenState>,
    output: broadcast::Sender<Chunk>,
    exit_hold: Option<&ExitHold>,
) {
    read(shared, number, reader, handle, screen, &output);
    let code = program::exit_code(number, reap(&handle.program));
    if let Some(hold) = exit_hold {
        hold();
    }
    drop(output);
    shared.finish(number, code);
}

impl Shared {
    /// X17: queue `bytes` for the program of Terminal `number`; a program that no longer reads is told on stderr.
    fn type_into(&self, number: u64, bytes: Vec<u8>) {
        let handle = self
            .table()
            .get(&number)
            .and_then(|entry| entry.handle.clone());
        if let Some(handle) = handle
            && let Err(err) = handle.input.try_send(Input::Bytes(bytes, Vec::new()))
        {
            eprintln!("terminal {number}: scheme reply dropped: {err}");
        }
    }

    /// X17: one reply per query, in the order asked, from the scheme the App last set.
    fn answer(&self, number: u64, requests: &[scheme::Request]) {
        let Some(palette) = *self.scheme.lock().expect("terminal scheme lock") else {
            return;
        };
        let replies: Vec<u8> = requests
            .iter()
            .filter_map(|request| match request {
                scheme::Request::Ask(query) => Some(palette.answer(*query)),
                scheme::Request::Notices(_) => None,
            })
            .flatten()
            .collect();
        if !replies.is_empty() {
            self.type_into(number, replies);
        }
    }
}
