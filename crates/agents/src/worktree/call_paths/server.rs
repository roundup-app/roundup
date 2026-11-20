//! CP1: the table of language servers, and finding one. A server counts only when its version
//! reads as one that speaks `--lsp` and its initialize answer advertises call hierarchy.

use std::path::{Path, PathBuf};
use std::process::Command;

use contracts::agent::{CallPathCause, ServerLookup};

/// One language: its extensions and the executable to run as a server.
pub(super) struct Row {
    pub language: &'static str,
    pub extensions: &'static [&'static str],
    pub program: &'static str,
    pub args: &'static [&'static str],
    /// The first major version whose executable speaks the server protocol.
    pub first_major: u32,
    pub name: &'static str,
    /// Where a project carries its own copy, under the Worktree.
    pub local: Option<&'static str>,
    /// The `languageId` of a document sent to it.
    pub language_id: &'static str,
    /// What a missing server reads as.
    pub not_installed: &'static str,
    /// CP5, RA3: the time a trace has.
    pub limit: std::time::Duration,
}

/// Measured on TypeScript 7.0.2: `tsc --lsp -stdio` exists from 7.
const ROWS: [Row; 2] = [
    Row {
        language: "typescript",
        extensions: &["ts", "tsx", "mts", "cts"],
        program: "tsc",
        args: &["--lsp", "-stdio"],
        first_major: 7,
        name: "tsc",
        local: Some("node_modules/.bin"),
        language_id: "typescript",
        not_installed: "tsc is not installed in the project or on PATH",
        limit: super::LIMIT,
    },
    Row {
        language: "rust",
        extensions: &["rs"],
        program: "rust-analyzer",
        args: &[],
        first_major: 0,
        name: "rust-analyzer",
        local: None,
        language_id: "rust",
        not_installed: "rust-analyzer is not installed; `rustup component add rust-analyzer` installs it",
        limit: super::RUST_LIMIT,
    },
];

/// Languages the Daemon names though it has no server row for them: they read as no server.
const NAMED: [(&str, &str); 3] = [("py", "python"), ("go", "go"), ("js", "javascript")];

impl Row {
    /// RA2: what the server is started with. Rust gets its own target directory under the
    /// Daemon's cache and cargo offline and locked, so it takes no lock the Agent's cargo needs,
    /// writes nothing in the Agent's `target/` and fetches nothing.
    pub(super) fn launch(
        &self,
        target: &Path,
        lean: bool,
    ) -> (Vec<(String, String)>, serde_json::Value) {
        if self.language != "rust" {
            return (vec![], serde_json::Value::Null);
        }
        let mut options = serde_json::json!({
            "cargo": {"extraArgs": ["--offline", "--locked"], "targetDir": target},
            "checkOnSave": false,
        });
        if lean {
            options["cargo"]["buildScripts"] = serde_json::json!({"enable": false});
            options["procMacro"] = serde_json::json!({"enable": false});
            options["cachePriming"] = serde_json::json!({"enable": false});
        }
        let env = [
            ("CARGO_TARGET_DIR", target.display().to_string()),
            ("CARGO_NET_OFFLINE", "true".into()),
        ];
        (env.map(|(k, v)| (k.to_owned(), v)).to_vec(), options)
    }
}

pub(super) fn language_of(path: &str) -> Option<&'static str> {
    let ext = Path::new(path).extension()?.to_str()?;
    ROWS.iter()
        .find(|row| row.extensions.contains(&ext))
        .map(|row| row.language)
        .or_else(|| NAMED.iter().find(|(e, _)| *e == ext).map(|(_, l)| *l))
}

pub(super) fn row(language: &str) -> Option<&'static Row> {
    ROWS.iter().find(|row| row.language == language)
}

pub(super) struct Server {
    pub program: PathBuf,
    pub row: &'static Row,
    pub version: String,
}

fn cause(kind: &str, detail: String) -> CallPathCause {
    CallPathCause {
        kind: kind.into(),
        detail,
    }
}

/// The server for `language` in the project at `root`: its own copy, then PATH. Runs only the
/// executable's version read, in `root` so a project's toolchain file picks the toolchain.
pub(super) fn find(
    language: &str,
    root: &Path,
    path: &std::ffi::OsStr,
) -> Result<Server, CallPathCause> {
    let Some(row) = row(language) else {
        return Err(cause(
            "notInstalled",
            format!("no language server is known for {language}"),
        ));
    };
    let found = row
        .local
        .map(|dir| root.join(dir).join(row.program))
        .into_iter()
        .chain(std::env::split_paths(path).map(|dir| dir.join(row.program)))
        .find(|candidate| candidate.is_file());
    let Some(program) = found else {
        return Err(cause("notInstalled", row.not_installed.into()));
    };
    // A rustup proxy exists when its component does not: the failed read says so.
    let out = Command::new(&program)
        .arg("--version")
        .current_dir(root)
        .output()
        .map_err(|err| cause("notInstalled", format!("{}: {err}", program.display())))?;
    if !out.status.success() {
        return Err(cause("notInstalled", row.not_installed.into()));
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let version = text
        .split_whitespace()
        .find(|word| word.starts_with(|c: char| c.is_ascii_digit()))
        .unwrap_or("")
        .to_owned();
    let major: u32 = version
        .split('.')
        .next()
        .and_then(|m| m.parse().ok())
        .unwrap_or(0);
    if major < row.first_major {
        return Err(cause(
            "predates",
            format!(
                "TypeScript {version} predates `tsc --lsp`; {} or later is needed",
                row.first_major
            ),
        ));
    }
    Ok(Server {
        program,
        row,
        version,
    })
}

pub(super) fn lookup(found: &Result<Server, CallPathCause>) -> ServerLookup {
    match found {
        Ok(server) => ServerLookup {
            found: true,
            name: Some(server.row.name.into()),
            version: Some(server.version.clone()),
            cause: None,
        },
        Err(why) => ServerLookup {
            found: false,
            name: None,
            version: None,
            cause: Some(why.clone()),
        },
    }
}
