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
            let path = parse_path(&path)?;
            let line = line.filter(|_| path.is_file());
            Ok(Launch::Path { path, line })
        }
    }
}

/// `~` and `~/rest` under `home`; any other path as printed.
fn expand_home(path: &str, home: Option<std::ffi::OsString>) -> PathBuf {
    match (path.strip_prefix("~/"), path, home) {
        (Some(rest), _, Some(home)) => PathBuf::from(home).join(rest),
        (None, "~", Some(home)) => PathBuf::from(home),
        _ => PathBuf::from(path),
    }
}

fn parse_path(path: &str) -> Result<PathBuf, RpcError> {
    let path = expand_home(path, std::env::var_os("HOME"));
    if !path.is_absolute() {
        return Err(RpcError::conflict(format!(
            "{} is not an absolute path",
            path.display()
        )));
    }
    if !path.exists() {
        return Err(RpcError::not_found(path.display()));
    }
    Ok(path)
}

/// A code editor the user can choose: its bundle id, its name and the URL scheme that opens a file at a line (`None`: it takes no line).
struct Editor {
    id: &'static str,
    name: &'static str,
    scheme: Option<&'static str>,
}

/// The choices of `Code editor` (`scenarios/ui-app-settings.md` U6372a), in the order `Automatic` tries the first four (U2539c).
const EDITORS: [Editor; 7] = [
    Editor {
        id: "com.microsoft.VSCode",
        name: "VS Code",
        scheme: Some("vscode"),
    },
    Editor {
        id: "com.todesktop.230313mzl4w4u92",
        name: "Cursor",
        scheme: Some("cursor"),
    },
    Editor {
        id: "dev.zed.Zed",
        name: "Zed",
        scheme: Some("zed"),
    },
    Editor {
        id: "dev.zed.Zed-Preview",
        name: "Zed Preview",
        scheme: Some("zed"),
    },
    Editor {
        id: "com.apple.dt.Xcode",
        name: "Xcode",
        scheme: None,
    },
    Editor {
        id: "com.sublimetext.4",
        name: "Sublime Text",
        scheme: None,
    },
    Editor {
        id: "com.panic.Nova",
        name: "Nova",
        scheme: None,
    },
];

/// How many of `EDITORS` `Automatic` tries.
const AUTOMATIC: usize = 4;

/// An installed editor as the Settings choice lists it.
#[derive(Debug, PartialEq, serde::Serialize)]
pub struct EditorChoice {
    pub id: &'static str,
    pub name: &'static str,
}

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

type Opening = (String, Vec<std::ffi::OsString>);

fn system_command(argument: std::ffi::OsString) -> Opening {
    let opener = if cfg!(target_os = "macos") {
        "open"
    } else {
        "xdg-open"
    };
    (opener.into(), vec![argument])
}

/// The command that opens `path` in `editor`, at `line` when the editor takes one.
fn editor_command(editor: &Editor, path: &std::path::Path, line: Option<u32>) -> Opening {
    let target = match (line, editor.scheme) {
        (Some(line), Some(scheme)) if path.is_file() => goto_url(scheme, path, line).into(),
        _ => path.as_os_str().to_owned(),
    };
    ("open".into(), vec!["-b".into(), editor.id.into(), target])
}

/// The editor to use: the chosen bundle id when it is installed, else the first installed of `Automatic`'s order. `Ok(None)` is `Automatic` with none installed; a chosen editor that is not installed fails (U6372c).
fn resolve(
    chosen: Option<&str>,
    installed: &dyn Fn(&str) -> bool,
) -> Result<Option<&'static Editor>, RpcError> {
    match chosen.map(str::trim).filter(|id| !id.is_empty()) {
        None => Ok(EDITORS[..AUTOMATIC]
            .iter()
            .find(|editor| installed(editor.id))),
        Some(id) => EDITORS
            .iter()
            .find(|editor| editor.id == id && installed(id))
            .map(Some)
            .ok_or_else(|| {
                let name = EDITORS
                    .iter()
                    .find(|editor| editor.id == id)
                    .map_or(id, |editor| editor.name);
                RpcError::new(
                    rpc::code::NOT_FOUND,
                    format!("{name} is not installed; choose another in Settings"),
                )
            }),
    }
}

/// What the machine answers: whether an app is installed and whether a file is a text file.
struct Machine<'a> {
    installed: &'a dyn Fn(&str) -> bool,
    text: &'a dyn Fn(&std::path::Path) -> bool,
}

/// A file with no extension (`justfile`) or whose type conforms to `public.text` (U6372b).
fn is_text(path: &std::path::Path, conforms: &dyn Fn(&str) -> bool) -> bool {
    path.extension()
        .is_none_or(|extension| conforms(&extension.to_string_lossy()))
}

/// The command for `launch`. A text file goes to the editor, at its line when it takes one; a folder goes there only from `Open in editor` (`in_editor`); a web link and every other file go to the system opener.
fn plan(
    launch: &Launch,
    chosen: Option<&str>,
    in_editor: bool,
    machine: &Machine<'_>,
) -> Result<Opening, RpcError> {
    let (path, line) = match launch {
        Launch::Url(url) => return Ok(system_command(url.as_str().into())),
        Launch::Path { path, line } => (path, line),
    };
    let wanted = if path.is_dir() {
        in_editor
    } else {
        (machine.text)(path)
    };
    if !wanted {
        return Ok(system_command(path.as_os_str().to_owned()));
    }
    match resolve(chosen, machine.installed)? {
        Some(editor) => Ok(editor_command(editor, path, *line)),
        None if in_editor => Err(RpcError::new(
            rpc::code::NOT_FOUND,
            "no code editor found; choose one in Settings",
        )),
        None => Ok(system_command(path.as_os_str().to_owned())),
    }
}

// Query LaunchServices without opening Finder or launching the app during discovery.
// https://developer.apple.com/documentation/appkit/nsworkspace/urlforapplication(withbundleidentifier:)
const INSTALLED_SCRIPT: &str = "ObjC.import('AppKit'); function run(argv) { const w = $.NSWorkspace.sharedWorkspace; return argv.filter(id => { try { return !!w.URLForApplicationWithBundleIdentifier(id); } catch (e) { return false; } }).join('\\n'); }";

// https://developer.apple.com/documentation/uniformtypeidentifiers/uttype
const CONFORMS_SCRIPT: &str = "ObjC.import('UniformTypeIdentifiers'); function run(argv) { try { const type = $.UTType.typeWithFilenameExtension(argv[0]); return type && type.conformsToType($.UTType.typeWithIdentifier('public.text')) ? 'yes' : 'no'; } catch (e) { return 'no'; } }";

/// The stdout of an `osascript` run of `script`; `None` off macOS or when it fails.
fn osascript(script: &str, args: &[&str]) -> Option<String> {
    if !cfg!(target_os = "macos") {
        return None;
    }
    let output = Command::new("osascript")
        .args(["-l", "JavaScript", "-e", script])
        .args(args)
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

/// The bundle ids among `ids` that are installed, in one LaunchServices query.
fn installed_ids(ids: &[&str]) -> Vec<String> {
    osascript(INSTALLED_SCRIPT, ids)
        .map(|out| out.lines().map(str::to_owned).collect())
        .unwrap_or_default()
}

/// The editors of `EDITORS` that are installed, in list order.
pub fn installed_editors() -> Vec<EditorChoice> {
    let ids: Vec<&str> = EDITORS.iter().map(|editor| editor.id).collect();
    let found = installed_ids(&ids);

    EDITORS
        .iter()
        .filter(|editor| found.iter().any(|id| id == editor.id))
        .map(|editor| EditorChoice {
            id: editor.id,
            name: editor.name,
        })
        .collect()
}

/// Opens `launch` as `plan` says, with the machine's answers from LaunchServices.
fn open_with(
    launch: &Launch,
    chosen: Option<&str>,
    in_editor: bool,
    run: impl FnOnce(&str, &[std::ffi::OsString]) -> Result<(), RpcError>,
) -> Result<(), RpcError> {
    let found = std::cell::OnceCell::new();
    let installed = |id: &str| {
        found
            .get_or_init(|| {
                let ids: Vec<&str> = EDITORS.iter().map(|editor| editor.id).collect();
                installed_ids(&ids)
            })
            .iter()
            .any(|found| found == id)
    };
    let text = |path: &std::path::Path| {
        is_text(path, &|extension| {
            osascript(CONFORMS_SCRIPT, &[extension]).as_deref() == Some("yes")
        })
    };
    let (program, args) = plan(
        launch,
        chosen,
        in_editor,
        &Machine {
            installed: &installed,
            text: &text,
        },
    )?;
    run(&program, &args)
}

/// Hands the system the target; a text file opens in the chosen editor at its line when that takes one, anything else in its default app (a folder in Finder).
pub fn launch(launch: &Launch, chosen: Option<&str>) -> Result<(), RpcError> {
    open_with(launch, chosen, false, |program, args| {
        Command::new(program)
            .args(args)
            .spawn()
            .map(drop)
            .map_err(|err| RpcError::new(rpc::code::INTERNAL, format!("{program}: {err}")))
    })
}

/// `open_in_editor`: the directory or text file (at `line`) opens in the chosen code editor (`scenarios/ui-rail-actions.md` U429, `scenarios/ui-worktree-changes.md` U2539c, `scenarios/ui-app-settings.md` U6372b).
pub fn open_in_editor(path: &str, line: Option<u32>, chosen: Option<&str>) -> Result<(), RpcError> {
    let path = parse_path(path)?;
    let line = line.filter(|_| path.is_file());

    open_with(
        &Launch::Path { path, line },
        chosen,
        true,
        |program, args| {
            let output = Command::new(program)
                .args(args)
                .output()
                .map_err(|err| RpcError::new(rpc::code::INTERNAL, format!("{program}: {err}")))?;
            if output.status.success() {
                Ok(())
            } else {
                Err(RpcError::new(
                    rpc::code::INTERNAL,
                    format!(
                        "{program}: {}",
                        String::from_utf8_lossy(&output.stderr).trim()
                    ),
                ))
            }
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn u365b_a_home_path_expands() {
        let home = || Some(std::ffi::OsString::from("/Users/me"));

        assert_eq!(
            expand_home("~/notes/a.md", home()),
            PathBuf::from("/Users/me/notes/a.md")
        );
        assert_eq!(expand_home("~", home()), PathBuf::from("/Users/me"));
        assert_eq!(expand_home("~x/a", home()), PathBuf::from("~x/a"));
        assert_eq!(expand_home("/abs/a", home()), PathBuf::from("/abs/a"));
    }

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
    fn u365_an_absolute_path_keeps_its_line() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("a.ts");
        std::fs::write(&file, "x").unwrap();

        assert_eq!(
            check(path(file.to_str().unwrap())).unwrap(),
            Launch::Path {
                path: file,
                line: Some(42)
            }
        );
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

    fn present(ids: &[&'static str]) -> impl Fn(&str) -> bool {
        let ids = ids.to_vec();
        move |id| ids.contains(&id)
    }

    fn planned(
        path: &std::path::Path,
        line: Option<u32>,
        chosen: Option<&str>,
        in_editor: bool,
        ids: &[&'static str],
    ) -> Result<Opening, RpcError> {
        let installed = present(ids);
        let text = |path: &std::path::Path| {
            is_text(path, &|extension| ["swift", "ts"].contains(&extension))
        };
        plan(
            &Launch::Path {
                path: path.to_path_buf(),
                line,
            },
            chosen,
            in_editor,
            &Machine {
                installed: &installed,
                text: &text,
            },
        )
    }

    fn all() -> Vec<&'static str> {
        EDITORS.iter().map(|editor| editor.id).collect()
    }

    #[test]
    fn u6372b_the_chosen_editor_gets_text_files_at_their_line() {
        let dir = tempfile::tempdir().unwrap();
        let swift = dir.path().join("a b.swift");
        let justfile = dir.path().join("justfile");
        let png = dir.path().join("a.png");
        for file in [&swift, &justfile, &png] {
            std::fs::write(file, "x").unwrap();
        }
        let zed = Some("dev.zed.Zed");

        let (program, args) = planned(&swift, Some(12), zed, false, &all()).unwrap();
        assert_eq!(program, "open");
        assert_eq!(
            args,
            [
                "-b".into(),
                "dev.zed.Zed".into(),
                format!("zed://file{}/a%20b.swift:12", dir.path().display()).into()
            ] as [std::ffi::OsString; 3]
        );
        assert_eq!(
            planned(&justfile, Some(3), zed, false, &all()).unwrap().1[..2],
            ["-b", "dev.zed.Zed"]
        );
        for system in [&png, &dir.path().to_path_buf()] {
            let (_, args) = planned(system, None, zed, false, &all()).unwrap();
            assert_eq!(args, [system.as_os_str().to_owned()]);
        }
        let (_, args) =
            planned(&swift, Some(12), Some("com.apple.dt.Xcode"), false, &all()).unwrap();
        assert_eq!(
            args,
            [
                "-b".into(),
                "com.apple.dt.Xcode".into(),
                swift.into_os_string()
            ] as [std::ffi::OsString; 3]
        );
    }

    #[test]
    fn u6372b_open_in_editor_takes_a_folder_and_not_a_picture() {
        let dir = tempfile::tempdir().unwrap();
        let png = dir.path().join("a.png");
        std::fs::write(&png, "x").unwrap();

        let (_, folder) =
            planned(dir.path(), Some(5), Some("com.panic.Nova"), true, &all()).unwrap();
        let (_, picture) = planned(&png, None, Some("com.panic.Nova"), true, &all()).unwrap();

        assert_eq!(folder[..2], ["-b", "com.panic.Nova"]);
        assert_eq!(folder[2], dir.path().as_os_str().to_owned());
        assert_eq!(picture, [png.into_os_string()]);
    }

    #[test]
    fn u6372b_automatic_keeps_the_order_of_u2539c() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("a.ts");
        std::fs::write(&file, "x").unwrap();
        let first =
            |ids: &[&'static str]| planned(&file, None, None, false, ids).unwrap().1[1].clone();

        assert_eq!(
            first(&[
                "dev.zed.Zed",
                "com.microsoft.VSCode",
                "com.todesktop.230313mzl4w4u92"
            ]),
            "com.microsoft.VSCode"
        );
        assert_eq!(
            first(&["dev.zed.Zed", "com.todesktop.230313mzl4w4u92"]),
            "com.todesktop.230313mzl4w4u92"
        );
        assert_eq!(
            first(&["dev.zed.Zed-Preview", "dev.zed.Zed", "com.apple.dt.Xcode"]),
            "dev.zed.Zed"
        );
        assert_eq!(first(&["dev.zed.Zed-Preview"]), "dev.zed.Zed-Preview");
    }

    #[test]
    fn u6372c_a_missing_editor_fails_with_its_message() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("a.ts");
        std::fs::write(&file, "x").unwrap();

        let chosen = planned(
            &file,
            None,
            Some("dev.zed.Zed"),
            false,
            &["com.microsoft.VSCode"],
        )
        .unwrap_err();
        let automatic = planned(dir.path(), None, None, true, &["com.apple.dt.Xcode"]).unwrap_err();

        assert_eq!(chosen.code, rpc::code::NOT_FOUND);
        assert_eq!(
            chosen.message,
            "Zed is not installed; choose another in Settings"
        );
        assert_eq!(
            automatic.message,
            "no code editor found; choose one in Settings"
        );
        let (_, opened) = planned(&file, None, None, false, &[]).unwrap();
        assert_eq!(opened, [file.into_os_string()]);
    }

    #[test]
    fn u429_a_relative_path_is_conflict() {
        assert_eq!(
            open_in_editor("src", None, None).unwrap_err().code,
            rpc::code::CONFLICT
        );
    }

    #[test]
    fn u429_a_missing_path_is_not_found() {
        assert_eq!(
            open_in_editor("/no/such/roundup/dir", None, None)
                .unwrap_err()
                .code,
            rpc::code::NOT_FOUND
        );
    }
}
