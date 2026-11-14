//! MC30, MC31: a program run to its end where a core is, through `terminal.run` and an attach:
//! its stdout, stderr and exit code. herdr-core has no exec of its own, so the program runs in a
//! `sh` that splits the two streams, since a Terminal has one output.

use std::time::Duration;

use serde_json::{Value, json};

use crate::conn::Conn;
use crate::error::{Error, Result};
use crate::types::Ev;

/// Between a program's stdout and its stderr in the one stream a Terminal gives.
const SPLIT: &[u8] = b"\0roundup-exec-stderr\0";
/// What `sh` runs: no output post-processing, the program, then the split and its stderr.
const SCRIPT: &str = "stty -opost 2>/dev/null; e=$(mktemp) || exit 125; \"$@\" 2>\"$e\"; c=$?; \
    printf '\\000roundup-exec-stderr\\000'; cat \"$e\"; rm -f \"$e\"; exit $c";
/// The most output kept from a program; the rest is dropped, so a runaway one costs bounded memory.
const MAX_OUTPUT: usize = 16 << 20;

/// How a program run through [`Conn::exec`] ended.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Exec {
    /// `None` when a signal ended the program.
    pub code: Option<i32>,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}

impl Conn {
    /// Run `argv` in `cwd` on this core's machine and wait for it to end, for at most `limit`.
    /// A program the core cannot start is the core's own `spawn_failed`.
    pub async fn exec(&self, argv: &[String], cwd: &str, limit: Duration) -> Result<Exec> {
        let mut wrapped = vec!["sh".to_owned(), "-c".into(), SCRIPT.into(), "sh".into()];
        wrapped.extend(argv.iter().cloned());
        let run = self
            .call(
                "terminal.run",
                json!({"argv": wrapped, "cwd": cwd, "env": {"TERM": "dumb"}, "size": {"cols": 200, "rows": 50}}),
            )
            .await?;
        let address = run
            .get("address")
            .and_then(Value::as_str)
            .ok_or_else(|| Error::Protocol("terminal.run: no address".into()))?
            .to_owned();
        let done = tokio::time::timeout(limit, self.collect(&address)).await;
        if done.is_err() {
            let _ = self
                .call("terminal.kill", json!({"terminal": address}))
                .await;
        }
        let _ = self.call("terminal.rm", json!({"terminal": address})).await;
        let (code, bytes) = done.map_err(|_| Error::TimedOut)??;
        Ok(split(code, bytes))
    }

    async fn collect(&self, address: &str) -> Result<(Option<i32>, Vec<u8>)> {
        let mut stream = self.attach(address, 200, 50, 100_000).await?;
        let mut bytes = Vec::new();
        let mut code = None;
        while let Some(ev) = stream.next().await {
            match ev {
                Ev::Data(d) if bytes.len() < MAX_OUTPUT => bytes.extend(d),
                Ev::Close(reason) => {
                    code = reason
                        .get("exit_code")
                        .and_then(Value::as_i64)
                        .and_then(|c| i32::try_from(c).ok());
                    break;
                }
                _ => {}
            }
        }
        Ok((code, bytes))
    }
}

fn split(code: Option<i32>, bytes: Vec<u8>) -> Exec {
    let at = bytes.windows(SPLIT.len()).rposition(|w| w == SPLIT);
    match at.and_then(|at| Some((bytes.get(..at)?, bytes.get(at + SPLIT.len()..)?))) {
        Some((stdout, stderr)) => Exec {
            code,
            stderr: stderr.to_vec(),
            stdout: stdout.to_vec(),
        },
        None => Exec {
            code,
            stdout: bytes,
            stderr: Vec::new(),
        },
    }
}
