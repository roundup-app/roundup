use super::*;

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
pub(crate) fn messages_env(touches: Arc<provenance::Touches>) -> messages::Env {
    let mut env = messages::Env::system(touches);
    // B21/B22's real-Daemon observer supplies time and records send attempts without a new RPC.
    if let Some(path) = std::env::var_os("RUPD_MESSAGES_CLOCK") {
        env.clock = Arc::new(move || {
            std::fs::read_to_string(&path)
                .expect("read Messages fake clock")
                .trim()
                .parse()
                .expect("Messages fake clock milliseconds")
        });
    }
    let op = std::env::var("RUPD_MESSAGES_FAULT").ok();
    let observer = std::env::var_os("RUPD_MESSAGES_OBSERVER");
    let fault_file = std::env::var_os("RUPD_MESSAGES_FAULT_FILE");
    if op.is_some() || observer.is_some() || fault_file.is_some() {
        let armed = std::sync::atomic::AtomicBool::new(true);
        env.fault = Arc::new(move |name| {
            if let Some(path) = &observer {
                use std::io::Write;
                let mut file = std::fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(path)
                    .expect("open Messages observer");
                writeln!(file, "{name}").expect("write Messages operation");
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
pub(crate) fn steer_effect_observer() -> impl Fn(&str) -> Result<(), RpcError> + Send + Sync {
    let gate = std::env::var_os("RUPD_ORDER_EFFECT_GATE").map(std::path::PathBuf::from);
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
pub(crate) fn resume_effect_observer() -> impl Fn(&str, &str) -> Result<(), RpcError> + Send + Sync
{
    let gate = std::env::var_os("RUPD_RESUME_EFFECT_GATE").map(std::path::PathBuf::from);
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
pub(crate) fn overview_read_observer() -> impl Fn() + Send + Sync {
    let gate = std::env::var_os("RUPD_OVERVIEW_READ_GATE").map(std::path::PathBuf::from);
    move || {
        let Some(gate) = &gate else { return };
        let _ = std::fs::write(gate.with_extension("arrived"), "");
        let _ = wait_for_gate(gate_dir(gate), std::time::Duration::from_secs(30), || {
            !gate.is_file()
        });
    }
}

/// B6's isolated exit observer keeps a Terminal's exit unconfirmed while its gate file exists.
pub(crate) fn terminal_exit_observer() -> impl Fn() + Send + Sync {
    let gate = std::env::var_os("RUPD_TERMINAL_EXIT_GATE").map(std::path::PathBuf::from);
    move || {
        let Some(gate) = &gate else { return };
        let _ = wait_for_gate(gate_dir(gate), std::time::Duration::from_secs(30), || {
            !gate.is_file()
        });
    }
}

/// B6's isolated physical-IO observer uses the real PTY underneath every controlled write.
pub(crate) fn terminal_input_observer()
-> impl Fn(Box<dyn std::io::Write + Send>) -> Box<dyn std::io::Write + Send> {
    let gate = std::env::var_os("RUPD_TERMINAL_INPUT_GATE").map(std::path::PathBuf::from);
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
                return self.writer.write(&bytes[..bytes.len().min(1)]);
            }
            Some("partial") => return Err(std::io::Error::other("input observer partial write")),
            Some("end") => panic!("input observer ended without a result"),
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
