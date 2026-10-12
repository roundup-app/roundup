//! `open_target`: what Cmd+click on a Terminal's web link or file path asks of the App (`scenarios/ui-terminal-links.md` U365).

use std::path::PathBuf;
use std::process::Command;

use rpc::RpcError;
use serde::Deserialize;

/// A web link or an absolute path the webview resolved; `line` goes with a file to an editor that takes one.
#[derive(Debug, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Target {
    Url { url: String },
    Path { path: String, line: Option<u32> },
}

/// What the App hands the system to open.
#[derive(Debug, PartialEq)]
pub enum Launch {
    Url(String),
    Path { path: PathBuf, line: Option<u32> },
}

/// Refuses what must open nothing: a scheme but `http` and `https`, a relative path, a path that does not exist.
pub fn check(target: Target) -> Result<Launch, RpcError> {
    match target {
        Target::Url { url } => {
            let scheme = url
                .split_once(':')
                .map(|(scheme, _)| scheme.to_ascii_lowercase());
            match scheme.as_deref() {
                Some("http" | "https") => Ok(Launch::Url(url)),
                _ => Err(RpcError::forbidden(format!(
                    "only http and https links open: {url}"
                ))),
            }
        }
        Target::Path { path, line } => {
            let path = PathBuf::from(path);
            if !path.is_absolute() {
                return Err(RpcError::conflict(format!(
                    "{} is not an absolute path",
                    path.display()
                )));
            }
            if !path.exists() {
                return Err(RpcError::not_found(path.display()));
            }
            let line = line.filter(|_| path.is_file());
            Ok(Launch::Path { path, line })
        }
    }
}

/// Apps that take a line, by name, and the URL scheme that opens a file at one.
const LINE_APPS: [(&str, &str); 2] = [("Visual Studio Code", "vscode"), ("Cursor", "cursor")];

/// `<scheme>://file<path>:<line>` with the path percent-encoded.
fn goto_url(scheme: &str, path: &std::path::Path, line: u32) -> String {
    let mut url = format!("{scheme}://file");
    for byte in path.as_os_str().as_encoded_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' | b'/' => {
                url.push(*byte as char)
            }
            _ => url.push_str(&format!("%{byte:02X}")),
        }
    }
    format!("{url}:{line}")
}

/// The program and arguments that open `launch`: a file with a line, whose default app is one that takes a line, opens at it there; anything else goes to the system opener.
fn command(launch: &Launch, default_app: Option<&str>) -> (String, Vec<std::ffi::OsString>) {
    let opener = if cfg!(target_os = "macos") {
        "open"
    } else {
        "xdg-open"
    };
    let scheme = LINE_APPS
        .iter()
        .find(|(name, _)| Some(*name) == default_app)
        .map(|(_, scheme)| *scheme);
    let argument = match (launch, scheme) {
        (Launch::Url(url), _) => url.as_str().into(),
        (
            Launch::Path {
                path,
                line: Some(line),
            },
            Some(scheme),
        ) => goto_url(scheme, path, *line).into(),
        (Launch::Path { path, .. }, _) => path.as_os_str().to_owned(),
    };
    (opener.into(), vec![argument])
}

/// The name of the file's default app, from LaunchServices through System Events; `None` off macOS or when it has none.
fn default_app(path: &std::path::Path) -> Option<String> {
    if !cfg!(target_os = "macos") {
        return None;
    }
    let output = Command::new("osascript")
        .args([
            "-e",
            "on run argv",
            "-e",
            "tell application \"System Events\" to get name of default application of disk item (item 1 of argv)",
            "-e",
            "end run",
        ])
        .arg(path)
        .output()
        .ok()?;
    let name = String::from_utf8(output.stdout).ok()?.trim().to_owned();
    (output.status.success() && !name.is_empty()).then_some(name)
}

/// Hands the system the target; a folder opens in Finder and a file in its default app, at its line when that app takes one.
pub fn launch(launch: &Launch) -> Result<(), RpcError> {
    let app = match launch {
        Launch::Path {
            path,
            line: Some(_),
        } => default_app(path),
        _ => None,
    };
    let (program, args) = command(launch, app.as_deref());
    Command::new(&program)
        .args(args)
        .spawn()
        .map(drop)
        .map_err(|err| RpcError::new(rpc::code::INTERNAL, format!("{program}: {err}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(text: &str) -> Target {
        Target::Url { url: text.into() }
    }

    fn path(text: &str) -> Target {
        Target::Path {
            path: text.into(),
            line: Some(42),
        }
    }

    #[test]
    fn u365_a_web_link_opens_in_the_browser() {
        assert_eq!(
            check(url("https://example.com")).unwrap(),
            Launch::Url("https://example.com".into())
        );
        assert!(check(url("HTTP://example.com")).is_ok());
    }

    #[test]
    fn u365_other_schemes_open_nothing() {
        for refused in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "ssh://host",
            "example.com",
        ] {
            assert_eq!(
                check(url(refused)).unwrap_err().code,
                rpc::code::FORBIDDEN,
                "{refused}"
            );
        }
    }

    #[test]
    fn u365_an_absolute_path_opens_with_its_line() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("a.ts");
        std::fs::write(&file, "x").unwrap();

        let opened = check(path(file.to_str().unwrap())).unwrap();

        assert_eq!(
            opened,
            Launch::Path {
                path: file.clone(),
                line: Some(42)
            }
        );
        let (_, args) = command(&opened, Some("Visual Studio Code"));
        assert_eq!(
            args,
            [format!("vscode://file{}:42", file.display()).into()] as [std::ffi::OsString; 1]
        );
        let (_, args) = command(&opened, Some("Typora"));
        assert_eq!(args, [file.clone().into_os_string()]);
        let (_, args) = command(&opened, None);
        assert_eq!(args, [file.into_os_string()]);
    }

    #[test]
    fn u365_a_folder_opens_in_finder() {
        let dir = tempfile::tempdir().unwrap();

        assert_eq!(
            check(Target::Path {
                path: dir.path().display().to_string(),
                line: None
            })
            .unwrap(),
            Launch::Path {
                path: dir.path().to_path_buf(),
                line: None
            }
        );
    }

    #[test]
    fn u365_a_missing_path_opens_nothing_and_says_so() {
        let err = check(path("/no/such/roundup/a.ts")).unwrap_err();

        assert_eq!(err.code, rpc::code::NOT_FOUND);
        assert_eq!(
            check(path("src/a.ts")).unwrap_err().code,
            rpc::code::CONFLICT
        );
    }
}
