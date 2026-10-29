//! An opt-in, one-Terminal owner. The ordinary Daemon still owns its PTYs directly.
use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Arc;

use contracts::Actor;
use contracts::terminal::{SpawnParams, TerminalInfo};
use rpc::{Bus, Client, Ctx, Module, OpenError, RpcError};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream};

use crate::{Output, OutputStream, Terminals};
use base64::Engine;
use base64::engine::general_purpose::STANDARD;

const SOCKET_ROOT: &str = "/tmp";
const SOCKET_LINK: &str = "socket-directory";

/// Persistable identity of one owner and its original Terminal. Not permission to start anything.
/// A numeric id or PID is deliberately insufficient: reconnect verifies the random incarnation
/// on the connected socket, whose pathname must be inside the original Project data directory.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TerminalOwner {
    project: PathBuf,
    directory: PathBuf,
    socket: PathBuf,
    pub info: TerminalInfo,
}

impl TerminalOwner {
    /// Explicitly start the packaged `terminal-owner` executable. The caller must arrange to reap
    /// the returned child; dropping it or closing any client does not stop the Terminal. Only
    /// `terminal.kill` stops the work. This opt-in seam is not used by default Daemon startup.
    pub fn start(
        helper: &Path,
        project: &Path,
        params: SpawnParams,
    ) -> Result<(Self, Child), OpenError> {
        Self::start_with(helper, project, params, &[])
    }

    pub(super) fn start_with(
        helper: &Path,
        project: &Path,
        mut params: SpawnParams,
        clean_env: &[String],
    ) -> Result<(Self, Child), OpenError> {
        params.env.retain(|name, _| !clean_env.contains(name));
        let project = project.canonicalize()?;
        let mut command = Command::new(helper);
        for marker in clean_env {
            command.env_remove(marker);
        }
        let mut child = command
            .arg(&project)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()?;
        let stdin = child.stdin.take().ok_or("owner stdin")?;
        let stdout = child.stdout.take().ok_or("owner stdout")?;
        let expected_project = project.clone();
        let (ready, record) = std::sync::mpsc::sync_channel(1);
        let bootstrap = std::thread::spawn(move || {
            let result = (|| -> Result<Self, OpenError> {
                serde_json::to_writer(stdin, &params)?;
                let mut line = String::new();
                std::io::BufReader::new(stdout).read_line(&mut line)?;
                let owner: Self = serde_json::from_str(&line)?;
                if owner.project != expected_project {
                    return Err("owner Project mismatch".into());
                }
                Ok(owner)
            })();
            let _ = ready.send(result);
        });
        let result = record
            .recv_timeout(std::time::Duration::from_secs(5))
            .map_err(|err| -> OpenError { Box::new(err) })
            .and_then(|result| result);
        match result {
            Ok(owner) => {
                bootstrap.join().map_err(|_| "owner bootstrap panicked")?;
                Ok((owner, child))
            }
            Err(err) => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = bootstrap.join();
                Err(err)
            }
        }
    }

    /// Attach only to this live incarnation. Never launches a helper or program, never sends input
    /// or a signal before verification. An exit racing this lookup cannot create a replacement:
    /// the connected owner has exactly one immutable Terminal and no spawn RPC.
    pub async fn connect(&self, project: &Path) -> Result<Client, RpcError> {
        let project = project.canonicalize().map_err(RpcError::internal)?;
        if project != self.project
            || self.directory.parent() != Some(project.as_path())
            || std::fs::read_link(self.directory.join(SOCKET_LINK))
                .ok()
                .as_deref()
                != self.socket.parent()
        {
            return Err(RpcError::not_found("Terminal owner Project"));
        }
        tokio::time::timeout(std::time::Duration::from_secs(5), self.connect_live())
            .await
            .map_err(|_| RpcError::internal("Terminal owner did not answer within five seconds"))?
    }

    async fn connect_live(&self) -> Result<Client, RpcError> {
        let client = Client::connect(&self.socket)
            .await
            .map_err(RpcError::internal)?;
        let terminals: Vec<TerminalInfo> =
            rpc::params(client.request("terminal.list", json!({})).await?)?;
        if terminals.len() != 1
            || terminals[0].id != self.info.id
            || terminals[0].incarnation != self.info.incarnation
            || !terminals[0].running
        {
            return Err(RpcError::not_found("live Terminal incarnation"));
        }
        Ok(client)
    }
}

impl Terminals {
    /// Helper entry point: start one Terminal, publish its owner record on stdout, then serve only
    /// existing-Terminal RPC operations. The owner outlives all disconnected clients. When the
    /// original program ends, stop accepting clients and drain accepted connections before exit.
    /// `project` is the canonical Project data directory, not necessarily the program's cwd.
    pub async fn serve_owner(project: &Path, params: SpawnParams) -> Result<(), OpenError> {
        let project = project.canonicalize()?;
        let directory = tempfile::Builder::new()
            .prefix("terminal-")
            .tempdir_in(&project)?;
        // `sun_path` is short (104 bytes on macOS), so the socket lives in a short private
        // directory; a link in the Project directory ties the two together. TempDir is 0700.
        let socket_directory = tempfile::Builder::new()
            .prefix("ro-")
            .tempdir_in(SOCKET_ROOT)?;
        std::os::unix::fs::symlink(socket_directory.path(), directory.path().join(SOCKET_LINK))?;
        let socket = socket_directory.path().join("o.sock");
        let listener = UnixListener::bind(&socket)?;
        let bus = Bus::new();
        let terminals = Arc::new(Self::open(&project, bus.clone())?);
        let ctx = Arc::new(Ctx {
            actor: Actor::user(),
            bus,
            touches: Arc::new(provenance::Touches::open(Path::new(":memory:"))?),
        });
        // Adopt only this helper's descendants so explicit stop can reap the whole PTY group.
        #[cfg(target_os = "linux")]
        nix::sys::prctl::set_child_subreaper(true)?;
        let spawned = terminals.spawn(params).await?;
        let info = terminals
            .list()
            .await
            .into_iter()
            .find(|info| info.id == spawned.id)
            .ok_or("owner Terminal")?;
        let owner = TerminalOwner {
            project,
            directory: directory.path().to_path_buf(),
            socket,
            info,
        };
        let result = (|| {
            let mut stdout = std::io::stdout().lock();
            serde_json::to_writer(&mut stdout, &owner)?;
            writeln!(stdout)?;
            stdout.flush()?;
            Ok::<_, OpenError>(())
        })();
        if let Err(err) = result {
            let _ = terminals.kill(&spawned.id).await;
            return Err(err);
        }
        let mut connections = tokio::task::JoinSet::new();
        loop {
            tokio::select! {
                biased;
                () = terminals.wait_program_ended(&spawned.id) => break,
                accepted = listener.accept() => {
                    let (stream, _) = accepted?;
                    let terminals = terminals.clone(); let ctx = ctx.clone(); let id = spawned.id.clone();
                    connections.spawn(async move { connection(stream, terminals, ctx, id).await });
                }
                Some(result) = connections.join_next() => { report_connection(result)?; }
            }
        }
        drop(listener);
        while let Some(result) = connections.join_next().await {
            report_connection(result)?;
        }
        Ok(())
    }
}

/// Existing JSON-RPC framing and Terminal contracts, with a closed method set: creation is absent.
async fn connection(
    stream: UnixStream,
    terminals: Arc<Terminals>,
    ctx: Arc<Ctx>,
    id: String,
) -> Result<(), OpenError> {
    let (read, mut write) = stream.into_split();
    let mut lines = BufReader::new(read).lines();
    let mut output: Option<OutputStream> = None;
    let mut events = ctx.bus.subscribe();
    loop {
        let frame = tokio::select! {
            line = lines.next_line() => {
                let Some(line) = line? else { return Ok(()); };
                let request: Value = serde_json::from_str(&line)?;
                let request_id = request.get("id").cloned().unwrap_or(Value::Null);
                let method = request.get("method").and_then(Value::as_str).ok_or("RPC method")?;
                let params = request.get("params").cloned().unwrap_or(Value::Null);
                let result = dispatch(&terminals, &ctx, &id, method, params, &mut output).await;
                match result {
                    Ok(result) => json!({"jsonrpc":"2.0", "id":request_id, "result":result}),
                    Err(error) => json!({"jsonrpc":"2.0", "id":request_id, "error":error}),
                }
            }
            item = async { output.as_mut().expect("selected output").next().await }, if output.is_some() => {
                match item {
                    Some(Output::Bytes { offset, bytes }) => json!({"jsonrpc":"2.0", "method":"terminal.output",
                        "params": {"id":id, "offset":offset, "data":STANDARD.encode(&bytes)}}),
                    Some(Output::Gap { from, to }) => json!({"jsonrpc":"2.0", "method":"terminal.gap",
                        "params":{"id":id,"from":from,"to":to}}),
                    None => { output = None; continue; }
                }
            }
            event = events.recv() => {
                match event {
                    Ok(event) => json!({"jsonrpc":"2.0", "method":"event", "params":event}),
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => return Ok(()),
                }
            }
        };
        let mut bytes = serde_json::to_vec(&frame)?;
        bytes.push(b'\n');
        // A blocked socket slows this connection only; OutputStream reports any lost range.
        write.write_all(&bytes).await?;
    }
}

async fn dispatch(
    terminals: &Terminals,
    ctx: &Ctx,
    id: &str,
    method: &str,
    params: Value,
    output: &mut Option<OutputStream>,
) -> Result<Value, RpcError> {
    if method == "terminal.list" {
        let mut infos = terminals.list().await;
        if terminals.program_ended(id).await {
            for info in &mut infos {
                info.running = false;
                info.program_pid = None;
            }
        }
        return rpc::reply(&infos);
    }
    if method == "terminal.scheme" {
        return terminals.call(ctx, method, params).await;
    }
    if !matches!(
        method,
        "terminal.write"
            | "terminal.resize"
            | "terminal.kill"
            | "terminal.snapshot"
            | "terminal.catchUp"
            | "terminal.screen"
            | "terminal.read"
            | "terminal.search"
            | "terminal.output"
            | "terminal.outputStop"
    ) {
        return Err(RpcError::method_not_found(method));
    }
    if params.get("id").and_then(Value::as_str) != Some(id) {
        return Err(RpcError::not_found("owned Terminal"));
    }
    match method {
        "terminal.write" => {
            let params: contracts::terminal::WriteParams = rpc::params(params)?;
            let bytes = STANDARD
                .decode(params.data)
                .map_err(|error| crate::invalid(error.to_string()))?;
            terminals.write_completed(id, bytes).await?;
            Ok(Value::Null)
        }
        "terminal.kill" => {
            let handle = terminals.running(id)?;
            tokio::task::spawn_blocking(move || {
                let mut program = handle.program.lock().expect("terminal program lock");
                if program.try_wait().map_err(RpcError::internal)?.is_some() {
                    return Err(RpcError::not_found("running Terminal"));
                }
                let pid = program
                    .process_id()
                    .ok_or_else(|| RpcError::not_found("Terminal program"))?;
                let pid = i32::try_from(pid).map_err(RpcError::internal)?;
                // portable-pty establishes this child as its own session/process-group leader.
                // The unreaped original child, locked against the reaper, proves group ownership.
                nix::sys::signal::killpg(
                    nix::unistd::Pid::from_raw(pid),
                    nix::sys::signal::Signal::SIGKILL,
                )
                .map_err(RpcError::internal)?;
                drop(program);
                crate::reap(&handle.program).map_err(RpcError::internal)?;
                #[cfg(target_os = "linux")]
                loop {
                    match nix::sys::wait::waitpid(None, None) {
                        Ok(_) => {}
                        Err(nix::errno::Errno::EINTR) => continue,
                        Err(nix::errno::Errno::ECHILD) => break,
                        Err(err) => return Err(RpcError::internal(err)),
                    }
                }
                Ok(Value::Null)
            })
            .await
            .map_err(RpcError::internal)?
        }
        "terminal.output" => {
            let stream = terminals.subscribe_output(id)?;
            let offset = stream.start();
            *output = Some(stream);
            Ok(json!({"offset":offset}))
        }
        "terminal.outputStop" => {
            *output = None;
            Ok(Value::Null)
        }
        _ => terminals.call(ctx, method, params).await,
    }
}

fn report_connection(
    result: Result<Result<(), OpenError>, tokio::task::JoinError>,
) -> Result<(), OpenError> {
    // A disconnected/malformed client ends its own task, never the PTY owner.
    if let Err(err) = result? {
        let _ = writeln!(std::io::stderr(), "terminal owner connection ended: {err}");
    }
    Ok(())
}
