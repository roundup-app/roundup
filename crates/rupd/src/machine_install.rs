//! MC25: a Linux `rup` on a machine. A probe over the machine's own ssh reads `uname -m`, whether
//! `socat` is there and which `rup` answers; a `rup` that is not the Mac's version is streamed
//! over a second `ssh <name>` command to `~/.rupq/bin/rup`, linked onto the non-interactive PATH,
//! and checked. Nothing but `ssh`, `sh` and `socat` is needed there.

use std::future::Future;
use std::io;
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::Arc;

use tokio::io::AsyncWriteExt;
use tokio::process::Command;

/// What `rup --version` prints on the Mac, and so on a machine that can talk to it.
pub(crate) const VERSION: &str = concat!("rup ", env!("CARGO_PKG_VERSION"));

/// What one ssh command left.
pub(crate) struct Ran {
    pub(crate) ok: bool,
    pub(crate) stdout: String,
}

type Run = dyn Fn(String, String, Vec<u8>) -> Pin<Box<dyn Future<Output = io::Result<Ran>> + Send>>
    + Send
    + Sync;

/// Where the install finds ssh and the Linux binaries.
#[derive(Clone)]
pub(crate) struct Setup {
    run: Arc<Run>,
    artifacts: PathBuf,
}

impl Setup {
    /// The user's own `ssh`, and the `rup-linux-<arch>` files beside this Daemon's executable.
    pub(crate) fn system() -> Self {
        let artifacts = std::env::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(PathBuf::from))
            .unwrap_or_default();
        Self::new(artifacts, |host, script, stdin| {
            Box::pin(async move {
                let mut child = Command::new("ssh")
                    .args(["-T", "-o", "BatchMode=yes", "--", &host, &script])
                    .stdin(std::process::Stdio::piped())
                    .stdout(std::process::Stdio::piped())
                    .stderr(std::process::Stdio::null())
                    .kill_on_drop(true)
                    .spawn()?;
                let mut pipe = child.stdin.take().ok_or(io::ErrorKind::BrokenPipe)?;
                // A command that stops reading early closes the pipe; its exit status says why.
                let _ = pipe.write_all(&stdin).await;
                drop(pipe);
                let out = child.wait_with_output().await?;
                Ok(Ran {
                    ok: out.status.success(),
                    stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
                })
            })
        })
    }

    /// Whether any `rup-linux-<arch>` file sits beside this Daemon.
    pub(crate) fn has_artifacts(&self) -> bool {
        ["x86_64", "aarch64"]
            .iter()
            .any(|arch| self.artifacts.join(format!("rup-linux-{arch}")).is_file())
    }

    pub(crate) fn new(
        artifacts: PathBuf,
        run: impl Fn(String, String, Vec<u8>) -> Pin<Box<dyn Future<Output = io::Result<Ran>> + Send>>
        + Send
        + Sync
        + 'static,
    ) -> Self {
        Self {
            run: Arc::new(run),
            artifacts,
        }
    }

    async fn ssh(&self, host: &str, script: &str, stdin: Vec<u8>) -> Result<Ran, Failure> {
        (self.run)(host.to_owned(), script.to_owned(), stdin)
            .await
            .map_err(|e| Failure::new("ssh_failed", format!("ssh {host}: {e}")))
    }
}

/// A coded failure; the code is the word the message starts with.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Failure {
    pub(crate) code: &'static str,
    pub(crate) message: String,
}

impl Failure {
    fn new(code: &'static str, message: String) -> Self {
        Self { code, message }
    }
}

/// What the install did.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Outcome {
    Installed,
    Unchanged,
}

const PROBE: &str = r#"echo "arch=$(uname -m)"; if command -v socat >/dev/null 2>&1; then echo socat=yes; else echo socat=no; fi; echo "home=$("$HOME/.rupq/bin/rup" --version 2>/dev/null)"; echo "path=$(rup --version 2>/dev/null)""#;

/// Reads `rup` from stdin into place, then puts it on the PATH a non-interactive ssh gets: a link in
/// `/usr/local/bin`, made with `sudo -n` when the user cannot write there.
const INSTALL: &str = r#"set -e; d="$HOME/.rupq/bin"; mkdir -p "$d"; cat > "$d/rup.new"; chmod 755 "$d/rup.new"; mv -f "$d/rup.new" "$d/rup"; ln -sf "$d/rup" /usr/local/bin/rup 2>/dev/null || sudo -n ln -sf "$d/rup" /usr/local/bin/rup 2>/dev/null || true"#;

fn field<'a>(probe: &'a str, key: &str) -> &'a str {
    probe
        .lines()
        .find_map(|l| l.strip_prefix(key)?.strip_prefix('='))
        .unwrap_or("")
        .trim()
}

/// Installs the Linux `rup` for `host`'s architecture unless the machine already answers with the
/// Mac's version both at `~/.rupq/bin/rup` and on its ssh PATH.
pub(crate) async fn install(setup: &Setup, host: &str) -> Result<Outcome, Failure> {
    let probe = setup.ssh(host, PROBE, Vec::new()).await?;
    if !probe.ok {
        return Err(Failure::new(
            "ssh_failed",
            format!("ssh {host}: probe failed"),
        ));
    }
    if field(&probe.stdout, "socat") != "yes" {
        return Err(Failure::new(
            "socat_missing",
            format!("{host} has no socat; the bridge needs it to reach the relay socket"),
        ));
    }
    if field(&probe.stdout, "home") == VERSION && field(&probe.stdout, "path") == VERSION {
        return Ok(Outcome::Unchanged);
    }
    let arch = match field(&probe.stdout, "arch") {
        "x86_64" => "x86_64",
        "aarch64" | "arm64" => "aarch64",
        other => {
            return Err(Failure::new(
                "unsupported_arch",
                format!("{host} is {other}; rup is built for x86_64 and aarch64 Linux"),
            ));
        }
    };
    let file = setup.artifacts.join(format!("rup-linux-{arch}"));
    let binary = std::fs::read(&file)
        .map_err(|e| Failure::new("artifact_missing", format!("{}: {e}", file.display())))?;
    if !setup.ssh(host, INSTALL, binary).await?.ok {
        return Err(Failure::new(
            "ssh_failed",
            format!("ssh {host}: the install command failed"),
        ));
    }
    let after = setup.ssh(host, "rup --version", Vec::new()).await?;
    if after.stdout.trim() != VERSION {
        return Err(Failure::new(
            "version_mismatch",
            format!(
                "{host} answers `rup --version` with {:?}, not {VERSION:?}; rup is not on its ssh PATH or is not this version",
                after.stdout.trim()
            ),
        ));
    }
    Ok(Outcome::Installed)
}

#[cfg(test)]
mod tests {
    //! MC25 against a fake ssh that keeps a machine's files.
    use super::*;
    use parking_lot::Mutex;

    struct Machine {
        arch: &'static str,
        socat: bool,
        rup: Option<Vec<u8>>,
        installs: usize,
    }

    fn fake(arch: &'static str, socat: bool) -> (Setup, Arc<Mutex<Machine>>, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        for a in ["x86_64", "aarch64"] {
            std::fs::write(
                dir.path().join(format!("rup-linux-{a}")),
                format!("elf {a}"),
            )
            .unwrap();
        }
        let machine = Arc::new(Mutex::new(Machine {
            arch,
            socat,
            rup: None,
            installs: 0,
        }));
        let m = Arc::clone(&machine);
        let setup = Setup::new(dir.path().into(), move |_, script, stdin| {
            let m = Arc::clone(&m);
            Box::pin(async move {
                let mut m = m.lock();
                let version = |m: &Machine| match &m.rup {
                    Some(_) => VERSION.to_owned(),
                    None => String::new(),
                };
                let stdout = if script == PROBE {
                    let socat = if m.socat { "yes" } else { "no" };
                    format!(
                        "arch={}\nsocat={socat}\nhome={}\npath={}\n",
                        m.arch,
                        version(&m),
                        version(&m)
                    )
                } else if script == INSTALL {
                    m.rup = Some(stdin);
                    m.installs += 1;
                    String::new()
                } else {
                    format!("{}\n", version(&m))
                };
                Ok(Ran { ok: true, stdout })
            })
        });
        (setup, machine, dir)
    }

    #[tokio::test]
    async fn mc25_install_streams_the_matching_binary_and_checks_version() {
        for (arch, file) in [("x86_64", "elf x86_64"), ("aarch64", "elf aarch64")] {
            let (setup, machine, _dir) = fake(arch, true);
            assert_eq!(install(&setup, "box").await, Ok(Outcome::Installed));
            assert_eq!(machine.lock().rup.as_deref(), Some(file.as_bytes()));
        }
    }

    #[tokio::test]
    async fn mc25_a_missing_socat_is_a_coded_error() {
        let (setup, machine, _dir) = fake("x86_64", false);
        let err = install(&setup, "box").await.unwrap_err();
        assert_eq!(err.code, "socat_missing");
        assert!(err.message.contains("socat"));
        assert_eq!(machine.lock().installs, 0);
    }

    #[tokio::test]
    async fn mc25_reinstall_on_the_same_version_changes_nothing() {
        let (setup, machine, _dir) = fake("x86_64", true);
        assert_eq!(install(&setup, "box").await, Ok(Outcome::Installed));
        assert_eq!(install(&setup, "box").await, Ok(Outcome::Unchanged));
        assert_eq!(machine.lock().installs, 1);
    }
}
