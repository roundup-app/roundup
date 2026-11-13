use super::*;

/// What a reattached Terminal's record needs that the core does not hold.
pub struct Adopted {
    pub cwd: String,
    pub cols: u16,
    pub rows: u16,
    pub program: String,
    /// The Machine the Terminal runs on; `None` is this Mac.
    pub machine: Option<String>,
}

impl Terminals {
    /// Forget `owner`'s oldest exited Terminal when it holds [`OWNED_CAP`]; true when one went.
    pub(super) fn evict_for_cap(&self, owner: &str) -> Result<bool, Error> {
        let mut table = self.shared.table()?;
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
            None => Err(Error::conflict(format!(
                "{owner} already runs {OWNED_CAP} terminals"
            ))),
        }
    }

    /// MC12: every Terminal starts through the core: `terminal.run`, then an attach whose stream
    /// feeds the output, screen and status records on a thread of its own.
    pub(super) async fn start(
        &self,
        params: SpawnParams,
        owner: Option<String>,
        labels: Option<Value>,
    ) -> Result<Spawned, Error> {
        check_program(&params)?;
        window(params.cols, params.rows)?;
        let conn = match &params.machine {
            // The core of a Machine checks the cwd itself and answers `spawn_failed`.
            Some(machine) => {
                remote::check_machine(machine)?;
                self.remotes.conn(machine).await?
            }
            None => {
                if !Path::new(&params.cwd).is_dir() {
                    return Err(invalid(format!("cwd is not a directory: {}", params.cwd)));
                }
                self.core().await?
            }
        };
        let number = self.next.fetch_add(1, Ordering::Relaxed);
        // MC52: the core's list is read first; an Agent's one live program is attached, never
        // started a second time.
        if let Some(address) = self.live_program(&conn, labels.as_ref()).await {
            let pid = conn
                .call("terminal.get", serde_json::json!({"terminal": address}))
                .await
                .ok()
                .and_then(|got| got.get("pid").and_then(Value::as_u64))
                .and_then(|pid| u32::try_from(pid).ok());
            let adopted = Adopted {
                cwd: params.cwd,
                cols: params.cols,
                rows: params.rows,
                program: program_name(params.command.as_deref()),
                machine: params.machine,
            };
            return self.adopt(conn, address, pid, adopted, owner, number).await;
        }
        let ran = host::run(&conn, &self.shared, &params, number, labels.as_ref()).await?;
        let core_id = ran
            .get("address")
            .and_then(Value::as_str)
            .ok_or_else(|| Error::internal("terminal.run answered no address"))?
            .to_owned();
        let pid = ran
            .get("pid")
            .and_then(Value::as_u64)
            .and_then(|pid| u32::try_from(pid).ok());
        self.adopt(
            conn,
            core_id,
            pid,
            Adopted {
                cwd: params.cwd,
                cols: params.cols,
                rows: params.rows,
                program: program_name(params.command.as_deref()),
                machine: params.machine,
            },
            owner,
            number,
        )
        .await
    }

    /// The live program the core already holds for the Agent `labels` name, after ending its idle
    /// extras; `None` for no labels, no program, or a list that cannot be read (the start goes on).
    async fn live_program(&self, conn: &herdr::Conn, labels: Option<&Value>) -> Option<String> {
        let label = |key: &str| labels?.get(key)?.as_str();
        let (project, agent) = (
            label(crate::reconcile::PROJECT)?,
            label(crate::reconcile::AGENT)?,
        );
        crate::reconcile::for_agent(conn, project, agent)
            .await
            .ok()
            .flatten()
    }

    /// A12a: the core's id for Terminal `id` and what a reattach needs, or `None` for a Terminal
    /// that has ended.
    pub fn core_record(&self, id: &str) -> Result<Option<(String, Adopted)>, Error> {
        let Ok(number) = id.parse::<u64>() else {
            return Ok(None);
        };
        let table = self.shared.table()?;
        let Some(entry) = table.get(&number) else {
            return Ok(None);
        };
        let Some(handle) = &entry.handle else {
            return Ok(None);
        };
        let screen = entry.screen.locked("screen")?;
        Ok(Some((
            handle.core_id.clone(),
            Adopted {
                cwd: entry.info.cwd.clone(),
                cols: screen.cols,
                rows: screen.rows,
                program: entry.info.program.clone(),
                machine: handle.machine.clone(),
            },
        )))
    }

    /// Reattach Terminal `core_id`, which the core kept across the Daemon: attach it again, with
    /// no launch and no input. A terminal the core no longer holds, or whose program has ended,
    /// is the caller's error, and its Agent stays `done` (A8).
    pub async fn reattach(
        &self,
        core_id: &str,
        adopted: Adopted,
        owner: Option<String>,
    ) -> Result<Spawned, Error> {
        window(adopted.cols, adopted.rows)?;
        let conn = match &adopted.machine {
            Some(machine) => {
                remote::check_machine(machine)?;
                self.remotes.conn(machine).await?
            }
            None => self.core().await?,
        };
        let got = conn
            .call("terminal.get", serde_json::json!({"terminal": core_id}))
            .await
            .map_err(|err| Error::not_found(format!("terminal {core_id}: {err}")))?;
        if got.get("state").and_then(Value::as_str) != Some("live") {
            return Err(Error::not_found(format!("terminal {core_id} is not live")));
        }
        let pid = got
            .get("pid")
            .and_then(Value::as_u64)
            .and_then(|pid| u32::try_from(pid).ok());
        let number = self.next.fetch_add(1, Ordering::Relaxed);
        self.adopt(conn, core_id.to_owned(), pid, adopted, owner, number)
            .await
    }

    /// Attach `core_id` and publish its stream as Terminal `number`.
    async fn adopt(
        &self,
        conn: Arc<herdr::Conn>,
        core_id: String,
        pid: Option<u32>,
        adopted: Adopted,
        owner: Option<String>,
        number: u64,
    ) -> Result<Spawned, Error> {
        let mut nonce = [0u8; 32];
        getrandom::fill(&mut nonce).map_err(Error::internal)?;
        let incarnation = nonce.iter().map(|byte| format!("{byte:02x}")).collect();
        let params = adopted;
        let stream = conn
            .attach(
                &core_id,
                params.cols,
                params.rows,
                SNAPSHOT_SCROLLBACK as u32,
            )
            .await
            .map_err(Error::internal)?;
        let link = Arc::new(Mutex::new(Link {
            conn: Arc::clone(&conn),
            tx: stream.sender(),
        }));
        let writer: Box<dyn Write + Send> = Box::new(host::StreamWriter(Arc::clone(&link)));
        let writer = match &self.input_writer {
            Some(adapt) => adapt(writer),
            None => writer,
        };
        let screen = Arc::new(Mutex::new(ScreenState::new(params.cols, params.rows)));
        let (ended, program_ended) = watch::channel(false);
        let (output, output_receiver) = broadcast::channel(OUTPUT_BACKLOG);
        let (input, queued) = mpsc::sync_channel(WRITE_BACKLOG);
        let recorder = Arc::new(OnceLock::new());
        let machine = params.machine;
        let handle = Arc::new(Handle {
            link: Arc::clone(&link),
            core_id: core_id.clone(),
            machine: machine.clone(),
            input,
            ended: program_ended.clone(),
            recorder,
        });
        let (sender, events) = broadcast::channel(EVENT_BACKLOG);
        self.shared
            .program_ends
            .locked("terminal program ends lock")?
            .insert(number, program_ended);
        self.shared.table()?.insert(
            number,
            Entry {
                pid,
                info: TerminalInfo {
                    program_pid: pid,
                    id: number.to_string(),
                    incarnation,
                    cwd: params.cwd,
                    title: None,
                    program: params.program,
                    running: true,
                    exit_code: None,
                    owner,
                    status: None,
                },
                events: sender,
                output: Some(output.clone()),
                handle: Some(Arc::clone(&handle)),
                screen: Arc::clone(&screen),
            },
        );
        let input_clock = Arc::clone(&self.shared.clock);
        std::thread::Builder::new()
            .name(format!("terminal-{number}-input"))
            .spawn(move || stream::type_queued(number, queued, writer, input_clock))
            .map_err(Error::internal)?;
        let shared = Arc::clone(&self.shared);
        let exit_hold = self.exit_hold.clone();
        let runtime = tokio::runtime::Handle::current();
        // MC14: a Machine's Terminal finds its channel again when the ssh to it is lost.
        let relink = machine.map(|machine| {
            remote::relink(
                Arc::clone(&self.remotes),
                machine,
                core_id.clone(),
                Arc::clone(&link),
                Arc::clone(&screen),
                runtime.clone(),
            )
        });
        std::thread::Builder::new()
            .name(format!("terminal-{number}"))
            .spawn(move || {
                let closed = host::feed(
                    &shared,
                    number,
                    stream,
                    relink,
                    runtime.clone(),
                    &screen,
                    &output,
                );
                let code = match closed {
                    Ok(Some(code)) => Some(code),
                    Ok(None) => {
                        let conn = link.lock().map_or(conn, |link| Arc::clone(&link.conn));
                        runtime.block_on(host::finished_code(
                            &conn,
                            &core_id,
                            Duration::from_millis(100),
                        ))
                    }
                    Err(err) => {
                        eprintln!("terminal {number}: output stopped: {err}");
                        Some(i32::MAX)
                    }
                };
                ended.send_replace(true);
                if let Ok(mut ends) = shared.program_ends.locked("terminal program ends lock") {
                    ends.remove(&number);
                }
                if let Some(hold) = exit_hold {
                    hold();
                }
                drop(output);
                stopped(number, "exit not published", shared.finish(number, code));
            })
            .map_err(Error::internal)?;
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
pub(super) fn check_program(params: &SpawnParams) -> Result<(), Error> {
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

/// U6144b: variables other terminals set that a program reads as that terminal's features.
pub(super) const OTHER_TERMINALS: &[&str] = &[
    // Owner decision 2026-11-06: Claude Code's Kitty placeholders break in this emulator.
    "CLAUDE_CODE_FORCE_TERMINAL_IMAGES",
    "TERM_PROGRAM",
    "TERM_PROGRAM_VERSION",
    "TERM_SESSION_ID",
    "TERMINFO",
    "TERMINAL_EMULATOR",
    "GHOSTTY_RESOURCES_DIR",
    "GHOSTTY_BIN_DIR",
    "GHOSTTY_SHELL_FEATURES",
    "KITTY_WINDOW_ID",
    "KITTY_PID",
    "KITTY_INSTALLATION_DIR",
    "KITTY_PUBLIC_KEY",
    "WEZTERM_EXECUTABLE",
    "WEZTERM_PANE",
    "WEZTERM_UNIX_SOCKET",
    "ITERM_SESSION_ID",
    "ITERM_PROFILE",
    "LC_TERMINAL",
    "LC_TERMINAL_VERSION",
    "VTE_VERSION",
    "KONSOLE_VERSION",
    "KONSOLE_DBUS_SESSION",
    "KONSOLE_DBUS_SERVICE",
    "WT_SESSION",
    "WT_PROFILE_ID",
    "ALACRITTY_LOG",
    "ALACRITTY_SOCKET",
    "ALACRITTY_WINDOW_ID",
    "WARP_IS_LOCAL_SHELL_SESSION",
    "TMUX",
    "TMUX_PANE",
    "STY",
];
