//! FB2, FB3: the shot of the roundup window and the App's debug facts for a Feedback report
//! (`scenarios/feedback-report.md`). The capture sits behind `Display`; the OS side stays outside the tests.

use std::path::{Path, PathBuf};

use base64::Engine;
use rpc::RpcError;
use serde::Serialize;
use tauri::{Manager, Runtime, WebviewWindow};

/// Policy: the log lines a report carries.
const LOG_LINES: usize = 200;

/// The seam: a PNG of the window as drawn now.
pub(crate) trait Display {
    fn capture_png(&self) -> Result<Vec<u8>, String>;
}

/// What the App reads from the machine. It holds no environment value: a report never carries one.
pub(crate) trait Host {
    fn macos_version(&self) -> String;
    fn app_log(&self) -> Option<PathBuf>;
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub(crate) struct AppFacts {
    pub version: String,
    pub commit: String,
    pub macos: String,
    pub log: Vec<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub(crate) struct Report {
    /// Base64 PNG; `None` when the capture failed.
    pub shot: Option<String>,
    /// Why there is no shot.
    pub shot_error: Option<String>,
    pub facts: AppFacts,
}

/// `[redacted]` replaces a whole line holding a GitHub token, a bearer credential or a token variable.
fn redact(line: &str) -> String {
    let token = |prefix: &str, rest: &dyn Fn(char) -> bool| {
        line.match_indices(prefix).any(|(at, _)| {
            line[at + prefix.len()..]
                .chars()
                .take_while(|c| rest(*c))
                .count()
                >= 1
        })
    };
    let alnum = |c: char| c.is_ascii_alphanumeric();
    let secret = ["ghp_", "gho_", "ghu_", "ghs_", "ghr_"]
        .iter()
        .any(|p| token(p, &alnum))
        || token("github_pat_", &|c| alnum(c) || c == '_')
        || token("Bearer ", &|c| !c.is_whitespace())
        || ["GH_TOKEN=", "GITHUB_TOKEN="]
            .iter()
            .any(|p| line.contains(p));
    if secret {
        "[redacted]".into()
    } else {
        line.into()
    }
}

fn log_tail(path: &Path) -> Vec<String> {
    let text = std::fs::read(path)
        .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
        .unwrap_or_default();
    let lines: Vec<&str> = text.lines().collect();
    lines[lines.len().saturating_sub(LOG_LINES)..]
        .iter()
        .map(|line| redact(line))
        .collect()
}

/// FB8: the newest `.log` file in `dir` written since `since`, the file this run writes; an
/// older file is a past run's.
fn this_runs_log(dir: &Path, since: std::time::SystemTime) -> Option<PathBuf> {
    std::fs::read_dir(dir)
        .ok()?
        .filter_map(Result::ok)
        .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "log"))
        .filter_map(|entry| Some((entry.metadata().ok()?.modified().ok()?, entry.path())))
        .filter(|(modified, _)| *modified >= since)
        .max()
        .map(|(_, path)| path)
}

pub(crate) fn facts(host: &dyn Host) -> AppFacts {
    AppFacts {
        version: env!("CARGO_PKG_VERSION").into(),
        commit: option_env!("ROUNDUP_COMMIT").unwrap_or_default().into(),
        macos: host.macos_version(),
        log: host
            .app_log()
            .map(|path| log_tail(&path))
            .unwrap_or_default(),
    }
}

pub(crate) fn report(display: &dyn Display, host: &dyn Host) -> Report {
    let (shot, shot_error) = match display.capture_png() {
        Ok(png) => (
            Some(base64::engine::general_purpose::STANDARD.encode(png)),
            None,
        ),
        Err(cause) => (None, Some(cause)),
    };
    Report {
        shot,
        shot_error,
        facts: facts(host),
    }
}

struct Machine {
    log_dir: Option<PathBuf>,
}

impl Host for Machine {
    fn macos_version(&self) -> String {
        std::process::Command::new("sw_vers")
            .arg("-productVersion")
            .output()
            .ok()
            .filter(|out| out.status.success())
            .and_then(|out| String::from_utf8(out.stdout).ok())
            .map(|text| text.trim().to_owned())
            .unwrap_or_default()
    }

    fn app_log(&self) -> Option<PathBuf> {
        this_runs_log(self.log_dir.as_deref()?, *crate::diagnostics::RUN_START)
    }
}

/// The App's main window through `screencapture -l`: the window's composited pixels, so Terminal
/// canvases show, and no Screen Recording prompt for the App's own window.
struct Window;

impl Display for Window {
    #[cfg(target_os = "macos")]
    fn capture_png(&self) -> Result<Vec<u8>, String> {
        use objc2_app_kit::NSApplication;
        use objc2_foundation::MainThreadMarker;

        let mtm = MainThreadMarker::new().ok_or("the shot is taken on the main thread")?;
        let app = NSApplication::sharedApplication(mtm);
        let number = app
            .mainWindow()
            .or_else(|| app.keyWindow())
            .map(|window| window.windowNumber())
            .ok_or("the window is not on screen")?;
        let file = std::env::temp_dir().join(format!("roundup-shot-{}.png", std::process::id()));
        let status = std::process::Command::new("/usr/sbin/screencapture")
            .args(["-x", "-o", "-t", "png", "-l", &number.to_string()])
            .arg(&file)
            .status()
            .map_err(|error| error.to_string())?;
        let png = std::fs::read(&file).map_err(|_| "the system refused the capture".to_owned());
        let _ = std::fs::remove_file(&file);
        if status.success() {
            png
        } else {
            Err("the system refused the capture".into())
        }
    }

    #[cfg(not(target_os = "macos"))]
    fn capture_png(&self) -> Result<Vec<u8>, String> {
        Err("the shot needs macOS".into())
    }
}

/// The shot of the main window as drawn now, with the App's facts. Sync, so Tauri runs it on the main thread.
#[tauri::command]
pub(crate) fn feedback_capture<R: Runtime>(window: WebviewWindow<R>) -> Result<Report, RpcError> {
    let log_dir = window.app_handle().path().app_log_dir().ok();
    Ok(report(&Window, &Machine { log_dir }))
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fake(Result<Vec<u8>, String>);
    impl Display for Fake {
        fn capture_png(&self) -> Result<Vec<u8>, String> {
            self.0.clone()
        }
    }

    struct Host1(Option<PathBuf>);
    impl Host for Host1 {
        fn macos_version(&self) -> String {
            "15.1".into()
        }
        fn app_log(&self) -> Option<PathBuf> {
            self.0.clone()
        }
    }

    const PNG: &[u8] = b"\x89PNG\r\n\x1a\nfixed";

    #[test]
    fn fb2_the_capture_seam_returns_a_png_of_the_window() {
        let ok = report(&Fake(Ok(PNG.to_vec())), &Host1(None));
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(ok.shot.unwrap())
            .unwrap();
        assert_eq!(bytes, PNG);
        let failed = report(&Fake(Err("refused".into())), &Host1(None));
        assert_eq!(
            (failed.shot, failed.shot_error),
            (None, Some("refused".into()))
        );
    }

    #[test]
    fn fb3_the_facts_name_version_os_daemon_and_selection() {
        let facts = facts(&Host1(None));
        assert_eq!(facts.version, env!("CARGO_PKG_VERSION"));
        assert_eq!(facts.macos, "15.1");
    }

    #[test]
    fn fb3_the_logs_end_at_their_last_200_lines() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("shell.log");
        let text: String = (0..500).map(|n| format!("line {n}\n")).collect();
        std::fs::write(&path, text).unwrap();
        let log = facts(&Host1(Some(path))).log;
        assert_eq!(
            (log.len(), log[0].as_str(), log[199].as_str()),
            (200, "line 300", "line 499")
        );
    }

    #[test]
    fn fb8_the_app_log_ends_with_this_runs_lines() {
        let dir = tempfile::tempdir().unwrap();
        let old = dir.path().join("shell_old.log");
        let current = dir.path().join("shell.log");
        std::fs::write(&old, "2026-11-04 old line\n").unwrap();
        let start = std::time::SystemTime::now();
        std::fs::File::options()
            .write(true)
            .open(&old)
            .unwrap()
            .set_modified(start - std::time::Duration::from_secs(3600))
            .unwrap();
        std::fs::write(&current, "this run first\nthis run last\n").unwrap();
        let path = this_runs_log(dir.path(), start - std::time::Duration::from_secs(60)).unwrap();
        assert_eq!(path, current);
        assert_eq!(log_tail(&path).last().unwrap(), "this run last");
        assert!(this_runs_log(dir.path(), start + std::time::Duration::from_secs(60)).is_none());
    }

    #[test]
    fn fb3_a_token_in_a_log_is_redacted_before_it_is_shown() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("shell.log");
        std::fs::write(
            &path,
            "ok\nuse ghp_abc123 now\ngithub_pat_11AA_bb\nAuthorization: Bearer xyz\nGH_TOKEN=abc\nGITHUB_TOKEN=\nBearer \nghp_\n",
        )
        .unwrap();
        let log = facts(&Host1(Some(path))).log;
        assert_eq!(
            log,
            [
                "ok",
                "[redacted]",
                "[redacted]",
                "[redacted]",
                "[redacted]",
                "[redacted]",
                "Bearer ",
                "ghp_"
            ]
        );
    }

    #[test]
    fn fb3_no_environment_value_or_scrollback_is_collected() {
        let json = serde_json::to_string(&report(&Fake(Ok(PNG.to_vec())), &Host1(None))).unwrap();
        let path = std::env::var("PATH").unwrap();
        assert!(!json.contains(&path));
    }
}
