//! U365 (`scenarios/ui-terminal-links.md`): `open_target` hands a web link to the browser and a path to the user's default app.

use std::io;
use std::path::Path;
use std::process::Command;

use rpc::{RpcError, code};
use serde::Deserialize;

/// What the webview asks to open. `line` goes with a file to an editor that takes one; the default app ignores it.
#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Target {
    Url { url: String },
    Path { path: String, line: Option<u32> },
}

/// Checks `target` and, when it passes, gives `launch` the one argument the system opener takes. A refused target launches nothing.
pub fn open(target: &Target, launch: impl FnOnce(&str) -> io::Result<()>) -> Result<(), RpcError> {
    let argument = match target {
        Target::Url { url } => {
            let scheme = url
                .split_once("://")
                .map(|(scheme, _)| scheme.to_ascii_lowercase());
            if !matches!(scheme.as_deref(), Some("http" | "https"))
                || url.contains(char::is_whitespace)
            {
                return Err(RpcError::new(
                    code::INVALID_PARAMS,
                    format!("{url} is not a web link: only http and https open"),
                ));
            }
            url
        }
        Target::Path { path, .. } => {
            if !Path::new(path).is_absolute() {
                return Err(RpcError::new(
                    code::INVALID_PARAMS,
                    format!("{path} is not an absolute path"),
                ));
            }
            if !Path::new(path).exists() {
                return Err(RpcError::new(
                    code::NOT_FOUND,
                    format!("{path} does not exist"),
                ));
            }
            path
        }
    };
    launch(argument).map_err(RpcError::internal)
}

/// The system opener: the browser for a link, the default app for a file, Finder for a folder.
pub fn system_open(argument: &str) -> io::Result<()> {
    let program = if cfg!(target_os = "macos") {
        "open"
    } else {
        "xdg-open"
    };
    let status = Command::new(program).arg("--").arg(argument).status()?;
    if status.success() {
        Ok(())
    } else {
        Err(io::Error::other(format!(
            "{program} could not open {argument}: {status}"
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn launched(target: &Target) -> (Result<(), RpcError>, Vec<String>) {
        let mut calls = Vec::new();
        let result = open(target, |argument| {
            calls.push(argument.to_owned());
            Ok(())
        });
        (result, calls)
    }

    fn url(url: &str) -> Target {
        Target::Url {
            url: url.to_owned(),
        }
    }

    fn path(path: &Path, line: Option<u32>) -> Target {
        Target::Path {
            path: path.display().to_string(),
            line,
        }
    }

    #[test]
    fn u365_a_web_link_opens_in_the_browser() {
        let (result, calls) = launched(&url("https://example.com/a?b=1"));
        assert_eq!(result, Ok(()));
        assert_eq!(calls, ["https://example.com/a?b=1"]);
        assert_eq!(
            launched(&url("HTTP://example.com")).1,
            ["HTTP://example.com"]
        );
    }

    #[test]
    fn u365_other_schemes_open_nothing() {
        for refused in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "ssh://host",
            "example.com",
            "-a evil",
            "https://a b",
        ] {
            let (result, calls) = launched(&url(refused));
            assert_eq!(result.unwrap_err().code, code::INVALID_PARAMS, "{refused}");
            assert!(calls.is_empty(), "{refused}");
        }
    }

    #[test]
    fn u365_an_absolute_path_opens_with_its_line() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("a.ts");
        std::fs::write(&file, "").unwrap();
        let (result, calls) = launched(&path(&file, Some(42)));
        assert_eq!(result, Ok(()));
        assert_eq!(calls, [file.display().to_string()]);
    }

    #[test]
    fn u365_a_folder_opens_in_finder() {
        let dir = tempfile::tempdir().unwrap();
        let (result, calls) = launched(&path(dir.path(), None));
        assert_eq!(result, Ok(()));
        assert_eq!(calls, [dir.path().display().to_string()]);
    }

    #[test]
    fn u365_a_missing_path_opens_nothing_and_says_so() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("gone.ts");
        let (result, calls) = launched(&path(&missing, Some(1)));
        let error = result.unwrap_err();
        assert_eq!(error.code, code::NOT_FOUND);
        assert!(
            error
                .message
                .contains(&format!("{} does not exist", missing.display()))
        );
        assert!(calls.is_empty());
        assert_eq!(
            launched(&Target::Path {
                path: "src/a.ts".into(),
                line: None
            })
            .0
            .unwrap_err()
            .code,
            code::INVALID_PARAMS
        );
    }

    #[test]
    fn u365_the_webview_sends_kind_tagged_targets() {
        let parsed: Target =
            serde_json::from_str(r#"{"kind":"path","path":"/a","line":null}"#).unwrap();
        assert_eq!(
            parsed,
            Target::Path {
                path: "/a".into(),
                line: None
            }
        );
        let parsed: Target =
            serde_json::from_str(r#"{"kind":"url","url":"https://x.io"}"#).unwrap();
        assert_eq!(parsed, url("https://x.io"));
    }
}
