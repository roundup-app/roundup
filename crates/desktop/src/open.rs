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

/// Editors that take `--goto <path>:<line>`, first found on `PATH` wins.
const LINE_EDITORS: [&str; 2] = ["code", "cursor"];

/// The program and arguments that open `launch`: a file with a line goes to an editor that takes one, anything else to the system opener.
fn command(launch: &Launch, editor: Option<&str>) -> (String, Vec<std::ffi::OsString>) {
    match (launch, editor) {
        (
            Launch::Path {
                path,
                line: Some(line),
            },
            Some(editor),
        ) => (
            editor.into(),
            vec!["--goto".into(), format!("{}:{line}", path.display()).into()],
        ),
        _ => {
            let opener = if cfg!(target_os = "macos") {
                "open"
            } else {
                "xdg-open"
            };
            let argument = match launch {
                Launch::Url(url) => url.as_str().into(),
                Launch::Path { path, .. } => path.as_os_str().to_owned(),
            };
            (opener.into(), vec![argument])
        }
    }
}

fn on_path(program: &str) -> bool {
    std::env::var_os("PATH")
        .is_some_and(|paths| std::env::split_paths(&paths).any(|dir| dir.join(program).is_file()))
}

/// Hands the system the target; a folder opens in Finder and a file in its default app, or at its line in an editor that takes one.
pub fn launch(launch: &Launch) -> Result<(), RpcError> {
    let editor = LINE_EDITORS.into_iter().find(|name| on_path(name));
    let (program, args) = command(launch, editor);
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
        let (program, args) = command(&opened, Some("code"));
        assert_eq!(program, "code");
        assert_eq!(
            args,
            ["--goto".into(), format!("{}:42", file.display()).into()] as [std::ffi::OsString; 2]
        );
        let (program, args) = command(&opened, None);
        assert_ne!(program, "code");
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
