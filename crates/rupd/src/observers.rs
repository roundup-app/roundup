use super::*;

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

/// B6's physical-effect observer. The two phases distinguish invalidation before the
/// check from a user action arriving while the checked effect holds its locks.
pub(crate) fn prompt_effect_observer()
-> impl Fn(&contracts::decision::PromptIdentity) -> Result<(), RpcError> + Send + Sync {
    let gate = std::env::var_os("RUPD_PROMPT_EFFECT_GATE").map(std::path::PathBuf::from);
    move |identity| {
        let Some(gate) = &gate else {
            return Ok(());
        };
        if std::fs::read_to_string(gate).ok().as_deref() != Some("effect") {
            return Ok(());
        }
        std::fs::write(gate.with_extension("arrived"), &identity.decision)
            .map_err(RpcError::internal)?;
        let started = std::time::Instant::now();
        while gate.is_file() {
            if started.elapsed() >= std::time::Duration::from_secs(10) {
                return Err(RpcError::conflict(
                    "original prompt effect observer was not released",
                ));
            }
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
        Ok(())
    }
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
        let started = std::time::Instant::now();
        while gate.is_file() {
            if std::fs::read_to_string(gate).ok().as_deref() == Some("refuse") {
                return Err(RpcError::conflict("Steer observer refused before bytes"));
            }
            if started.elapsed() >= std::time::Duration::from_secs(10) {
                return Err(RpcError::conflict("Steer observer was not released"));
            }
            std::thread::sleep(std::time::Duration::from_millis(5));
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
        let started = std::time::Instant::now();
        while gate.is_file() {
            if std::fs::read_to_string(&gate).ok().as_deref() == Some("refuse") {
                return Err(RpcError::conflict("Terminal cleanup refused before kill"));
            }
            if started.elapsed() >= std::time::Duration::from_secs(30) {
                return Err(RpcError::unknown_outcome(
                    "Resume observer was not released",
                ));
            }
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
        Ok(())
    }
}

/// B6's isolated exit observer keeps a Terminal's exit unconfirmed while its gate file exists.
pub(crate) fn terminal_exit_observer() -> impl Fn() + Send + Sync {
    let gate = std::env::var_os("RUPD_TERMINAL_EXIT_GATE").map(std::path::PathBuf::from);
    move || {
        let Some(gate) = &gate else { return };
        let started = std::time::Instant::now();
        while gate.is_file() && started.elapsed() < std::time::Duration::from_secs(30) {
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
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
                let started = std::time::Instant::now();
                while self.gate.is_file() {
                    if started.elapsed() >= std::time::Duration::from_secs(10) {
                        return Err(std::io::Error::other("input observer was not released"));
                    }
                    std::thread::sleep(std::time::Duration::from_millis(5));
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
