use super::*;

impl Terminals {
    /// Forget `owner`'s oldest exited Terminal when it holds [`OWNED_CAP`]; true when one went.
    pub(super) fn make_room(&self, owner: &str) -> Result<bool, RpcError> {
        if self.owner_helper.is_some() {
            return self.make_remote_space(owner);
        }
        let mut table = self.shared.table();
        let parked: Vec<(u64, bool)> = table
            .iter()
            .filter(|(_, entry)| entry.info.owner.as_deref() == Some(owner))
            .map(|(number, entry)| (*number, entry.handle.is_none()))
            .collect();
        if parked.len() < OWNED_CAP {
            return Ok(false);
        }
        let oldest_exited = parked
            .iter()
            .find(|(_, exited)| *exited)
            .map(|(number, _)| *number);
        match oldest_exited {
            Some(number) => {
                table.remove(&number);
                self.shared.changed(number, Vec::new());
                Ok(true)
            }
            None => Err(RpcError::conflict(format!(
                "{owner} already runs {OWNED_CAP} terminals"
            ))),
        }
    }

    pub(super) async fn start(
        &self,
        params: SpawnParams,
        owner: Option<String>,
    ) -> Result<Spawned, RpcError> {
        if let Some(helper) = &self.owner_helper {
            return self.start_owner(helper, params, owner).await;
        }
        check_program(&params)?;
        // portable-pty silently falls back to $HOME when the cwd is unusable; refuse instead.
        if !Path::new(&params.cwd).is_dir() {
            return Err(invalid(format!("cwd is not a directory: {}", params.cwd)));
        }
        // Generate independently of authentication and vendor content; failure starts no program.
        let mut nonce = [0u8; 32];
        getrandom::fill(&mut nonce).map_err(RpcError::internal)?;
        let incarnation = nonce.iter().map(|byte| format!("{byte:02x}")).collect();
        let pair = native_pty_system()
            .openpty(window(params.cols, params.rows)?)
            .map_err(RpcError::internal)?;
        let number = self.next.fetch_add(1, Ordering::Relaxed);
        let mut command = match &params.command {
            Some(argv) => CommandBuilder::from_argv(argv.iter().map(Into::into).collect()),
            None => CommandBuilder::new_default_prog(),
        };
        command.cwd(&params.cwd);
        for (name, value) in &params.env {
            command.env(name, value);
        }
        // Last, so none of them survive even if a caller passed one in `params.env`.
        for marker in &self.shared.clean_env {
            command.env_remove(marker);
        }
        // SK7.2: `rup skill report` writes only where this is set; a caller's value never stands.
        command.env("ROUNDUP_TERMINAL", number.to_string());
        // All three threads start before the program, so a thread-creation failure leaves no
        // program behind. The reaper observes completion independently of PTY EOF.
        let reader = pair.master.try_clone_reader().map_err(RpcError::internal)?;
        let writer = pair.master.take_writer().map_err(RpcError::internal)?;
        let writer = match &self.input_writer {
            Some(adapt) => adapt(writer),
            None => writer,
        };
        let snapshot_available = screen::snapshot_size_supported(params.cols, params.rows);
        let scrollback = if snapshot_available {
            SNAPSHOT_SCROLLBACK.min(SNAPSHOT_MAX_HISTORY_CELLS / usize::from(params.cols))
        } else {
            0
        };
        let screen = Arc::new(Mutex::new(ScreenState {
            parser: ScreenParser::Pending,
            after: 0,
            log: output::Log::default(),
            cursors: Default::default(),
            snapshot_available,
            scrollback_rows: scrollback,
            cols: params.cols,
            rows: params.rows,
            scheme_notices: false,
            status: Default::default(),
        }));
        let (program_arrival, program_arrives) = mpsc::channel::<Program>();
        let (reaped, completion) = mpsc::channel();
        let (ended, program_ended) = watch::channel(false);
        let program_shared = Arc::clone(&self.shared);
        std::thread::Builder::new()
            .name(format!("terminal-{number}-reap"))
            .spawn(move || {
                if let Ok(program) = program_arrives.recv() {
                    let code = program::exit_code(number, reap(&program));
                    ended.send_replace(true);
                    program_shared
                        .program_ends
                        .lock()
                        .expect("terminal program ends lock")
                        .remove(&number);
                    let _ = reaped.send(code);
                }
            })
            .map_err(RpcError::internal)?;
        let (arrival, child_arrives) = mpsc::channel::<Arc<Handle>>();
        let (output, output_receiver) = broadcast::channel(OUTPUT_BACKLOG);
        let pump_output = output.clone();
        let shared = Arc::clone(&self.shared);
        let reader_screen = Arc::clone(&screen);
        let exit_hold = self.exit_hold.clone();
        let recorder = Arc::new(OnceLock::new());
        std::thread::Builder::new()
            .name(format!("terminal-{number}"))
            .spawn(move || {
                // No child means the program never started: nothing to report.
                if let Ok(handle) = child_arrives.recv() {
                    pty::read(
                        &shared,
                        number,
                        reader,
                        &handle,
                        &reader_screen,
                        &pump_output,
                    );
                    let code = completion
                        .recv()
                        .expect("the reaper reports program completion");
                    if let Some(hold) = exit_hold {
                        hold();
                    }
                    drop(pump_output);
                    shared.finish(number, code);
                }
            })
            .map_err(RpcError::internal)?;
        let (input, queued) = mpsc::sync_channel(WRITE_BACKLOG);
        let input_clock = Arc::clone(&self.shared.clock);
        std::thread::Builder::new()
            .name(format!("terminal-{number}-input"))
            .spawn(move || pty::type_queued(number, queued, writer, input_clock))
            .map_err(RpcError::internal)?;
        let argv0 = params
            .command
            .as_deref()
            .and_then(<[String]>::first)
            .map(String::as_str);
        let program: Program = Arc::new(Mutex::new(
            pair.slave
                .spawn_command(command)
                .map_err(|err| spawn_error(argv0, &err))?,
        ));
        // Only the program may hold the slave end, or reading never sees it close.
        drop(pair.slave);
        let pid = program.lock().expect("program lock").process_id();
        let handle = Arc::new(Handle {
            input,
            program: Arc::clone(&program),
            master: Mutex::new(pair.master),
            recorder,
        });

        let (sender, events) = broadcast::channel(EVENT_BACKLOG);
        // Install the wait registration before list can expose this Terminal.
        self.shared
            .program_ends
            .lock()
            .expect("terminal program ends lock")
            .insert(number, program_ended);
        self.shared.table().insert(
            number,
            Entry {
                pid,
                info: TerminalInfo {
                    program_pid: pid,
                    id: number.to_string(),
                    incarnation,
                    cwd: params.cwd,
                    title: None,
                    program: program_name(params.command.as_deref()),
                    running: true,
                    exit_code: None,
                    owner,
                    status: None,
                },
                events: sender,
                output: Some(output.clone()),
                handle: Some(Arc::clone(&handle)),
                screen,
            },
        );
        assert!(
            program_arrival.send(program).is_ok(),
            "the reaper thread waits for its program"
        );
        assert!(
            arrival.send(handle).is_ok(),
            "the reader thread waits for its child"
        );
        Ok(Spawned {
            id: number.to_string(),
            events,
            output: OutputStream {
                receiver: output_receiver,
                next: 0,
                after_gap: None,
            },
        })
    }
}

/// What the OS would refuse at exec time, caught here so it is the caller's error with a short message.
fn check_program(params: &SpawnParams) -> Result<(), RpcError> {
    let argv = params.command.as_deref().unwrap_or_default();
    if params.command.is_some() && argv.first().is_none_or(String::is_empty) {
        return Err(invalid("command must start with a program name"));
    }
    let env = params.env.iter().flat_map(|(name, value)| [name, value]);
    if argv.iter().chain(env).any(|text| text.contains('\0')) {
        return Err(invalid("command and env must not contain NUL"));
    }
    if params
        .env
        .keys()
        .any(|name| name.is_empty() || name.contains('='))
    {
        return Err(invalid("env names must be non-empty and contain no '='"));
    }
    Ok(())
}

/// portable-pty reports an argv[0] it cannot find or run as text that can quote the Daemon's `PATH`;
/// that is the caller's error and must not leak `PATH`. Any other failure to start is the Daemon's.
fn spawn_error(program: Option<&str>, err: &impl std::fmt::Display) -> RpcError {
    match program {
        Some(program) if err.to_string().starts_with("Unable to spawn ") => {
            invalid(format!("cannot run {program}"))
        }
        _ => RpcError::internal(err),
    }
}

/// The basename of the program's argv0, else of `$SHELL`, else `terminal`.
fn program_name(command: Option<&[String]>) -> String {
    let shell = std::env::var("SHELL").ok();
    let path = command.and_then(<[String]>::first).or(shell.as_ref());

    path.and_then(|path| Path::new(path).file_name())
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or("terminal")
        .to_string()
}
