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

/// Apps that take a line, by bundle id, and the URL scheme that opens a file at one.
const LINE_APPS: [(&str, &str); 4] = [
    ("com.microsoft.VSCode", "vscode"),
    ("dev.zed.Zed", "zed"),
    ("dev.zed.Zed-Preview", "zed"),
    ("com.todesktop.230313mzl4w4u92", "cursor"),
];

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

/// Asks LaunchServices (no Apple events, so no consent prompt) for the bundle id of the app that opens argv[0].
const DEFAULT_APP_SCRIPT: &str = "function run(argv) { try { const url = $.NSWorkspace.sharedWorkspace.URLForApplicationToOpenURL($.NSURL.fileURLWithPath(argv[0])); return ObjC.unwrap($.NSBundle.bundleWithURL(url).bundleIdentifier) || ''; } catch (e) { return ''; } }";

/// The bundle id `osascript` printed, or `None` when it printed none.
fn parse_bundle_id(stdout: &[u8]) -> Option<String> {
    let id = std::str::from_utf8(stdout).ok()?.trim();
    (!id.is_empty()).then(|| id.to_owned())
}

/// The bundle id of the file's default app; `None` off macOS or when it has none.
fn default_app(path: &std::path::Path) -> Option<String> {
    if !cfg!(target_os = "macos") {
        return None;
    }
    let output = Command::new("osascript")
        .args(["-l", "JavaScript", "-e", DEFAULT_APP_SCRIPT])
        .arg(path)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    parse_bundle_id(&output.stdout)
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

/// A code editor the App can launch: by bundle id (`open -b`) or application name (`open -a`).
#[derive(Debug, PartialEq, Clone)]
pub enum Editor {
    Bundle(String),
    Name(String),
}

/// `ROUNDUP_EDITOR` names an app by bundle id (it holds a dot) or by application name.
fn named_editor(text: &str) -> Editor {
    if text.contains('.') && !text.contains(' ') {
        Editor::Bundle(text.into())
    } else {
        Editor::Name(text.into())
    }
}

/// The first editor that applies: `ROUNDUP_EDITOR`, then the apps of `LINE_APPS` in order; one counts when `installed` finds it.
fn choose_editor(chosen: Option<&str>, installed: &dyn Fn(&Editor) -> bool) -> Option<Editor> {
    chosen
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(named_editor)
        .into_iter()
        .chain(LINE_APPS.iter().map(|(id, _)| Editor::Bundle((*id).into())))
        .find(|editor| installed(editor))
}

/// The program and arguments that open `path` in `editor`.
fn editor_command(editor: &Editor, path: &std::path::Path) -> (String, Vec<std::ffi::OsString>) {
    let (flag, app) = match editor {
        Editor::Bundle(id) => ("-b", id),
        Editor::Name(name) => ("-a", name),
    };
    (
        "open".into(),
        vec![flag.into(), app.into(), path.as_os_str().to_owned()],
    )
}

/// Asks the system whether the app is installed: Spotlight for a bundle id, `open -Ra` for a name.
fn system_has(editor: &Editor) -> bool {
    if !cfg!(target_os = "macos") {
        return false;
    }
    let output = match editor {
        Editor::Bundle(id) => Command::new("mdfind")
            .arg(format!(
                "kMDItemCFBundleIdentifier == '{}'",
                id.replace('\'', "")
            ))
            .output()
            .map(|out| out.status.success() && !out.stdout.iter().all(u8::is_ascii_whitespace)),
        Editor::Name(name) => Command::new("open")
            .args(["-Ra", name])
            .output()
            .map(|out| out.status.success()),
    };
    output.unwrap_or(false)
}

type Launcher<'a> = dyn FnMut(&str, &[std::ffi::OsString]) -> Result<(), RpcError> + 'a;

/// Opens the directory in the chosen editor, with the environment, the installed test and the launcher passed in so a test replaces them.
fn open_in_editor_with(
    path: &str,
    chosen: Option<&str>,
    installed: &dyn Fn(&Editor) -> bool,
    launch: &mut Launcher<'_>,
) -> Result<(), RpcError> {
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
    if !path.is_dir() {
        return Err(RpcError::conflict(format!(
            "{} is not a directory",
            path.display()
        )));
    }
    let editor = choose_editor(chosen, installed).ok_or_else(|| {
        RpcError::new(
            rpc::code::NOT_FOUND,
            "no code editor found; install VS Code or Cursor, or set ROUNDUP_EDITOR",
        )
    })?;
    let (program, args) = editor_command(&editor, &path);
    launch(&program, &args)
}

/// `open_in_editor`: the directory opens in the user's code editor (`scenarios/ui-rail-actions.md` U429).
pub fn open_in_editor(path: &str) -> Result<(), RpcError> {
    open_in_editor_with(
        path,
        std::env::var("ROUNDUP_EDITOR").ok().as_deref(),
        &system_has,
        &mut |program, args| {
            Command::new(program)
                .args(args)
                .spawn()
                .map(drop)
                .map_err(|err| RpcError::new(rpc::code::INTERNAL, format!("{program}: {err}")))
        },
    )
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
        let (_, args) = command(&opened, Some("com.microsoft.VSCode"));
        assert_eq!(
            args,
            [format!("vscode://file{}:42", file.display()).into()] as [std::ffi::OsString; 1]
        );
        let (_, args) = command(&opened, Some("abnerworks.Typora"));
        assert_eq!(args, [file.clone().into_os_string()]);
        let (_, args) = command(&opened, None);
        assert_eq!(args, [file.into_os_string()]);
    }

    #[test]
    fn u365_zed_and_zed_preview_open_at_the_line() {
        let opened = Launch::Path {
            path: "/a/b.rs".into(),
            line: Some(7),
        };
        for id in ["dev.zed.Zed", "dev.zed.Zed-Preview"] {
            let (_, args) = command(&opened, Some(id));
            assert_eq!(args, [std::ffi::OsString::from("zed://file/a/b.rs:7")]);
        }
    }

    #[test]
    fn u365_the_default_app_is_the_bundle_id_osascript_prints() {
        assert_eq!(
            parse_bundle_id(b"com.microsoft.VSCode\n").as_deref(),
            Some("com.microsoft.VSCode")
        );
        assert_eq!(parse_bundle_id(b"\n"), None);
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

    type Launched = Vec<(String, Vec<std::ffi::OsString>)>;

    fn run(path: &str, chosen: Option<&str>, present: &[&str]) -> (Result<(), RpcError>, Launched) {
        let mut launched = Vec::new();
        let installed = |editor: &Editor| {
            let (Editor::Bundle(id) | Editor::Name(id)) = editor;
            present.contains(&id.as_str())
        };
        let result = open_in_editor_with(path, chosen, &installed, &mut |program, args| {
            launched.push((program.to_owned(), args.to_vec()));
            Ok(())
        });
        (result, launched)
    }

    #[test]
    fn u429_opens_the_directory_in_the_first_known_editor() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().to_str().unwrap();

        let (result, launched) = run(
            path,
            None,
            &["com.todesktop.230313mzl4w4u92", "com.microsoft.VSCode"],
        );

        assert!(result.is_ok());
        assert_eq!(
            launched,
            [(
                "open".to_owned(),
                vec![
                    "-b".into(),
                    "com.microsoft.VSCode".into(),
                    dir.path().as_os_str().to_owned()
                ]
            )]
        );
        let (_, launched) = run(path, None, &["com.todesktop.230313mzl4w4u92"]);
        assert_eq!(
            launched[0].1[1],
            std::ffi::OsString::from("com.todesktop.230313mzl4w4u92")
        );
    }

    #[test]
    fn u429_roundup_editor_wins_over_the_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().to_str().unwrap();

        let (_, by_name) = run(path, Some("Zed"), &["Zed", "com.microsoft.VSCode"]);
        let (_, by_id) = run(
            path,
            Some("dev.zed.Zed"),
            &["dev.zed.Zed", "com.microsoft.VSCode"],
        );
        let (_, missing) = run(path, Some("Zed"), &["com.microsoft.VSCode"]);

        assert_eq!(by_name[0].1[..2], ["-a", "Zed"]);
        assert_eq!(by_id[0].1[..2], ["-b", "dev.zed.Zed"]);
        assert_eq!(
            missing[0].1[1],
            std::ffi::OsString::from("com.microsoft.VSCode")
        );
    }

    #[test]
    fn u429_no_editor_is_not_found_with_that_message() {
        let dir = tempfile::tempdir().unwrap();

        let (result, launched) = run(dir.path().to_str().unwrap(), None, &[]);
        let err = result.unwrap_err();

        assert_eq!(err.code, rpc::code::NOT_FOUND);
        assert_eq!(
            err.message,
            "no code editor found; install VS Code or Cursor, or set ROUNDUP_EDITOR"
        );
        assert!(launched.is_empty());
    }

    #[test]
    fn u429_a_relative_path_is_conflict() {
        let (result, launched) = run("src", None, &["com.microsoft.VSCode"]);

        assert_eq!(result.unwrap_err().code, rpc::code::CONFLICT);
        assert!(launched.is_empty());
    }

    #[test]
    fn u429_a_missing_path_is_not_found() {
        let (result, launched) = run("/no/such/roundup/dir", None, &["com.microsoft.VSCode"]);

        assert_eq!(result.unwrap_err().code, rpc::code::NOT_FOUND);
        assert!(launched.is_empty());
    }

    #[test]
    fn u429_a_file_is_conflict() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("a.ts");
        std::fs::write(&file, "x").unwrap();

        let (result, launched) = run(file.to_str().unwrap(), None, &["com.microsoft.VSCode"]);

        assert_eq!(result.unwrap_err().code, rpc::code::CONFLICT);
        assert!(launched.is_empty());
    }
}
