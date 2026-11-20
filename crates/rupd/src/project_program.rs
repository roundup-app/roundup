//! PG1–PG5: the one outside program a Project names runs in a Terminal on the Rail whenever the
//! Project is open, comes back after an exit the user did not ask for, and is attached again
//! after a Daemon restart instead of started twice.
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use backon::{BackoffBuilder, ExponentialBackoff, ExponentialBuilder};
use contracts::project::{ProgramRun, ProjectProgram};
use contracts::{Actor, EventData};
use parking_lot::Mutex;
use rpc::{RpcError, code};
use tokio::sync::Notify;
use tokio::time::Instant;

/// PG4: the first wait, doubled for each exit in a row, up to the cap.
const FIRST_WAIT: Duration = Duration::from_secs(1);
const MAX_WAIT: Duration = Duration::from_secs(30);
/// PG4: a program that ran this long counts as healthy: its next exit is a first one again.
const HEALTHY: Duration = Duration::from_secs(60);
const COLS: u16 = 80;
const ROWS: u16 = 24;

fn waits() -> ExponentialBackoff {
    ExponentialBuilder::default()
        .with_min_delay(FIRST_WAIT)
        .with_factor(2.0)
        .with_max_delay(MAX_WAIT)
        .with_max_times(usize::MAX)
        .build()
}

/// PG4: the wait after an exit that came `ran` after the last start: a healthy run starts the
/// waits over.
fn next_wait(backoff: &mut ExponentialBackoff, ran: Duration) -> Duration {
    if ran >= HEALTHY {
        *backoff = waits();
    }
    backoff.next().unwrap_or(MAX_WAIT)
}

#[derive(Clone, Default)]
enum Phase {
    #[default]
    Down,
    Running(String),
    Waiting {
        at_ms: i64,
        kick: Arc<Notify>,
    },
}

#[derive(Default)]
struct State {
    /// Each start, stop or end of a wait begins a new epoch; a supervisor of an older one ends.
    epoch: u64,
    phase: Phase,
    /// D1: the Daemon is shutting down; nothing restarts.
    shut: bool,
}

/// PG5: what a reopened Daemon needs to attach the program's Terminal again.
#[derive(serde::Serialize, serde::Deserialize)]
struct Kept {
    core_id: String,
    cwd: String,
    program: String,
    machine: Option<String>,
    entry: ProjectProgram,
}

pub(crate) struct ProgramHost {
    terminals: Arc<terminal::Terminals>,
    agents: Arc<agents::Agents>,
    bus: rpc::Bus,
    record: PathBuf,
    /// One start, stop or restart at a time.
    ops: tokio::sync::Mutex<()>,
    state: Mutex<State>,
}

/// PG1: the entry's `argv` and `dir` are well formed and `dir` stays inside `project` after
/// resolution; the resolved directory is returned.
pub(crate) fn check(project: &Path, entry: &ProjectProgram) -> Result<PathBuf, String> {
    if entry.argv.is_empty() || entry.argv.iter().any(String::is_empty) {
        return Err("the command is a non-empty list of non-empty words".into());
    }
    let dir = Path::new(&entry.dir);
    if dir.is_absolute()
        || dir
            .components()
            .any(|part| matches!(part, std::path::Component::ParentDir))
    {
        return Err("the folder is inside the Project folder".into());
    }
    let root =
        std::fs::canonicalize(project).map_err(|err| format!("the Project folder: {err}"))?;
    let resolved = std::fs::canonicalize(root.join(dir))
        .map_err(|err| format!("the folder {:?}: {err}", entry.dir))?;
    if !resolved.starts_with(&root) || !resolved.is_dir() {
        return Err("the folder is a folder inside the Project folder".into());
    }
    Ok(resolved)
}

impl ProgramHost {
    pub(crate) fn new(
        terminals: Arc<terminal::Terminals>,
        agents: Arc<agents::Agents>,
        bus: rpc::Bus,
        data_dir: &Path,
    ) -> Self {
        Self {
            terminals,
            agents,
            bus,
            record: data_dir.join("project-program.json"),
            ops: Default::default(),
            state: Default::default(),
        }
    }

    pub(crate) fn run(&self) -> ProgramRun {
        let named = matches!(self.agents.project_program(), Ok(Some(_)));
        match &self.state.lock().phase {
            Phase::Running(terminal_id) => ProgramRun::Running {
                terminal_id: terminal_id.clone(),
            },
            Phase::Waiting { at_ms, .. } => ProgramRun::Restarting { restart_at: *at_ms },
            Phase::Down if !named => ProgramRun::None,
            Phase::Down => ProgramRun::Stopped,
        }
    }

    fn changed(&self) {
        self.bus.emit(Actor::daemon(), EventData::TerminalChanged);
    }

    fn current(&self, epoch: u64) -> bool {
        let state = self.state.lock();
        state.epoch == epoch && !state.shut
    }

    /// Begin a new epoch, ending the supervisor and the wait of the last.
    fn advance(&self) -> u64 {
        let mut state = self.state.lock();
        state.epoch += 1;
        if let Phase::Waiting { kick, .. } = &state.phase {
            kick.notify_one();
        }
        state.epoch
    }

    /// PG2: the Daemon opened the Project: attach the program that outlived the last Daemon, or
    /// start one, unless the Project names none, is a Fork or the user stopped it.
    pub(crate) async fn open(self: &Arc<Self>) {
        let _ops = self.ops.lock().await;
        let kept = std::fs::read(&self.record)
            .ok()
            .and_then(|body| serde_json::from_slice::<Kept>(&body).ok());
        let entry = match self.agents.project_program() {
            Ok(entry) => entry,
            Err(err) => {
                return eprintln!("rupd: the Project program is unreadable: {}", err.message);
            }
        };
        let stopped = self.agents.project_program_stopped().unwrap_or(false);
        if self.agents.is_fork() || entry.is_none() || stopped {
            let _ = std::fs::remove_file(&self.record);
            return;
        }
        let epoch = self.advance();
        let attached = match kept {
            Some(kept) => self.attach(kept, entry.as_ref()).await,
            None => None,
        };
        let terminal = match attached {
            Some(terminal) => Ok(terminal),
            None => {
                let _ = std::fs::remove_file(&self.record);
                self.launch(epoch).await
            }
        };
        match terminal {
            Ok(terminal) => self.supervise(epoch, Some(terminal)),
            Err(err) => {
                eprintln!("rupd: the Project program did not start: {}", err.message);
                self.supervise(epoch, None);
            }
        }
    }

    /// PG5: attach the kept Terminal when it is this entry's and alive; a replaced entry's copy
    /// is ended, so exactly one runs.
    async fn attach(&self, kept: Kept, entry: Option<&ProjectProgram>) -> Option<String> {
        let adopted = terminal::Adopted {
            cwd: kept.cwd.clone(),
            cols: COLS,
            rows: ROWS,
            program: kept.program.clone(),
            machine: kept.machine.clone(),
        };
        let owner = self.agents.project_path().to_string_lossy().into_owned();
        let spawned = self
            .terminals
            .reattach(&kept.core_id, adopted, Some(owner))
            .await
            .ok()?;
        if Some(&kept.entry) != entry {
            let _ = self.terminals.close(&spawned.id).await;
            return None;
        }
        self.phase(Phase::Running(spawned.id.clone()));
        Some(spawned.id)
    }

    fn phase(&self, phase: Phase) {
        self.state.lock().phase = phase;
        self.changed();
    }

    /// PG2: start the entry now stored in a Terminal owned by the Project, with no input.
    /// The caller holds `ops` and has begun `epoch`.
    async fn launch(&self, epoch: u64) -> Result<String, RpcError> {
        let entry = self
            .agents
            .project_program()?
            .ok_or_else(|| RpcError::conflict("the Project names no program"))?;
        let project = self.agents.project_path().to_path_buf();
        let dir = check(&project, &entry)
            .map_err(|message| RpcError::new(code::INVALID_PARAMS, message))?;
        let mut env = std::collections::BTreeMap::new();
        if let Ok(socket) = rpc::socket_path() {
            env.insert(
                "RUPD_SOCKET".to_owned(),
                socket.to_string_lossy().into_owned(),
            );
        }
        if let Some(path) = self.agents.program_path() {
            env.insert("PATH".to_owned(), path.to_string_lossy().into_owned());
        }
        let owner = project.to_string_lossy().into_owned();
        let spawned = self
            .terminals
            .spawn_owned(
                contracts::terminal::SpawnParams {
                    cwd: dir.to_string_lossy().into_owned(),
                    command: Some(entry.argv.clone()),
                    env,
                    unset: vec!["ROUNDUP_AGENT_ID".into(), "ROUNDUP_AGENT".into()],
                    cols: COLS,
                    rows: ROWS,
                    machine: None,
                },
                &owner,
            )
            .await?;
        if let Ok(Some((core_id, adopted))) = self.terminals.core_record(&spawned.id) {
            let kept = Kept {
                core_id,
                cwd: adopted.cwd,
                program: adopted.program,
                machine: adopted.machine,
                entry,
            };
            if let Ok(body) = serde_json::to_vec(&kept) {
                let _ = std::fs::write(&self.record, body);
            }
        }
        let kept_running = {
            let mut state = self.state.lock();
            let live = state.epoch == epoch && !state.shut;
            if live {
                state.phase = Phase::Running(spawned.id.clone());
            }
            live
        };
        if !kept_running {
            let _ = self.terminals.close(&spawned.id).await;
            return Err(RpcError::conflict(
                "the program was stopped while it started",
            ));
        }
        self.changed();
        Ok(spawned.id)
    }

    /// PG4: wait for the program to end, wait as long as the exits in a row ask, start it again.
    /// One timer waits at a time; the task ends when its epoch does.
    fn supervise(self: &Arc<Self>, epoch: u64, mut terminal: Option<String>) {
        let host = Arc::clone(self);
        tokio::spawn(async move {
            let mut backoff = waits();
            let mut began = Instant::now();
            loop {
                if let Some(id) = terminal.take() {
                    host.terminals.wait_program_ended(&id).await;
                    if !host.current(epoch) {
                        return;
                    }
                    let _ = host.terminals.close(&id).await;
                }
                let wait = next_wait(&mut backoff, began.elapsed());
                let kick = Arc::new(Notify::new());
                {
                    let mut state = host.state.lock();
                    if state.epoch != epoch || state.shut {
                        return;
                    }
                    state.phase = Phase::Waiting {
                        at_ms: provenance::now_ms() + wait.as_millis() as i64,
                        kick: Arc::clone(&kick),
                    };
                }
                let _ = std::fs::remove_file(&host.record);
                host.changed();
                tokio::select! {
                    () = tokio::time::sleep(wait) => {}
                    () = kick.notified() => {}
                }
                let _ops = host.ops.lock().await;
                if !host.current(epoch) {
                    return;
                }
                match host.agents.project_program() {
                    Ok(Some(_)) => {}
                    _ => {
                        host.phase(Phase::Down);
                        return;
                    }
                }
                match host.launch(epoch).await {
                    Ok(id) => {
                        terminal = Some(id);
                        began = Instant::now();
                    }
                    Err(err) => {
                        eprintln!("rupd: the Project program did not restart: {}", err.message)
                    }
                }
            }
        });
    }

    /// PG3: the user starts it; it ends a wait at once and is `CONFLICT` while it runs.
    pub(crate) async fn start(self: &Arc<Self>) -> Result<(), RpcError> {
        let _ops = self.ops.lock().await;
        if self.agents.project_program()?.is_none() {
            return Err(RpcError::conflict("the Project names no program"));
        }
        if matches!(self.state.lock().phase, Phase::Running(_)) {
            return Err(RpcError::conflict("the program is running"));
        }
        self.agents.store_project_program_stopped(false)?;
        let epoch = self.advance();
        match self.launch(epoch).await {
            Ok(id) => {
                self.supervise(epoch, Some(id));
                Ok(())
            }
            Err(err) => {
                self.supervise(epoch, None);
                Err(err)
            }
        }
    }

    /// PG3: the user stops it; nothing restarts it until the user starts it, across a restart too.
    pub(crate) async fn stop(&self) -> Result<(), RpcError> {
        let _ops = self.ops.lock().await;
        if self.agents.project_program()?.is_none() {
            return Err(RpcError::conflict("the Project names no program"));
        }
        self.agents.store_project_program_stopped(true)?;
        self.advance();
        let running = match std::mem::take(&mut self.state.lock().phase) {
            Phase::Running(id) => Some(id),
            _ => None,
        };
        let _ = std::fs::remove_file(&self.record);
        if let Some(id) = running {
            self.terminals.close(&id).await?;
        }
        self.changed();
        Ok(())
    }

    /// PG1, PG4: the entry was cleared: a running program stays, a wait is dropped.
    pub(crate) async fn cleared(&self) {
        let _ops = self.ops.lock().await;
        let waiting = matches!(self.state.lock().phase, Phase::Waiting { .. });
        if waiting {
            self.advance();
            self.phase(Phase::Down);
        }
    }

    /// D1: the Daemon is shutting down and ends the program with every Terminal; restart nothing.
    pub(crate) fn shut_down(&self) {
        let mut state = self.state.lock();
        state.shut = true;
        if let Phase::Waiting { kick, .. } = &state.phase {
            kick.notify_one();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Daemon;

    #[test]
    fn pg4_a_second_kill_in_a_row_waits_longer_and_the_wait_is_capped() {
        let mut backoff = waits();
        let quick = Duration::from_secs(1);
        let seen: Vec<u64> = (0..8)
            .map(|_| next_wait(&mut backoff, quick).as_secs())
            .collect();
        assert_eq!(seen, [1, 2, 4, 8, 16, 30, 30, 30]);
    }

    #[test]
    fn pg4_a_healthy_run_resets_the_wait() {
        let mut backoff = waits();
        let quick = Duration::from_secs(1);
        for _ in 0..4 {
            next_wait(&mut backoff, quick);
        }
        assert_eq!(next_wait(&mut backoff, HEALTHY).as_secs(), 1);
        assert_eq!(next_wait(&mut backoff, quick).as_secs(), 2);
    }

    const SCRIPT: &str = "echo started >> ../started.txt; exec sleep 600";

    fn entry(script: &str) -> ProjectProgram {
        ProjectProgram {
            argv: vec!["sh".into(), "-c".into(), script.into()],
            dir: "work".into(),
        }
    }

    async fn started(project: &Path, count: usize) {
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        let mut watcher = notify::recommended_watcher(move |_| {
            let _ = tx.send(());
        })
        .unwrap();
        notify::Watcher::watch(&mut watcher, project, notify::RecursiveMode::NonRecursive).unwrap();
        let lines = || {
            std::fs::read_to_string(project.join("started.txt"))
                .unwrap_or_default()
                .lines()
                .count()
        };
        tokio::time::timeout(Duration::from_secs(15), async {
            while lines() < count {
                rx.recv().await.unwrap();
            }
        })
        .await
        .unwrap_or_else(|_| panic!("the program did not write {count} start(s)"));
    }

    /// A Daemon reopened over the same core: a second host over the first's Terminals stands for
    /// it, since a test core belongs to one `Terminals`.
    async fn world() -> (
        tempfile::TempDir,
        tempfile::TempDir,
        Daemon,
        Arc<ProgramHost>,
    ) {
        let project = tempfile::tempdir().unwrap();
        std::fs::create_dir(project.path().join("work")).unwrap();
        let data = tempfile::tempdir().unwrap();
        let (daemon, _watchers) = Daemon::open_project(project.path(), data.path()).unwrap();
        daemon
            .agents
            .store_project_program(Some(&entry(SCRIPT)))
            .unwrap();
        daemon.program.start().await.unwrap();
        started(project.path(), 1).await;
        let dir = crate::data::project_data(data.path(), project.path()).unwrap();
        let reopened = Arc::new(ProgramHost::new(
            Arc::clone(&daemon.terminals),
            Arc::clone(&daemon.agents),
            daemon.bus.clone(),
            &dir,
        ));
        (project, data, daemon, reopened)
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn pg5_a_surviving_program_is_attached_and_nothing_is_launched() {
        let (project, _data, _daemon, reopened) = world().await;
        reopened.open().await;
        assert!(matches!(reopened.run(), ProgramRun::Running { .. }));
        tokio::time::sleep(Duration::from_millis(500)).await;
        assert_eq!(
            std::fs::read_to_string(project.path().join("started.txt"))
                .unwrap()
                .lines()
                .count(),
            1
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn pg5_a_replaced_entry_ends_the_survivor_and_starts_the_new_one() {
        let (project, _data, daemon, reopened) = world().await;
        daemon
            .agents
            .store_project_program(Some(&entry(&SCRIPT.replace("600", "601"))))
            .unwrap();
        reopened.open().await;
        started(project.path(), 2).await;
        assert!(matches!(reopened.run(), ProgramRun::Running { .. }));
    }
}
