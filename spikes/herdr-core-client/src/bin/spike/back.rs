//! Q11 back channel, Q12 away, Q13 hibernate.
use super::*;
use std::process::{Child, Stdio};

pub(crate) struct Rupd(Child);
impl Rupd {
    pub(crate) fn start(args: &[&str]) -> Rupd {
        let log = work().join("rupd.log");
        let _ = std::fs::remove_file(&log);
        let c = Command::new(exe("fake-rupd"))
            .arg(work().join("rupd.sock"))
            .arg(&log)
            .args(args)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        std::thread::sleep(Duration::from_millis(300));
        Rupd(c)
    }
}
impl Drop for Rupd {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

/// Mac side of the back channel: `bridge` dials in over ssh (boxd cannot realise `ssh -R`, see Q11).
pub(crate) struct Bridge {
    child: Option<Child>,
}
impl Bridge {
    pub(crate) fn start() -> Bridge {
        let up = work().join("bridge.up");
        let _ = std::fs::remove_file(&up);
        let child = Command::new(exe("bridge"))
            .arg(work().join("rupd.sock"))
            .env("BRIDGE_UP", &up)
            .stderr(Stdio::inherit())
            .spawn()
            .unwrap();
        for _ in 0..100 {
            std::thread::sleep(Duration::from_millis(100));
            if up.exists() {
                break;
            }
        }
        std::thread::sleep(Duration::from_millis(1500)); // ssh connect + socat attach
        Bridge { child: Some(child) }
    }
    fn ssh_pid(&self) -> String {
        std::fs::read_to_string(work().join("bridge.up")).unwrap_or_default()
    }
    /// Kill the bridge and its ssh: the Mac side of the link is gone.
    pub(crate) fn kill(&mut self) {
        let pid = self.ssh_pid();
        sh(&format!("kill {pid} 2>/dev/null; true"));
        if let Some(mut c) = self.child.take() {
            let _ = c.kill();
            let _ = c.wait();
        }
    }
    /// Pause the ssh process: the connection stays open but carries nothing.
    pub(crate) fn pause(&self) {
        sh(&format!("kill -STOP {}", self.ssh_pid()));
    }
    pub(crate) fn resume(&self) {
        sh(&format!("kill -CONT {}", self.ssh_pid()));
    }
}
impl Drop for Bridge {
    fn drop(&mut self) {
        self.kill();
    }
}

/// The machine-side queue daemon, started fresh (empty spool).
pub(crate) fn start_queue() {
    remote("pkill fqueue; sleep 0.3; rm -rf ~/.rupq; (setsid nohup fqueue >/tmp/fqueue.log 2>&1 &) ; sleep 0.5; pgrep -c fqueue");
}

fn log_lines() -> Vec<String> {
    std::fs::read_to_string(work().join("rupd.log")).unwrap_or_default().lines().map(str::to_owned).collect()
}

pub(crate) async fn q11() -> Result<()> {
    let _rupd = Rupd::start(&["dedup"]);
    // 1. The asked-for path: ssh -R to a Unix socket, then to a TCP port.
    let probe = |spec: &str| {
        sh(&format!("timeout 8 ssh -v -N -T -o BatchMode=yes -o ExitOnForwardFailure=yes -o StreamLocalBindUnlink=yes -R {spec} {} 2>&1 | grep -E 'remote forward|Remote protocol|SSH-2.0|forwarding failed' | sort -u | head -4", herdr_core_client_spike::HOST))
    };
    proof!("q11", "ssh -R <unix socket>: {}", probe(&format!("/home/boxd/rupd.sock:{}", work().join("rupd.sock").display())).trim().replace('\n', " | "));
    let tcp = sh(&format!("ssh -T -o BatchMode=yes -o ExitOnForwardFailure=yes -R 127.0.0.1:19999:{} {} 'sleep 1; echo listeners-on-19999=$(ss -ltn | grep -c :19999); bash -c \"exec 3<>/dev/tcp/127.0.0.1/19999\" 2>&1 | head -1; echo connect-exit=$?' 2>&1", work().join("rupd.sock").display(), herdr_core_client_spike::HOST));
    proof!("q11", "ssh -R 127.0.0.1:19999 (TCP), checked from inside the machine while the ssh session lives: {}", tcp.trim().replace('\n', " | "));
    proof!("q11", "server banner: {}", sh(&format!("ssh -v -o BatchMode=yes {} true 2>&1 | grep -m1 'Remote protocol version'", herdr_core_client_spike::HOST)).trim());
    // 2. The substitute: the Mac dials in, the machine keeps a socket for hooks (fqueue).
    start_queue();
    let mut br = Bridge::start();
    let one = remote("echo '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\"}' | fshim");
    proof!("q11", "stdio shim (fake rup mcp) one call through fqueue + bridge: {}", one.trim());
    for l in remote("fshim bench 300").lines() {
        proof!("q11", "on machine, JSON-RPC stdio shim, live ping through ssh bridge: {l}");
    }
    for l in remote("fsignal bench 300").lines() {
        proof!("q11", "on machine, fake rup signal, queued report, to the durable ack: {l}");
    }
    let out = remote("python3 -c \"\nimport subprocess,time\nts=[]\nfor i in range(100):\n    t=time.perf_counter(); subprocess.run(['fsignal','direct','exec',str(i)],check=True); ts.append((time.perf_counter()-t)*1e3)\nts.sort(); print('fsignal direct (live, to rupd and back) as a process n=100 p50=%.2fms p95=%.2fms' % (ts[50], ts[95]))\nts=[]\nfor i in range(100):\n    t=time.perf_counter(); subprocess.run(['fsignal','send','exec',str(1000+i)],check=True); ts.append((time.perf_counter()-t)*1e3)\nts.sort(); print('fsignal send (queued, fsync) as a process n=100 p50=%.2fms p95=%.2fms' % (ts[50], ts[95]))\n\"");
    for l in out.lines() {
        proof!("q11", "{l}");
    }
    // Pure ssh round trip for reference.
    let t = Instant::now();
    for _ in 0..20 {
        remote("true");
    }
    proof!("q11", "reference: new ssh session running `true` takes {:?} each (includes connect + auth)", t.elapsed() / 20);
    // 3. An agent started by herdr-core terminal.run reaches rupd end to end.
    let c = Conn::connect().await?;
    kill_all(&c).await;
    let id = run_agent(&c, "q11", json!({}), false).await?;
    let (_, mut s) = c.attach(&id, 100, 30, json!({"observe":true})).await?;
    let mut b = Vec::new();
    until(&mut s, &mut b, "ready> ", Duration::from_secs(10)).await;
    c.call("terminal.send", json!({"terminal":id,"text":"report 5 100 direct","force":true})).await?;
    until(&mut s, &mut b, "reported 005", Duration::from_secs(10)).await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    let from_agent: Vec<String> = log_lines().into_iter().filter(|l| l.contains("agent-1:")).collect();
    proof!("q11", "agent started by herdr-core terminal.run, live reports to rupd via bridge: {} receipts: {:?}", from_agent.len(), from_agent.iter().map(|l| l.split(' ').nth(1).unwrap_or("")).collect::<Vec<_>>());
    proof!("q11", "agent-side lines: {:?}", text(&b).lines().filter(|l| l.starts_with("reported")).map(|l| l.trim_end().to_owned()).collect::<Vec<_>>());
    // 4. Link killed, live call while away fails loud.
    br.kill();
    tokio::time::sleep(Duration::from_secs(1)).await;
    proof!("q11", "bridge killed, live call from machine: {}", remote("fsignal direct away 1 2>&1; echo exit=$?").trim().replace('\n', " | "));
    kill_all(&c).await;
    Ok(())
}

struct Outcome {
    lost: Vec<u32>,
    doubled: Vec<(u32, usize)>,
    receipts: usize,
    suppressed: usize,
}

fn analyse() -> Outcome {
    let lines = log_lines();
    let mut applied = std::collections::BTreeMap::<u32, usize>::new();
    let (mut receipts, mut suppressed) = (0, 0);
    for l in &lines {
        let mut p = l.split(' ');
        let (_, id, how) = (p.next(), p.next().unwrap_or(""), p.next().unwrap_or(""));
        let Some(seq) = id.strip_prefix("agent-1:").and_then(|n| n.parse::<u32>().ok()) else { continue };
        receipts += 1;
        if how == "applied" {
            *applied.entry(seq).or_default() += 1;
        } else {
            suppressed += 1;
        }
    }
    Outcome {
        lost: (1..=100).filter(|k| !applied.contains_key(k)).collect(),
        doubled: applied.iter().filter(|(_, n)| **n > 1).map(|(k, n)| (*k, *n)).collect(),
        receipts,
        suppressed,
    }
}

async fn scenario(name: &str, mode: &str, rupd_args: &[&str], fault: &str) -> Result<()> {
    let rupd = Rupd::start(rupd_args);
    start_queue();
    let mut f = Bridge::start();
    let c = Conn::connect().await?;
    kill_all(&c).await;
    let id = run_agent(&c, "q12", json!({}), false).await?;
    let (_, mut s) = c.attach(&id, 100, 30, json!({"observe":true})).await?;
    let mut b = Vec::new();
    until(&mut s, &mut b, "ready> ", Duration::from_secs(10)).await;
    // 100 reports, 50 ms apart (about 5 s). The away window opens at about report 30.
    c.call("terminal.send", json!({"terminal":id,"text":format!("report 100 50 {mode}"),"force":true})).await?;
    tokio::time::sleep(Duration::from_millis(1500)).await;
    let at_fault = log_lines().len();
    let t_fault = Instant::now();
    let mut f_stopped = false;
    match fault {
        "kill" => f.kill(),
        "stop" => {
            f.pause();
            f_stopped = true;
        }
        _ => {}
    }
    tokio::time::sleep(Duration::from_secs(4)).await; // away
    let during = log_lines().len();
    match fault {
        "kill" => f = Bridge::start(),
        "stop" => {
            f.resume();
            f_stopped = false;
        }
        _ => {}
    }
    let away = t_fault.elapsed();
    let _ = f_stopped;
    // Wait for the agent to finish and the spool to drain.
    until(&mut s, &mut b, "reported 100", Duration::from_secs(20)).await;
    let end = Instant::now() + Duration::from_secs(40);
    while Instant::now() < end && analyse().lost.len() > 0 && mode == "send" {
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    tokio::time::sleep(Duration::from_secs(3)).await;
    let o = analyse();
    let agent_failures = text(&b).lines().filter(|l| l.starts_with("reported") && !l.contains("Ok(ExitStatus(unix_wait_status(0)))")).count();
    let spool_left = remote("cat ~/.rupq/spool 2>/dev/null | wc -l").trim().to_owned();
    proof!("q12", "[{name}] mode={mode} rupd={rupd_args:?} fault={fault} away {:?}: receipts at fault={at_fault}, during away={} | lost={} {:?} | doubled(applied twice)={} {:?} | raw receipts={} duplicates suppressed by rupd={} | hooks that exited nonzero (fail loud)={agent_failures} | spool lines left on machine={spool_left}", away, during - at_fault, o.lost.len(), &o.lost[..o.lost.len().min(12)], o.doubled.len(), &o.doubled[..o.doubled.len().min(12)], o.receipts, o.suppressed);
    f.kill();
    drop(rupd);
    kill_all(&c).await;
    Ok(())
}

pub(crate) async fn q12() -> Result<()> {
    scenario("S0 baseline, link up", "direct", &[], "none").await?;
    scenario("S1 no queue, link killed", "direct", &[], "kill").await?;
    scenario("S2 spool, link killed, rupd keeps no ids", "send", &[], "kill").await?;
    scenario("S3 spool, link paused (kill -STOP), rupd keeps no ids", "send", &[], "stop").await?;
    scenario("S4 spool, link paused, rupd dedups by id", "send", &["dedup"], "stop").await?;
    scenario("S5 spool, link killed, rupd dedups by id", "send", &["dedup"], "kill").await?;
    scenario("S6 spool, link up, acks lost every 7th, rupd keeps no ids", "send", &["drop-ack-every=7"], "none").await?;
    scenario("S7 spool, link killed, acks lost every 7th, rupd dedups by id", "send", &["dedup", "drop-ack-every=7"], "kill").await?;
    Ok(())
}

pub(crate) async fn q13() -> Result<()> {
    let c = Conn::connect().await?;
    kill_all(&c).await;
    let id = run_agent(&c, "q13", json!({"RUPD_SOCKET":"/home/boxd/rupd.sock"}), false).await?;
    let (_, mut s) = c.attach(&id, 100, 30, json!({"observe":true})).await?;
    let mut b = Vec::new();
    until(&mut s, &mut b, "ready> ", Duration::from_secs(10)).await;
    c.call("terminal.send", json!({"terminal":id,"text":"tick 100000 1000","force":true})).await?;
    until(&mut s, &mut b, "tick 00005", Duration::from_secs(20)).await;
    let g = c.call("terminal.get", json!({"terminal":id})).await?;
    let pid = g["pid"].as_u64().unwrap();
    let st = remote(&format!("cat /proc/sys/kernel/random/boot_id; cut -d' ' -f1 /proc/uptime; ps -o lstart=,etimes= -p {pid}; date +%s; pgrep -a herdr | head"));
    proof!("q13", "before: terminal {id} pid {pid} state={}; {}", g["state"], st.trim().replace('\n', " | "));
    let last_tick = *ticks(&b).last().unwrap();
    drop(s);
    drop(c);
    let t0 = Instant::now();
    let hib = sh("boxd machine hibernate herdr-spike --json 2>&1 | grep -v newer");
    proof!("q13", "boxd machine hibernate -> {} in {:?}", hib.trim().replace('\n', " "), t0.elapsed());
    tokio::time::sleep(Duration::from_secs(3)).await;
    let status = sh("boxd machine get herdr-spike --json 2>/dev/null | grep -E '\"status\"|delete_after'");
    proof!("q13", "while hibernated: {}", status.trim().replace('\n', " "));
    tokio::time::sleep(Duration::from_secs(25)).await;
    let t1 = Instant::now();
    let c2 = Conn::connect().await?;
    proof!("q13", "wake by `ssh herdr-spike.boxd herdr-core connect`: hello after {:?}", t1.elapsed());
    let status = sh("boxd machine get herdr-spike --json 2>/dev/null | grep -E '\"status\"|delete_after'");
    proof!("q13", "after wake: {}", status.trim().replace('\n', " "));
    let g = c2.call("terminal.get", json!({"terminal":id})).await?;
    let st = remote(&format!("cat /proc/sys/kernel/random/boot_id; cut -d' ' -f1 /proc/uptime; ps -o lstart=,etimes= -p {pid}; date +%s; pgrep -a herdr | head"));
    proof!("q13", "after: terminal {id} pid {} state={} exit_code={} reason={}; {}", g["pid"], g["state"], g["exit_code"], g["reason"], st.trim().replace('\n', " | "));
    let (_, mut s2) = c2.attach(&id, 100, 30, json!({"observe":true})).await?;
    let mut b2 = Vec::new();
    collect_for(&mut s2, &mut b2, Duration::from_secs(4)).await;
    let t = ticks(&b2);
    proof!("q13", "last tick seen before hibernate={last_tick}; ticks after wake (paint + live)={:?}..{:?} (n={}); program counting on = {}", t.first(), t.last(), t.len(), t.last().is_some_and(|l| *l > last_tick));
    kill_all(&c2).await;
    Ok(())
}

fn ticks(b: &[u8]) -> Vec<u32> {
    let re = regex::Regex::new(r"tick (\d{5})(?:\D|$)").unwrap();
    re.captures_iter(&text(b)).filter_map(|c| c[1].parse().ok()).collect()
}
