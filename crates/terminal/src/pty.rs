use super::*;

/// The error a writer returns to end the input thread without reporting the running effect's
/// result, so its caller sees a lost result (UNKNOWN_OUTCOME).
#[derive(Debug)]
pub struct InputEnded;

impl std::fmt::Display for InputEnded {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("input ended")
    }
}

impl std::error::Error for InputEnded {}

/// Remembers whether the writer returned `InputEnded`.
struct EndWatch<'a> {
    inner: &'a mut dyn Write,
    ended: bool,
}

impl EndWatch<'_> {
    fn watch<T>(&mut self, result: std::io::Result<T>) -> std::io::Result<T> {
        if let Err(err) = &result {
            self.ended |= err.get_ref().is_some_and(|inner| inner.is::<InputEnded>());
        }
        result
    }
}

impl Write for EndWatch<'_> {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        let result = self.inner.write(bytes);
        self.watch(result)
    }

    fn flush(&mut self) -> std::io::Result<()> {
        let result = self.inner.flush();
        self.watch(result)
    }
}

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
                    match sample.locked("sample lock") {
                        Ok(mut sample) => sample.written = written,
                        Err(err) => {
                            eprintln!("terminal {number}: input stopped: {err}");
                            return;
                        }
                    }
                }
            }
            Input::Effect(effect, completed) => {
                if !completed.is_closed() {
                    let mut watch = EndWatch {
                        inner: &mut *writer,
                        ended: false,
                    };
                    let result = effect(&mut watch);
                    if watch.ended {
                        return;
                    }
                    let _ = completed.send(result);
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
) -> Result<(), Error> {
    let mut chunk = [0u8; READ_CHUNK];
    // Linux reports the closed PTY as an error, macOS as end of file: both mean "no more output".
    while let Ok(read) = reader.read(&mut chunk) {
        if read == 0 {
            break;
        }
        let data = within(&chunk, ..read);
        if let Some(recorder) = handle.recorder.get() {
            let at = (shared.clock)();
            recorder.locked("recorder lock")?.read(data, at)?;
        }
        let (seen, reported) = {
            let mut state = screen.locked("terminal screen lock")?;
            let offset = state.after;
            // U6144a: the parser reads the chunk up to each Kitty query's end, so every reply keeps
            // the order the program wrote its queries in.
            let mut kitty = Vec::new();
            state.kitty.feed(data, &mut kitty);
            let parsed = state.ensure_parser().map(|parser| {
                catch_unwind(AssertUnwindSafe(|| {
                    let mut seen = Seen::default();
                    let mut from = 0;
                    for &(end, request) in &kitty {
                        parser.process(within(data, from..end));
                        from = end;
                        let mut part = std::mem::take(parser.callbacks_mut());
                        seen.titles.append(&mut part.titles);
                        seen.requests.append(&mut part.requests);
                        seen.requests.push(request);
                    }
                    parser.process(within(data, from..));
                    let mut part = std::mem::take(parser.callbacks_mut());
                    seen.titles.append(&mut part.titles);
                    seen.requests.append(&mut part.requests);
                    seen
                }))
            });
            let reported = state.status.feed(data, (shared.clock)());
            state.after += read as u64;
            state.log.push(data);
            // Sent under the lock so a snapshot's `after` and a subscription's start never straddle a chunk.
            let _ = output.send(Chunk {
                offset,
                bytes: Arc::from(data),
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
                    only_queries(&kitty)
                }
                None => only_queries(&kitty),
            };
            (seen, reported)
        };
        if shared.answer_status_query.load(Ordering::Relaxed) && !reported.reply.is_empty() {
            shared.type_into(number, reported.reply);
        }
        for records in reported.changes {
            shared.changed(number, records);
        }
        shared.answer(number, &seen.requests);
        seen.titles
            .into_iter()
            .try_for_each(|title| shared.retitle(number, title))?;
    }
    Ok(())
}

/// What a chunk asked when no screen parser reads it: the Kitty queries alone.
fn only_queries(kitty: &[(usize, scheme::Request)]) -> Seen {
    Seen {
        requests: kitty.iter().map(|(_, request)| *request).collect(),
        ..Seen::default()
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
    stopped(
        number,
        "output stopped",
        read(shared, number, reader, handle, screen, &output),
    );
    let code = program::exit_code(number, reap(&handle.program));
    if let Some(hold) = exit_hold {
        hold();
    }
    drop(output);
    stopped(number, "exit not published", shared.finish(number, code));
}

impl Shared {
    /// X17: queue `bytes` for the program of Terminal `number`; a program that no longer reads is told on stderr.
    pub(super) fn type_into(&self, number: u64, bytes: Vec<u8>) {
        let handle = match self.table() {
            Ok(table) => table.get(&number).and_then(|entry| entry.handle.clone()),
            Err(err) => {
                eprintln!("terminal {number}: reply dropped: {err}");
                return;
            }
        };
        if let Some(handle) = handle
            && let Err(err) = handle.input.try_send(Input::Bytes(bytes, Vec::new()))
        {
            eprintln!("terminal {number}: scheme reply dropped: {err}");
        }
    }

    /// X17: one reply per query, in the order asked; all but XTVERSION wait for the scheme the App last set.
    pub(super) fn answer(&self, number: u64, requests: &[scheme::Request]) {
        let palette = match self.scheme.locked("terminal scheme lock") {
            Ok(palette) => *palette,
            Err(err) => {
                eprintln!("terminal {number}: replies dropped: {err}");
                return;
            }
        };
        let replies: Vec<u8> = requests
            .iter()
            .filter_map(|request| match request {
                scheme::Request::Ask(scheme::Query::Version) => Some(scheme::version()),
                scheme::Request::Ask(query) => palette.map(|palette| palette.answer(*query)),
                scheme::Request::Notices(_) => None,
                scheme::Request::Kitty(id) => Some(scheme::kitty_ok(*id)),
            })
            .flatten()
            .collect();
        if !replies.is_empty() {
            self.type_into(number, replies);
        }
    }
}
