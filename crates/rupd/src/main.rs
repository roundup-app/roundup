use std::io::{self, Write};
use std::os::fd::AsFd;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use tokio::io::AsyncWriteExt;
use tokio::net::unix::pipe::Sender;
use tokio::net::{UnixListener, UnixStream};

fn main() -> io::Result<()> {
    let begun = std::time::Instant::now();
    // Keep tokio::main's default runtime; its creation precedes the async open timer.
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?;
    let runtime_ms = begun.elapsed().as_secs_f64() * 1e3;
    runtime.block_on(run(runtime_ms))
}

async fn run(runtime_ms: f64) -> io::Result<()> {
    let begun = std::time::Instant::now();
    let mut args: Vec<_> = std::env::args_os().skip(1).collect();
    let attached = args.iter().any(|arg| arg == "--attached");
    let notify_bound = args.iter().any(|arg| arg == "--notify-bound");
    args.retain(|arg| arg != "--attached" && arg != "--notify-bound");
    if notify_bound && !attached {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "--notify-bound requires --attached",
        ));
    }
    let project = args
        .first()
        .map_or_else(std::env::current_dir, |dir| Ok(PathBuf::from(dir)))?;
    // N1: the Project's data lives in the App's data folder, never in the Project folder.
    let data = rupd::data::data_dir()?;
    let opened = rupd::Daemon::open_project(&project, &data);
    let opened_at = begun.elapsed();
    let daemon = match opened {
        Ok(daemon) => daemon,
        Err(err) => {
            let _ = writeln!(io::stderr(), "rupd: refusing to start: {err}");
            std::process::exit(1)
        }
    };

    let path = rpc::socket_path()?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    // A stale socket from a crashed run would make bind fail; a live one is caught by connect.
    if path.exists() && UnixStream::connect(&path).await.is_err() {
        std::fs::remove_file(&path)?;
    }
    let listener = UnixListener::bind(&path)?;
    // Keep open/bound relative to async entry so existing startup logs stay comparable.
    let _ = writeln!(
        io::stderr(),
        "rupd: runtime_ms {runtime_ms:.6}\nrupd: serving {} on {} (open {:.2} ms, bound {:.2} ms)",
        project.display(),
        path.display(),
        opened_at.as_secs_f64() * 1e3,
        begun.elapsed().as_secs_f64() * 1e3
    );
    let daemon = Arc::new(daemon);
    // A12a, S1: retained programs still call the socket of the run that started them.
    for old in daemon.reattach_owners().await {
        if old == path {
            continue;
        }
        if old.exists() && UnixStream::connect(&old).await.is_err() {
            let _ = std::fs::remove_file(&old);
        }
        if let Ok(extra) = UnixListener::bind(&old) {
            tokio::spawn(rupd::serve(extra, Arc::clone(&daemon)));
        }
    }
    if !attached {
        return rupd::serve(listener, daemon).await;
    }
    let ended = async {
        if notify_bound {
            // STARTUP.md: a bounded nonblocking write, never a log or proof of readiness.
            // Do this before starting the blocking stdin reader so failure can exit while
            // the parent still holds stdin open, and still reaches Terminal cleanup below.
            let mut stdout = Sender::from_owned_fd(io::stdout().as_fd().try_clone_to_owned()?)?;
            tokio::time::timeout(Duration::from_secs(1), stdout.write_all(b"rupd-bound\n"))
                .await
                .map_err(|_| {
                    io::Error::new(io::ErrorKind::TimedOut, "startup notification timed out")
                })??;
        }
        // The App holds our stdin open; its exit, even a crash, closes it. Its bytes are drained
        // and discarded; only end of file matters.
        let stdin_closed =
            tokio::task::spawn_blocking(|| io::copy(&mut io::stdin().lock(), &mut io::sink()));
        tokio::select! {
            served = rupd::serve(listener, Arc::clone(&daemon)) => served,
            closed = stdin_closed => closed.map_err(io::Error::other)?.map(drop),
        }
    }
    .await;
    // An App that crashed has closed stderr too; a failed log write must not skip the stop.
    let _ = writeln!(io::stderr(), "rupd: stopping");
    let stopped = daemon.stop_terminals().await.map_err(io::Error::other);
    ended.and(stopped)
}
