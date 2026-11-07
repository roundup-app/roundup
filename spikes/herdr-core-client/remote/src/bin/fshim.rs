//! Stand-in for `rup mcp`: a JSON-RPC stdio shim. Every stdin line goes to the forwarded rupd
//! socket, the reply line goes to stdout. `fshim bench N` times N ping round trips on one
//! connection and prints p50/p95.
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::time::Instant;

fn main() {
    let sock = std::env::var_os("RUPQ_SOCK_UNUSED").map(std::path::PathBuf::from).unwrap_or_else(|| {
        std::path::PathBuf::from(std::env::var_os("HOME").unwrap()).join("rupq.sock")
    });
    let mut s = UnixStream::connect(&sock).expect("connect rupd socket: fail loud");
    let mut r = BufReader::new(s.try_clone().unwrap());
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().map(String::as_str) == Some("bench") {
        let n: usize = args[1].parse().unwrap();
        let mut ms = Vec::new();
        let mut reply = String::new();
        for i in 0..n {
            let t = Instant::now();
            writeln!(s, r#"{{"jsonrpc":"2.0","id":{i},"method":"ping"}}"#).unwrap();
            reply.clear();
            r.read_line(&mut reply).unwrap();
            ms.push(t.elapsed().as_secs_f64() * 1e3);
        }
        ms.sort_by(|a, b| a.partial_cmp(b).unwrap());
        println!("shim ping n={n} p50={:.3}ms p95={:.3}ms max={:.3}ms", ms[n / 2], ms[n * 95 / 100], ms[n - 1]);
        return;
    }
    let mut reply = String::new();
    for line in std::io::stdin().lock().lines() {
        let line = line.unwrap();
        writeln!(s, "{line}").unwrap();
        reply.clear();
        r.read_line(&mut reply).unwrap();
        print!("{reply}");
        std::io::stdout().flush().unwrap();
    }
}
