use std::io::{self, Write};
use std::path::PathBuf;
use std::sync::Arc;

use tokio::net::{UnixListener, UnixStream};

fn main() -> io::Result<()> {
    let begun = std::time::Instant::now();
    // Collection is opt-in; never enable argument or return-value recording.
    if std::env::var_os("ROUNDUP_TRACING").is_some_and(|value| value == "1") {
        tracing_subscriber::fmt()
            .with_max_level(tracing::Level::INFO)
            .with_ansi(false)
            .with_writer(io::stderr)
            .with_span_events(tracing_subscriber::fmt::format::FmtSpan::CLOSE)
            .init();
    }
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
    args.retain(|arg| arg != "--attached");
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
    eprintln!(
        "rupd: runtime_ms {runtime_ms:.6}\nrupd: serving {} on {} (open {:.2} ms, bound {:.2} ms)",
        project.display(),
        path.display(),
        opened_at.as_secs_f64() * 1e3,
        begun.elapsed().as_secs_f64() * 1e3
    );
    let daemon = Arc::new(daemon);
    if !attached {
        return rupd::serve(listener, daemon).await;
    }
    // The App holds our stdin open; its exit, even a crash, closes it. Its bytes are drained and
    // discarded; only end of file matters.
    let stdin_closed =
        tokio::task::spawn_blocking(|| io::copy(&mut io::stdin().lock(), &mut io::sink()));
    let ended = tokio::select! {
        served = rupd::serve(listener, Arc::clone(&daemon)) => served,
        closed = stdin_closed => closed.map_err(io::Error::other)?.map(drop),
    };
    // An App that crashed has closed stderr too; a failed log write must not skip the stop.
    let _ = writeln!(io::stderr(), "rupd: stopping");
    let stopped = daemon.stop_terminals().await.map_err(io::Error::other);
    ended.and(stopped)
}
