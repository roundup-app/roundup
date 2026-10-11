//! `open_target`: opens a web link in the browser and a file or folder in the user's default app (U365).

use std::io;
use std::path::Path;
use std::process::Command;

use rpc::{RpcError, code};
use serde::Deserialize;

/// What the webview asks to open; a path is absolute because the webview resolves a relative one first.
#[derive(Debug, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Target {
    Url { url: String },
    Path { path: String, line: Option<u32> },
}

/// The program that hands a URL or path to the system.
#[cfg(target_os = "macos")]
const OPENER: &str = "open";
#[cfg(not(target_os = "macos"))]
const OPENER: &str = "xdg-open";

fn is_web_link(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    (lower.starts_with("http://") || lower.starts_with("https://"))
        && !url.chars().any(|c| c.is_whitespace() || c.is_control())
}

/// Checks `target`, then passes the one argument to open to `launch`. Only `http` and `https`
/// links open; a path must be absolute and exist, else `NOT_FOUND` and nothing is launched.
/// `line` goes to no editor yet: the default app takes a file, not a position.
pub fn open_target(
    target: &Target,
    launch: impl FnOnce(&str) -> io::Result<()>,
) -> Result<(), RpcError> {
    let argument = match target {
        Target::Url { url } if is_web_link(url) => url,
        Target::Url { url } => {
            return Err(RpcError::new(
                code::INVALID_PARAMS,
                format!("only http and https links open: {url}"),
            ));
        }
        Target::Path { path, .. } => {
            if !Path::new(path).is_absolute() {
                return Err(RpcError::new(
                    code::INVALID_PARAMS,
                    format!("a path to open is absolute: {path}"),
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
    launch(argument).map_err(|err| {
        RpcError::internal(format!("could not open {argument} with {OPENER}: {err}"))
    })
}

/// Launches the system opener on `argument` and does not wait for it.
pub fn launch_system(argument: &str) -> io::Result<()> {
    Command::new(OPENER).arg(argument).spawn().map(drop)
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;

    use super::*;

    fn opened(target: &Target) -> (Result<(), RpcError>, Vec<String>) {
        let calls = RefCell::new(Vec::new());
        let result = open_target(target, |argument| {
            calls.borrow_mut().push(argument.to_owned());
            Ok(())
        });
        (result, calls.into_inner())
    }

    fn url(text: &str) -> Target {
        Target::Url { url: text.into() }
    }

    #[test]
    fn u365_a_web_link_opens_in_the_browser() {
        for link in ["https://example.com", "http://example.com/a?b=c"] {
            let (result, calls) = opened(&url(link));
            assert!(result.is_ok());
            assert_eq!(calls, [link]);
        }
    }

    #[test]
    fn u365_other_schemes_open_nothing() {
        for link in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "ssh://host",
            "https://a b",
            "example.com",
        ] {
            let (result, calls) = opened(&url(link));
            assert_eq!(result.unwrap_err().code, code::INVALID_PARAMS, "{link}");
            assert!(calls.is_empty(), "{link}");
        }
    }

    #[test]
    fn u365_an_absolute_path_opens_with_its_line() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("a.ts");
        std::fs::write(&file, "").unwrap();
        let path = file.display().to_string();
        let (result, calls) = opened(&Target::Path {
            path: path.clone(),
            line: Some(42),
        });
        assert!(result.is_ok());
        assert_eq!(calls, [path]);
    }

    #[test]
    fn u365_a_folder_opens_in_finder() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().display().to_string();
        let (result, calls) = opened(&Target::Path {
            path: path.clone(),
            line: None,
        });
        assert!(result.is_ok());
        assert_eq!(calls, [path]);
    }

    #[test]
    fn u365_a_missing_path_opens_nothing_and_says_so() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("gone.ts").display().to_string();
        let (result, calls) = opened(&Target::Path {
            path: path.clone(),
            line: None,
        });
        let err = result.unwrap_err();
        assert_eq!(err.code, code::NOT_FOUND);
        assert_eq!(err.message, format!("{path} does not exist"));
        assert!(calls.is_empty());
    }

    #[test]
    fn u365_a_relative_path_is_refused() {
        let (result, calls) = opened(&Target::Path {
            path: "src/a.ts".into(),
            line: None,
        });
        assert_eq!(result.unwrap_err().code, code::INVALID_PARAMS);
        assert!(calls.is_empty());
    }

    #[test]
    fn u365_the_target_arrives_as_kind_url_or_path() {
        let parsed: Target =
            serde_json::from_str(r#"{"kind":"path","path":"/a.ts","line":3}"#).unwrap();
        assert_eq!(
            parsed,
            Target::Path {
                path: "/a.ts".into(),
                line: Some(3)
            }
        );
    }
}
