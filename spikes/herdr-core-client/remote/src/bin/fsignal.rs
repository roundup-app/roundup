//! Stand-in for `rup signal`. Talks to the machine-local fqueue daemon on ~/rupq.sock.
//!   fsignal send AGENT SEQ     queued report: returns once the daemon has fsynced it (exit 1 if it cannot)
//!   fsignal direct AGENT SEQ   live call to rupd through the relay; exit 1 if the Mac is away
//!   fsignal bench N            N queued reports on fresh connections, p50/p95 of connect+send+ack
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::time::{Duration, Instant};

fn sock() -> PathBuf {
    PathBuf::from(std::env::var_os("HOME").unwrap()).join("rupq.sock")
}

fn exchange(line: &str) -> std::io::Result<String> {
    let mut s = UnixStream::connect(sock())?;
    s.set_read_timeout(Some(Duration::from_secs(10)))?;
    s.write_all(line.as_bytes())?;
    s.write_all(b"\n")?;
    let mut reply = String::new();
    BufReader::new(s).read_line(&mut reply)?;
    if reply.is_empty() {
        return Err(std::io::Error::other("closed without a reply"));
    }
    if reply.contains("\"error\"") {
        return Err(std::io::Error::other(reply.trim().to_owned()));
    }
    Ok(reply)
}

fn record(agent: &str, seq: &str) -> String {
    format!(r#"{{"id":"{agent}:{seq}","agent":"{agent}","seq":{seq}}}"#)
}
fn live(agent: &str, seq: &str) -> String {
    format!(r#"{{"jsonrpc":"2.0","id":"{agent}:{seq}","method":"report","params":{{"agent":"{agent}","seq":{seq}}}}}"#)
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let fail = |e: std::io::Error| -> ! {
        eprintln!("fsignal: {e}");
        std::process::exit(1)
    };
    match args.first().map(String::as_str) {
        Some("send") => {
            exchange(&record(&args[1], &args[2])).unwrap_or_else(|e| fail(e));
        }
        Some("direct") => {
            exchange(&live(&args[1], &args[2])).unwrap_or_else(|e| fail(e));
        }
        Some("bench") => {
            let n: usize = args[1].parse().unwrap();
            let mut ms = Vec::new();
            for i in 0..n {
                let t = Instant::now();
                exchange(&record("bench", &i.to_string())).unwrap_or_else(|e| fail(e));
                ms.push(t.elapsed().as_secs_f64() * 1e3);
            }
            ms.sort_by(|a, b| a.partial_cmp(b).unwrap());
            println!("queued report connect+send+durable-ack n={n} p50={:.3}ms p95={:.3}ms max={:.3}ms", ms[n / 2], ms[n * 95 / 100], ms[n - 1]);
        }
        _ => eprintln!("usage: fsignal send|direct AGENT SEQ | bench N"),
    }
}
