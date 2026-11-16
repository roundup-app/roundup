//! U7210b, U7210d (`scenarios/send-feedback.md`): the shot of the roundup window, under 2 MB, and the
//! App's versions for Send feedback…. The capture sits behind `Display`; the OS side stays outside the tests.

use base64::Engine;
use rpc::RpcError;
use serde::Serialize;
use tauri::{Runtime, WebviewWindow};

/// U7210d: a shot of more bytes than this is scaled down until it has fewer.
const SHOT_LIMIT: usize = 2_000_000;

/// The seam: a PNG of the window as drawn now.
pub(crate) trait Display {
    fn capture_png(&self) -> Result<Vec<u8>, String>;
}

/// What the App reads from the machine. It holds no environment value: a report never carries one.
pub(crate) trait Host {
    fn macos_version(&self) -> String;
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub(crate) struct AppFacts {
    pub version: String,
    pub commit: String,
    pub macos: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub(crate) struct Report {
    /// Base64 PNG; `None` when the capture failed.
    pub shot: Option<String>,
    /// Why there is no shot.
    pub shot_error: Option<String>,
    pub facts: AppFacts,
}

pub(crate) fn facts(host: &dyn Host) -> AppFacts {
    AppFacts {
        version: env!("CARGO_PKG_VERSION").into(),
        commit: option_env!("ROUNDUP_COMMIT").unwrap_or_default().into(),
        macos: host.macos_version(),
    }
}

/// U7210d: `png` as it is when it fits, else scaled down in steps of at least a tenth until it does.
fn fit(mut png: Vec<u8>) -> Result<Vec<u8>, String> {
    if png.len() <= SHOT_LIMIT {
        return Ok(png);
    }
    let mut image = image::load_from_memory_with_format(&png, image::ImageFormat::Png)
        .map_err(|error| error.to_string())?;
    while png.len() > SHOT_LIMIT {
        let scale = (SHOT_LIMIT as f64 / png.len() as f64).sqrt() * 0.9;
        let side = |length: u32| ((f64::from(length) * scale) as u32).max(1);
        image = image.resize_exact(
            side(image.width()),
            side(image.height()),
            image::imageops::FilterType::Triangle,
        );
        png.clear();
        image
            .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
            .map_err(|error| error.to_string())?;
    }
    Ok(png)
}

pub(crate) fn report(display: &dyn Display, host: &dyn Host) -> Report {
    let (shot, shot_error) = match display.capture_png().and_then(fit) {
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

struct Machine;

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
pub(crate) fn feedback_capture<R: Runtime>(_window: WebviewWindow<R>) -> Result<Report, RpcError> {
    Ok(report(&Window, &Machine))
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

    struct Host1;
    impl Host for Host1 {
        fn macos_version(&self) -> String {
            "15.1".into()
        }
    }

    const PNG: &[u8] = b"\x89PNG\r\n\x1a\nfixed";

    /// A 1000 by 1000 PNG of noise, over 2 MB because noise does not compress.
    fn noisy_png() -> Vec<u8> {
        let image = image::RgbImage::from_fn(1000, 1000, |x, y| {
            let h = (u64::from(x).wrapping_mul(0x9E37_79B9_7F4A_7C15)
                ^ u64::from(y).wrapping_mul(0xC2B2_AE3D_27D4_EB4F))
            .wrapping_mul(0x1656_67B1_9E37_79F9);
            image::Rgb([(h >> 8) as u8, (h >> 24) as u8, (h >> 40) as u8])
        });
        let mut png = Vec::new();
        image
            .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
            .unwrap();
        png
    }

    #[test]
    fn u7210d_a_shot_over_2_mb_is_scaled_under_it() {
        let big = noisy_png();
        assert!(big.len() > SHOT_LIMIT);
        let fitted = fit(big).unwrap();
        assert!(fitted.len() <= SHOT_LIMIT);
        let image = image::load_from_memory_with_format(&fitted, image::ImageFormat::Png).unwrap();
        assert!(image.width() < 1000 && image.height() < 1000);
        assert_eq!(image.width(), image.height(), "the shot keeps its shape");
    }

    #[test]
    fn u7210d_a_shot_under_2_mb_is_unchanged() {
        assert_eq!(fit(PNG.to_vec()).unwrap(), PNG);
    }

    #[test]
    fn u7210d_the_capture_seam_returns_a_png_of_the_window() {
        let ok = report(&Fake(Ok(PNG.to_vec())), &Host1);
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(ok.shot.unwrap())
            .unwrap();
        assert_eq!(bytes, PNG);
        let failed = report(&Fake(Err("refused".into())), &Host1);
        assert_eq!(
            (failed.shot, failed.shot_error),
            (None, Some("refused".into()))
        );
    }

    #[test]
    fn u7210b_the_facts_name_version_and_os() {
        let facts = facts(&Host1);
        assert_eq!(facts.version, env!("CARGO_PKG_VERSION"));
        assert_eq!(facts.macos, "15.1");
    }
}
