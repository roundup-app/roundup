//! `open_target`: opens a web link in the browser, or a file or folder in the user's default app (U365).

use std::path::Path;
use std::process::Command;

use rpc::RpcError;
use serde::Deserialize;

/// What a Terminal's link names. A path's `:line` is not sent: the default app opens the file whole.
#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Target {
    Url { url: String },
    Path { path: String },
}

/// The argument `open` takes for `target`, or why it opens nothing.
fn checked(target: &Target) -> Result<&str, RpcError> {
    match target {
        Target::Url { url } => {
            let lower = url.to_ascii_lowercase();
            let web = ["http://", "https://"]
                .iter()
                .any(|scheme| lower.starts_with(scheme) && lower.len() > scheme.len());
            if web {
                Ok(url)
            } else {
                Err(RpcError::new(
                    rpc::code::INVALID_PARAMS,
                    format!("not a web link: {url}"),
                ))
            }
        }
        Target::Path { path } => {
            if !Path::new(path).is_absolute() {
                Err(RpcError::new(
                    rpc::code::INVALID_PARAMS,
                    format!("not an absolute path: {path}"),
                ))
            } else if Path::new(path).exists() {
                Ok(path)
            } else {
                Err(RpcError::not_found(path))
            }
        }
    }
}

#[cfg(target_os = "macos")]
const OPENER: &str = "open";
#[cfg(not(target_os = "macos"))]
const OPENER: &str = "xdg-open";

pub fn open(target: &Target) -> Result<(), RpcError> {
    let argument = checked(target)?;

    Command::new(OPENER)
        .arg(argument)
        .spawn()
        .map(drop)
        .map_err(|err| RpcError::internal(format!("{OPENER}: {err}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(url: &str) -> Target {
        Target::Url { url: url.into() }
    }

    fn path(path: &str) -> Target {
        Target::Path { path: path.into() }
    }

    #[test]
    fn u365_other_schemes_open_nothing() {
        for refused in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "ssh://h",
            "https://",
            "example.com",
        ] {
            assert!(checked(&url(refused)).is_err(), "{refused}");
        }
        assert_eq!(
            checked(&url("https://example.com/a")).unwrap(),
            "https://example.com/a"
        );
        assert_eq!(
            checked(&url("HTTP://example.com")).unwrap(),
            "HTTP://example.com"
        );
    }

    #[test]
    fn u365_a_missing_path_opens_nothing_and_says_so() {
        let err = checked(&path("/definitely/not/here/a.ts")).unwrap_err();
        assert_eq!(err.code, rpc::code::NOT_FOUND);
        assert!(checked(&path("src/a.ts")).is_err());
    }

    #[test]
    fn u365_a_folder_opens_in_finder() {
        let dir = std::env::temp_dir();
        let name = dir.to_str().unwrap();
        assert_eq!(checked(&path(name)).unwrap(), name);
    }

    #[test]
    fn u365_an_absolute_path_opens_with_its_line() {
        let parsed: Target =
            serde_json::from_str(r#"{"kind":"path","path":"/tmp","line":42}"#).unwrap();
        assert!(checked(&parsed).is_ok());
    }
}
