//! Wait for run-owned executables before removing their data, including an App's Daemon.
use std::io;
use std::time::{Duration, Instant};
use sysinfo::{
    Pid, ProcessRefreshKind, ProcessStatus, ProcessesToUpdate, Signal, System, UpdateKind,
};
use tokio::process::Child;

pub(crate) async fn finish<T>(
    dir: tempfile::TempDir,
    child: &mut Child,
    app: bool,
    result: io::Result<T>,
) -> io::Result<T> {
    if let Err(err) = stop(child, app, dir.path()).await {
        let path = dir.keep();
        return Err(io::Error::other(format!(
            "{err}; retained data at {}",
            path.display()
        )));
    }
    dir.close()?;
    result
}

async fn stop(child: &mut Child, app: bool, dir: &std::path::Path) -> io::Result<()> {
    let mut system = System::new();
    let mut descendants = Vec::new();
    if app {
        let id = child.id();
        if let Some(id) = id {
            let root = Pid::from_u32(id);
            system.refresh_processes(ProcessesToUpdate::Some(&[root]), true);
            if let Some(owner) = system.process(root)
                && !matches!(owner.status(), ProcessStatus::Zombie | ProcessStatus::Dead)
                && !owner.kill_with(Signal::Stop).unwrap_or(false)
            {
                return Err(io::Error::other(
                    "cannot pause the App before stopping its Daemon",
                ));
            }
            let deadline = Instant::now() + Duration::from_secs(10);
            loop {
                // sysinfo on macOS reads the BSD process status only on insertion.
                system = System::new();
                system.refresh_processes(ProcessesToUpdate::Some(&[root]), true);
                if system.process(root).is_none_or(|p| {
                    matches!(
                        p.status(),
                        ProcessStatus::Stop | ProcessStatus::Zombie | ProcessStatus::Dead
                    )
                }) {
                    break;
                }
                if Instant::now() >= deadline {
                    return Err(io::Error::other("the App did not pause"));
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
            // A stopped App cannot launch another Daemon between enumeration and termination.
            system.refresh_processes(ProcessesToUpdate::All, true);
            let mut owners = vec![root];
            let mut cursor = 0;
            while cursor < owners.len() {
                for (pid, process) in system.processes() {
                    if process.parent() == Some(owners[cursor]) && !owners.contains(pid) {
                        descendants.push((*pid, process.start_time()));
                        owners.push(*pid);
                    }
                }
                cursor += 1;
            }
        }
        // Even if the App already exited, its orphaned Daemon still carries this run's data override.
        system.refresh_processes_specifics(
            ProcessesToUpdate::All,
            true,
            ProcessRefreshKind::nothing().with_environ(UpdateKind::Always),
        );
        let mut owned = std::ffi::OsString::from("ROUNDUP_DATA_DIR=");
        owned.push(std::path::absolute(dir.join("data"))?);
        for (pid, process) in system.processes() {
            if process.environ().contains(&owned)
                && !descendants.iter().any(|(known, _)| known == pid)
                && Some(pid.as_u32()) != id
            {
                descendants.push((*pid, process.start_time()));
            }
        }
        for (pid, started) in descendants.iter().rev() {
            if let Some(process) = system.process(*pid)
                && process.start_time() == *started
            {
                process.kill();
            }
        }
    }
    child.kill().await?;
    child.wait().await?;
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        system = System::new();
        system.refresh_processes(ProcessesToUpdate::All, true);
        let alive = descendants.iter().any(|(pid, started)| {
            system.process(*pid).is_some_and(|process| {
                process.start_time() == *started
                    && !matches!(
                        process.status(),
                        ProcessStatus::Zombie | ProcessStatus::Dead
                    )
            })
        });
        if !alive {
            return Ok(());
        }
        if Instant::now() >= deadline {
            return Err(io::Error::other("the App's Daemon did not exit"));
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
}
