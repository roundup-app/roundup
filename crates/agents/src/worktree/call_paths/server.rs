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
}

/// Measured on TypeScript 7.0.2: `tsc --lsp -stdio` exists from 7.
const ROWS: [Row; 1] = [Row {
    language: "typescript",
    extensions: &["ts", "tsx", "mts", "cts"],
    program: "tsc",
    args: &["--lsp", "-stdio"],
    first_major: 7,
    name: "tsc",
}];

/// Languages the Daemon names though it has no server row for them: they read as no server.
const NAMED: [(&str, &str); 4] = [
    ("rs", "rust"),
    ("py", "python"),
    ("go", "go"),
    ("js", "javascript"),
];

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

/// The server for `language` in the project at `root`: its own `node_modules/.bin`, then PATH.
/// Runs only the executable's version read.
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
    let local = root.join("node_modules/.bin").join(row.program);
    let found = std::iter::once(local)
        .chain(std::env::split_paths(path).map(|dir| dir.join(row.program)))
        .find(|candidate| candidate.is_file());
    let Some(program) = found else {
        return Err(cause(
            "notInstalled",
            format!("{} is not installed in the project or on PATH", row.program),
        ));
    };
    let out = Command::new(&program)
        .arg("--version")
        .output()
        .map_err(|err| cause("notInstalled", format!("{}: {err}", program.display())))?;
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
