use super::*;
use std::path::PathBuf;

/// Every environment variable the Daemon reads, read once at startup. An unset variable is
/// `None`, so `Observers::default()` is the production Daemon with no observer attached.
#[derive(Clone, Default)]
pub struct Observers {
    pub(crate) home: Option<PathBuf>,
    pub(crate) messages_clock: Option<PathBuf>,
    pub(crate) messages_fault: Option<String>,
    pub(crate) messages_observer: Option<PathBuf>,
    pub(crate) messages_fault_file: Option<PathBuf>,
    pub(crate) order_effect_gate: Option<PathBuf>,
    pub(crate) resume_effect_gate: Option<PathBuf>,
    pub(crate) overview_read_gate: Option<PathBuf>,
    pub(crate) terminal_exit_gate: Option<PathBuf>,
    pub(crate) terminal_input_gate: Option<PathBuf>,
    pub(crate) prompt_effect_gate: Option<PathBuf>,
    pub(crate) digest_observer: Option<PathBuf>,
    /// The packaged `terminal-owner` helper (X8), named by `RUPD_TERMINAL_OWNER`. The App sets it
    /// for its Daemon; without it, Terminals stay children of the Daemon and a reopen reports
    /// Agents `done`.
    pub(crate) terminal_owner: Option<PathBuf>,
}

impl Observers {
    /// The one place the Daemon reads its environment.
    #[expect(
        clippy::disallowed_methods,
        reason = "the one place the Daemon reads its environment"
    )]
    pub fn from_env() -> Self {
        let path = |name: &str| std::env::var_os(name).map(PathBuf::from);
        Self {
            home: path("HOME"),
            messages_clock: path("RUPD_MESSAGES_CLOCK"),
            messages_fault: std::env::var("RUPD_MESSAGES_FAULT").ok(),
            messages_observer: path("RUPD_MESSAGES_OBSERVER"),
            messages_fault_file: path("RUPD_MESSAGES_FAULT_FILE"),
            order_effect_gate: path("RUPD_ORDER_EFFECT_GATE"),
            resume_effect_gate: path("RUPD_RESUME_EFFECT_GATE"),
            overview_read_gate: path("RUPD_OVERVIEW_READ_GATE"),
            terminal_exit_gate: path("RUPD_TERMINAL_EXIT_GATE"),
            terminal_input_gate: path("RUPD_TERMINAL_INPUT_GATE"),
            prompt_effect_gate: path("RUPD_PROMPT_EFFECT_GATE"),
            digest_observer: path("RUPD_DIGEST_OBSERVER"),
            terminal_owner: path("RUPD_TERMINAL_OWNER"),
        }
    }
}

/// Waits for `done` to hold, rechecking whenever the gate's directory changes, so a release
/// before registration or between events is never missed. `Ok(false)` means the timeout passed.
pub(crate) fn wait_for_gate(
    dir: &std::path::Path,
    timeout: std::time::Duration,
    mut done: impl FnMut() -> bool,
) -> Result<bool, String> {
    use notify::Watcher;
    let (tx, events) = std::sync::mpsc::channel();
    let mut watcher = notify::recommended_watcher(move |_| {
        let _ = tx.send(());
    })
    .map_err(|err| err.to_string())?;
    watcher
        .watch(dir, notify::RecursiveMode::NonRecursive)
        .map_err(|err| err.to_string())?;
    let deadline = std::time::Instant::now() + timeout;
    loop {
        if done() {
            return Ok(true);
        }
        let left = deadline.saturating_duration_since(std::time::Instant::now());
        if left.is_zero() {
            return Ok(false);
        }
        // The watcher owns the sender, so a disconnect cannot occur before it drops.
        let _ = events.recv_timeout(left);
    }
}

fn gate_dir(gate: &std::path::Path) -> &std::path::Path {
    gate.parent()
        .filter(|dir| !dir.as_os_str().is_empty())
        .unwrap_or(std::path::Path::new("."))
}

/// `RUPD_MESSAGES_FAULT=<operation>` makes the first such Messages operation fail with an error
/// (B28's observer through a real Daemon).
pub(crate) fn messages_env(
    observers: &Observers,
    touches: Arc<provenance::Touches>,
) -> messages::Env {
    let mut env = messages::Env::system(touches);
    // B21/B22's real-Daemon observer supplies time and records send attempts without a new RPC.
    if let Some(path) = observers.messages_clock.clone() {
        let system = env.clock.clone();
        env.clock = Arc::new(move || {
            std::fs::read_to_string(&path)
                .ok()
                .and_then(|text| text.trim().parse().ok())
                .unwrap_or_else(|| system())
        });
    }
    let op = observers.messages_fault.clone();
    let observer = observers.messages_observer.clone();
    let fault_file = observers.messages_fault_file.clone();
    if op.is_some() || observer.is_some() || fault_file.is_some() {
        let armed = std::sync::atomic::AtomicBool::new(true);
        env.fault = Arc::new(move |name| {
            if let Some(path) = &observer {
                use std::io::Write;
                std::fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(path)
                    .and_then(|mut file| writeln!(file, "{name}"))
                    .map_err(|err| format!("Messages observer could not record {name}: {err}"))?;
            }
            let selected = fault_file
                .as_ref()
                .and_then(|path| std::fs::read_to_string(path).ok());
            if selected.as_deref() == Some(name)
                || (op.as_deref() == Some(name)
                    && armed.swap(false, std::sync::atomic::Ordering::SeqCst))
            {
                Err(format!("injected failure in {name}"))
            } else {
                Ok(())
            }
        });
    }
    env
}

/// B6's real-Daemon observer pauses on the Terminal input thread before any Steer bytes.
pub(crate) fn steer_effect_observer(
    observers: &Observers,
) -> impl Fn(&str) -> Result<(), RpcError> + Send + Sync + use<> {
    let gate = observers.order_effect_gate.clone();
    move |agent| {
        let Some(gate) = &gate else {
            return Ok(());
        };
        if !gate.is_file() {
            return Ok(());
        }
        std::fs::write(gate.with_extension("arrived"), agent).map_err(RpcError::internal)?;
        let mut refused = false;
        let released = wait_for_gate(gate_dir(gate), std::time::Duration::from_secs(10), || {
            refused =
                gate.is_file() && std::fs::read_to_string(gate).ok().as_deref() == Some("refuse");
            refused || !gate.is_file()
        })
        .map_err(RpcError::internal)?;
        if refused {
            return Err(RpcError::conflict("Steer observer refused before bytes"));
        }
        if !released {
            return Err(RpcError::conflict("Steer observer was not released"));
        }
        Ok(())
    }
}

/// B6's isolated observer controls Terminal recording and cleanup without a desktop.
pub(crate) fn resume_effect_observer(
    observers: &Observers,
) -> impl Fn(&str, &str) -> Result<(), RpcError> + Send + Sync + use<> {
    let gate = observers.resume_effect_gate.clone();
    move |phase, terminal| {
        let Some(gate) = &gate else { return Ok(()) };
        let gate = gate.with_extension(phase);
        let recording = gate.with_extension(format!("{phase}-recording"));
        std::fs::write(&recording, terminal).map_err(RpcError::internal)?;
        std::fs::rename(recording, gate.with_extension(format!("{phase}-arrived")))
            .map_err(RpcError::internal)?;
        let mut refused = false;
        let released = wait_for_gate(gate_dir(&gate), std::time::Duration::from_secs(30), || {
            refused =
                gate.is_file() && std::fs::read_to_string(&gate).ok().as_deref() == Some("refuse");
            refused || !gate.is_file()
        })
        .map_err(RpcError::internal)?;
        if refused {
            return Err(RpcError::conflict("Terminal cleanup refused before kill"));
        }
        if !released {
            return Err(RpcError::unknown_outcome(
                "Resume observer was not released",
            ));
        }
        Ok(())
    }
}

/// RO3's isolated observer keeps the overview reader pending while its gate file exists.
pub(crate) fn overview_read_observer(observers: &Observers) -> impl Fn() + Send + Sync + use<> {
    let gate = observers.overview_read_gate.clone();
    move || {
        let Some(gate) = &gate else { return };
        let _ = std::fs::write(gate.with_extension("arrived"), "");
        let _ = wait_for_gate(gate_dir(gate), std::time::Duration::from_secs(30), || {
            !gate.is_file()
        });
    }
}

/// B6's isolated exit observer keeps a Terminal's exit unconfirmed while its gate file exists.
pub(crate) fn terminal_exit_observer(observers: &Observers) -> impl Fn() + Send + Sync + use<> {
    let gate = observers.terminal_exit_gate.clone();
    move || {
        let Some(gate) = &gate else { return };
        let _ = wait_for_gate(gate_dir(gate), std::time::Duration::from_secs(30), || {
            !gate.is_file()
        });
    }
}

/// B6's isolated physical-IO observer uses the real PTY underneath every controlled write.
pub(crate) fn terminal_input_observer(
    observers: &Observers,
) -> impl Fn(Box<dyn std::io::Write + Send>) -> Box<dyn std::io::Write + Send> + use<> {
    let gate = observers.terminal_input_gate.clone();
    move |writer| match &gate {
        Some(gate) => Box::new(ObservedInput {
            writer,
            gate: gate.clone(),
            partial: false,
        }),
        None => writer,
    }
}

struct ObservedInput {
    writer: Box<dyn std::io::Write + Send>,
    gate: std::path::PathBuf,
    partial: bool,
}

impl std::io::Write for ObservedInput {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        match std::fs::read_to_string(&self.gate).ok().as_deref() {
            Some("pause") => {
                std::fs::write(self.gate.with_extension("arrived"), "input")?;
                let released = wait_for_gate(
                    gate_dir(&self.gate),
                    std::time::Duration::from_secs(10),
                    || !self.gate.is_file(),
                )
                .map_err(std::io::Error::other)?;
                if !released {
                    return Err(std::io::Error::other("input observer was not released"));
                }
            }
            Some("partial") if !self.partial => {
                self.partial = true;
                return self.writer.write(bytes.get(..1).unwrap_or(bytes));
            }
            Some("partial") => return Err(std::io::Error::other("input observer partial write")),
            Some("end") => {
                return Err(std::io::Error::other(
                    "input observer ended without a result",
                ));
            }
            _ => {}
        }
        self.writer.write(bytes)
    }

    fn flush(&mut self) -> std::io::Result<()> {
        if std::fs::read_to_string(&self.gate).ok().as_deref() == Some("flush") {
            return Err(std::io::Error::other("input observer flush failure"));
        }
        self.writer.flush()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn z3799b_an_already_released_gate_does_not_block() {
        let dir = tempfile::tempdir().unwrap();
        let gate = dir.path().join("gate");
        let released = wait_for_gate(dir.path(), std::time::Duration::from_secs(30), || {
            !gate.is_file()
        });
        assert_eq!(released, Ok(true));
    }

    #[test]
    fn z3799b_release_wakes_a_waiting_gate() {
        let dir = tempfile::tempdir().unwrap();
        let gate = dir.path().join("gate");
        std::fs::write(&gate, "pause").unwrap();
        let path = gate.clone();
        let releaser = std::thread::spawn(move || std::fs::remove_file(path).unwrap());
        let released = wait_for_gate(dir.path(), std::time::Duration::from_secs(30), || {
            !gate.is_file()
        });
        releaser.join().unwrap();
        assert_eq!(released, Ok(true));
    }
}
