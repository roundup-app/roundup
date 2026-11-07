//! MC11's herdr-core arm: cold start, keystroke-to-render and ten idle Terminals with the
//! Terminals hosted by a local herdr-core, as the spike's `corebench` measured them. Prints
//! the median of `--runs` fresh cores as JSON next to `just perf`'s PTY numbers; no budget is
//! changed and no Terminal of roundup is switched.
#![deny(clippy::unwrap_used, clippy::expect_used)]
#![deny(clippy::panic, clippy::indexing_slicing)]
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]
#![cfg_attr(test, allow(clippy::panic, clippy::indexing_slicing))]
use std::io::{BufRead, BufReader, Read, Write};
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitCode, Stdio};
use std::time::{Duration, Instant};

use clap::Parser;
use serde_json::{Value, json};
use sysinfo::{Pid, ProcessesToUpdate, System};

type Res<T> = Result<T, String>;

/// Measure herdr-core as the local Terminal host against rule 7.
#[derive(Parser)]
struct Args {
    /// The herdr-core binary.
    #[arg(long, default_value = "herdr-core")]
    core: PathBuf,
    /// Arguments that start a core serving `--socket`.
    #[arg(long, default_value = "serve")]
    serve: String,
    /// The core's Unix socket; removed before each run.
    #[arg(long)]
    socket: PathBuf,
    /// The Terminal's program; a PTY echoes what it is sent, so `cat` suffices.
    #[arg(long, default_value = "cat")]
    agent: String,
    #[arg(long, default_value_t = 11)]
    runs: usize,
    #[arg(long, default_value_t = 200)]
    keys: usize,
    #[arg(long, default_value_t = 10)]
    terminals: usize,
    #[arg(long, default_value = "target/perf-herdr.json")]
    out: PathBuf,
}

fn frame(ch: u32, kind: u8, p: &[u8]) -> Vec<u8> {
    let mut v = ch.to_le_bytes().to_vec();
    v.push(kind);
    v.extend((p.len() as u32).to_le_bytes());
    v.extend(p);
    v
}

/// One frame: (channel, kind, payload).
fn read_frame(r: &mut impl Read) -> Res<(u32, u8, Vec<u8>)> {
    let mut h = [0u8; 9];
    r.read_exact(&mut h).map_err(|e| e.to_string())?;
    let [a, b, c, d, kind, e, f, g, i] = h;
    let mut p = vec![0u8; u32::from_le_bytes([e, f, g, i]) as usize];
    r.read_exact(&mut p).map_err(|e| e.to_string())?;
    Ok((u32::from_le_bytes([a, b, c, d]), kind, p))
}

fn percentile(ms: &mut [f64], pct: usize) -> f64 {
    ms.sort_by(f64::total_cmp);
    ms.get((ms.len() * pct / 100).min(ms.len().saturating_sub(1)))
        .copied()
        .unwrap_or(f64::NAN)
}

struct Conn {
    s: UnixStream,
    r: BufReader<UnixStream>,
    id: u64,
}

impl Conn {
    /// Dial the socket and say hello in framed mode (generation 1).
    fn open(socket: &Path) -> Res<Conn> {
        let mut s = UnixStream::connect(socket).map_err(|e| e.to_string())?;
        let mut r = BufReader::new(s.try_clone().map_err(|e| e.to_string())?);
        let hello = r#"{"jsonrpc":"2.0","id":0,"method":"hello","params":{"generation":1,"framed":true}}"#;
        writeln!(s, "{hello}").map_err(|e| e.to_string())?;
        r.read_line(&mut String::new()).map_err(|e| e.to_string())?;
        Ok(Conn { s, r, id: 0 })
    }

    fn call(&mut self, method: &str, params: Value) -> Res<Value> {
        self.id += 1;
        let body = json!({"jsonrpc":"2.0","id":self.id,"method":method,"params":params});
        self.s
            .write_all(&frame(0, 0, body.to_string().as_bytes()))
            .map_err(|e| e.to_string())?;
        loop {
            let (ch, _, p) = read_frame(&mut self.r)?;
            if ch != 0 {
                continue;
            }
            let v: Value = serde_json::from_slice(&p).map_err(|e| e.to_string())?;
            if v.get("id") == Some(&json!(self.id)) {
                return v
                    .get("result")
                    .cloned()
                    .ok_or_else(|| format!("{method}: {v}"));
            }
        }
    }

    fn run(&mut self, name: &str, agent: &str) -> Res<()> {
        let size = json!({"cols":100,"rows":30});
        let env = json!({"TERM":"xterm-256color"});
        let params = json!({"argv":[agent],"cwd":"/tmp","env":env,"name":name,"size":size});
        self.call("terminal.run", params).map(drop)
    }

    /// Attach and return the data channel.
    fn attach(&mut self, name: &str) -> Res<u32> {
        let r = self.call("terminal.attach", json!({"terminal":name,"cols":100,"rows":30}))?;
        let ch = r.get("channel").and_then(Value::as_u64).ok_or("attach: no channel")?;
        u32::try_from(ch).map_err(|e| e.to_string())
    }

    /// Read DATA frames of `ch` until one holds `byte`.
    fn until(&mut self, ch: u32, byte: u8) -> Res<()> {
        loop {
            let (c, kind, p) = read_frame(&mut self.r)?;
            if c == ch && kind == 0 && p.contains(&byte) {
                return Ok(());
            }
        }
    }

    /// Drain the first paint until the stream is quiet for 300 ms.
    fn settle(&mut self) -> Res<()> {
        self.s
            .set_read_timeout(Some(Duration::from_millis(300)))
            .map_err(|e| e.to_string())?;
        while read_frame(&mut self.r).is_ok() {}
        self.s.set_read_timeout(None).map_err(|e| e.to_string())
    }
}

/// A core started from a clean environment (MC16), killed on drop.
struct Core(Child);

impl Core {
    fn start(a: &Args) -> Res<Core> {
        let _ = std::fs::remove_file(&a.socket);
        let path = std::env::var("PATH").unwrap_or_default();
        let home = std::env::var("HOME").unwrap_or_default();
        let child = Command::new("env")
            .args(["-i", &format!("PATH={path}"), &format!("HOME={home}")])
            .arg(&a.core)
            .args(a.serve.split_whitespace())
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(Core(child))
    }

    /// Opens the core's socket, retrying on each change in its directory until it answers or 10 s pass.
    fn dial(&self, socket: &Path) -> Res<Conn> {
        use notify::Watcher;
        let dir = socket.parent().unwrap_or(Path::new("."));
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        let (tx, rx) = std::sync::mpsc::channel();
        let mut watcher = notify::recommended_watcher(move |_| {
            let _ = tx.send(());
        })
        .map_err(|e| e.to_string())?;
        watcher.watch(dir, notify::RecursiveMode::NonRecursive).map_err(|e| e.to_string())?;
        let end = Instant::now() + Duration::from_secs(10);
        loop {
            match Conn::open(socket) {
                Ok(c) => return Ok(c),
                Err(e) if Instant::now() > end => return Err(format!("no core socket: {e}")),
                Err(_) => {
                    let _ = rx.recv_timeout(end.saturating_duration_since(Instant::now()));
                }
            }
        }
    }
}

impl Drop for Core {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

/// Resident MB of `root`'s tree (the core, its serve and hold processes, the Terminals) and of this process.
fn rss_mb(sys: &mut System, root: u32) -> f64 {
    sys.refresh_processes(ProcessesToUpdate::All, true);
    let mut tree = vec![Pid::from_u32(root)];
    let mut i = 0;
    while let Some(&p) = tree.get(i) {
        tree.extend(sys.processes().values().filter(|q| q.parent() == Some(p)).map(|q| q.pid()));
        i += 1;
    }
    tree.push(Pid::from_u32(std::process::id()));
    let bytes: u64 = tree.iter().filter_map(|p| sys.process(*p)).map(|p| p.memory()).sum();
    bytes as f64 / 1_048_576.0
}

struct Sample {
    cold_start_ms: f64,
    keystroke_p95_ms: f64,
    rss_extra_mb: f64,
}

fn one_run(a: &Args) -> Res<Sample> {
    let t = Instant::now();
    let core = Core::start(a)?;
    let mut c = core.dial(&a.socket)?;
    c.run("cold", &a.agent)?;
    let ch = c.attach("cold")?;
    c.s.write_all(&frame(ch, 0, b"x")).map_err(|e| e.to_string())?;
    c.until(ch, b'x')?;
    let cold_start_ms = t.elapsed().as_secs_f64() * 1e3;

    c.settle()?;
    let mut ms = Vec::new();
    for _ in 0..a.keys {
        let t = Instant::now();
        c.s.write_all(&frame(ch, 0, b"x")).map_err(|e| e.to_string())?;
        c.until(ch, b'x')?;
        ms.push(t.elapsed().as_secs_f64() * 1e3);
    }

    let mut sys = System::new();
    let before = rss_mb(&mut sys, core.0.id());
    let mut open = vec![c];
    for n in 0..a.terminals {
        let mut c = core.dial(&a.socket)?;
        let name = format!("idle{n}");
        c.run(&name, &a.agent)?;
        c.attach(&name)?;
        c.settle()?;
        open.push(c);
    }
    let rss_extra_mb = rss_mb(&mut sys, core.0.id()) - before;
    Ok(Sample { cold_start_ms, keystroke_p95_ms: percentile(&mut ms, 95), rss_extra_mb })
}

fn median(mut v: Vec<f64>) -> f64 {
    percentile(&mut v, 50)
}

fn main() -> ExitCode {
    let a = Args::parse();
    let mut samples = Vec::new();
    for _ in 0..a.runs {
        match one_run(&a) {
            Ok(s) => samples.push(s),
            Err(e) => {
                eprintln!("perf-herdr: {e}");
                return ExitCode::from(2);
            }
        }
    }
    let pick = |f: fn(&Sample) -> f64| median(samples.iter().map(f).collect());
    let (cold, key, rss) = (pick(|s| s.cold_start_ms), pick(|s| s.keystroke_p95_ms), pick(|s| s.rss_extra_mb));
    let report = json!({
        "runs": a.runs,
        "cold_start_ms": cold,
        "write_to_output_p95_ms": key,
        "rss_extra_mb": rss,
        "limits": {"cold_start_ms": 300, "write_to_output_p95_ms": 16, "rss_extra_mb": 150},
    });
    println!("{report:#}");
    if let Err(e) = std::fs::write(&a.out, report.to_string()) {
        eprintln!("perf-herdr: {}: {e}", a.out.display());
        return ExitCode::from(2);
    }
    // NaN fails: a metric that was not measured is not a pass.
    ExitCode::from(u8::from(!(cold < 300.0 && key < 16.0 && rss < 150.0)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mc11_frame_round_trips_and_percentile_picks_the_rank() {
        let bytes = frame(7, 1, b"abc");
        let (ch, kind, p) = read_frame(&mut bytes.as_slice()).unwrap();
        assert_eq!((ch, kind, p.as_slice()), (7, 1, &b"abc"[..]));
        let mut v: Vec<f64> = (1..=100).map(f64::from).collect();
        assert_eq!(percentile(&mut v, 95), 96.0);
        assert_eq!(median(vec![3.0, 1.0, 2.0]), 2.0);
    }
}
