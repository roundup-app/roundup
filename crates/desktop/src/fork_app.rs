//! FA5980: the Fork's own App: its recoloured icon, its small `.app`, its title and menu-bar mark.

use contracts::data::{ForkColour, ForkRecord};
use icns::{IconFamily, IconType, Image as Icon, PixelFormat};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::image::Image;

/// The live Dock icon; the Fork icon recolours its plate only.
const ARTWORK: &[u8] = include_bytes!("../icons/artwork.png");

/// The plate's tone in `artwork.png` (S12).
const PLATE: [u8; 3] = [0xe8, 0x57, 0x2a];

/// How far (Euclidean, in RGB) a pixel may lie from the plate tone and still be plate, edge shading included.
const PLATE_REACH: f64 = 60.0;

/// The Fork the running App is on: its name and colour.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Fork {
    pub name: String,
    pub colour: ForkColour,
}

/// The managed state: `Some` while the App runs on a Fork's data folder.
#[derive(Debug, Default)]
pub(crate) struct Identity(pub Option<Fork>);

impl Identity {
    pub(crate) fn of(folder: Option<&Path>) -> Self {
        Self(folder.and_then(read))
    }

    pub(crate) fn name(&self) -> Option<&str> {
        self.0.as_ref().map(|fork| fork.name.as_str())
    }
}

fn record(folder: &Path) -> Option<ForkRecord> {
    let text = fs::read_to_string(folder.join("fork.json")).ok()?;
    serde_json::from_str(&text).ok()
}

/// The Fork whose data folder is `folder`; `None` for the live folder or an unreadable `fork.json`.
pub(crate) fn read(folder: &Path) -> Option<Fork> {
    record(folder).map(|record| Fork {
        name: record.name,
        colour: record.colour,
    })
}

/// The hue of the colour in `docs/design-system.md`, "Fork colour accents".
fn hue(colour: ForkColour) -> f64 {
    match colour {
        ForkColour::Red => 355.0,
        ForkColour::Orange => 17.0,
        ForkColour::Amber => 38.0,
        ForkColour::Green => 145.0,
        ForkColour::Teal => 175.0,
        ForkColour::Blue => 215.0,
        ForkColour::Violet => 268.0,
        ForkColour::Pink => 328.0,
    }
}

/// The light `--accent` of the colour in `docs/design-system.md`.
pub(crate) fn accent(colour: ForkColour) -> [u8; 3] {
    match colour {
        ForkColour::Red => [0xcb, 0x00, 0x11],
        ForkColour::Orange => [0xb2, 0x33, 0x00],
        ForkColour::Amber => [0x90, 0x5b, 0x00],
        ForkColour::Green => [0x00, 0x75, 0x31],
        ForkColour::Teal => [0x00, 0x71, 0x68],
        ForkColour::Blue => [0x00, 0x57, 0xd1],
        ForkColour::Violet => [0x62, 0x00, 0xd1],
        ForkColour::Pink => [0xc4, 0x00, 0x69],
    }
}

/// Whether the colour is part of the plate, shading of its edge included.
pub(crate) fn is_plate(rgb: [u8; 3]) -> bool {
    let sum: f64 = rgb
        .iter()
        .zip(PLATE)
        .map(|(a, b)| (f64::from(*a) - f64::from(b)).powi(2))
        .sum();
    sum.sqrt() <= PLATE_REACH
}

fn to_hsl([r, g, b]: [u8; 3]) -> (f64, f64, f64) {
    let [r, g, b] = [r, g, b].map(|c| f64::from(c) / 255.0);
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let lightness = (max + min) / 2.0;
    let delta = max - min;
    if delta == 0.0 {
        return (0.0, 0.0, lightness);
    }
    let saturation = delta / (1.0 - (2.0 * lightness - 1.0).abs());
    let hue = if max == r {
        ((g - b) / delta).rem_euclid(6.0)
    } else if max == g {
        (b - r) / delta + 2.0
    } else {
        (r - g) / delta + 4.0
    };
    (hue * 60.0, saturation, lightness)
}

fn from_hsl(hue: f64, saturation: f64, lightness: f64) -> [u8; 3] {
    let chroma = (1.0 - (2.0 * lightness - 1.0).abs()) * saturation;
    let sector = hue.rem_euclid(360.0) / 60.0;
    let second = chroma * (1.0 - (sector % 2.0 - 1.0).abs());
    let (r, g, b) = match sector as u8 {
        0 => (chroma, second, 0.0),
        1 => (second, chroma, 0.0),
        2 => (0.0, chroma, second),
        3 => (0.0, second, chroma),
        4 => (second, 0.0, chroma),
        _ => (chroma, 0.0, second),
    };
    let base = lightness - chroma / 2.0;
    // each channel is clamped to 0..1 before scaling to a byte.
    [r, g, b].map(|c| ((c + base).clamp(0.0, 1.0) * 255.0).round() as u8)
}

/// FA5980a: `artwork` (a PNG) with only its plate in the Fork colour's hue.
pub(crate) fn render_icon(artwork: &[u8], colour: ForkColour) -> Result<Icon, String> {
    let mut icon = Icon::read_png(std::io::Cursor::new(artwork)).map_err(|e| e.to_string())?;
    if icon.pixel_format() != PixelFormat::RGBA {
        icon = icon.convert_to(PixelFormat::RGBA);
    }
    let target = hue(colour);
    for pixel in icon.data_mut().as_chunks_mut::<4>().0.iter_mut() {
        let rgb = [pixel[0], pixel[1], pixel[2]];
        if pixel[3] > 0 && is_plate(rgb) {
            let (_, saturation, lightness) = to_hsl(rgb);
            pixel[..3].copy_from_slice(&from_hsl(target, saturation, lightness));
        }
    }
    Ok(icon)
}

/// FA5980c: the Fork icon for the data folder `folder`; `None` keeps the live icon.
#[cfg(any(test, target_vendor = "apple"))]
pub(crate) fn fork_icon(folder: &Path) -> Option<Image<'static>> {
    let fork = read(folder)?;
    let icon = render_icon(ARTWORK, fork.colour).ok()?;
    Some(Image::new_owned(icon.into_data().into_vec(), 1024, 1024))
}

/// The PNG bytes of `image`, which the native icon call takes.
#[cfg(any(test, target_vendor = "apple"))]
pub(crate) fn png(image: &Image<'_>) -> Option<Vec<u8>> {
    let icon = Icon::from_data(
        PixelFormat::RGBA,
        image.width(),
        image.height(),
        image.rgba().to_vec(),
    )
    .ok()?;
    let mut out = Vec::new();
    icon.write_png(&mut out).ok()?;
    Some(out)
}

/// FA5980d: the window title; a Fork's name is never dropped from it.
pub(crate) fn window_title(fork: Option<&str>, title: &str) -> String {
    match fork {
        Some(name) => format!("{title} — {name}"),
        None => title.to_owned(),
    }
}

/// FA5980d: the menu-bar mark's pixels for a Fork: the glyph's alpha in the Fork colour's Token.
pub(crate) fn tint(image: &Image<'_>, colour: ForkColour) -> Image<'static> {
    let [r, g, b] = accent(colour);
    let mut rgba = image.rgba().to_vec();
    for pixel in rgba.as_chunks_mut::<4>().0.iter_mut() {
        pixel[..3].copy_from_slice(&[r, g, b]);
    }
    Image::new_owned(rgba, image.width(), image.height())
}

/// The mean of `rgba` over `factor` by `factor` blocks, weighted by alpha.
fn shrink(rgba: &[u8], side: usize, factor: usize) -> Vec<u8> {
    let out = side / factor;
    let mut small = vec![0u8; out * out * 4];
    for y in 0..out {
        for x in 0..out {
            let mut colour = [0u64; 3];
            let mut total = 0u64;
            for dy in 0..factor {
                for dx in 0..factor {
                    let at = ((y * factor + dy) * side + x * factor + dx) * 4;
                    let byte = |i: usize| rgba.get(i).copied().map_or(0, u64::from);
                    let alpha = byte(at + 3);
                    for (c, sum) in colour.iter_mut().enumerate() {
                        *sum += byte(at + c) * alpha;
                    }
                    total += alpha;
                }
            }
            let n = (factor * factor) as u64;
            if let Some(pixel) = small.as_chunks_mut::<4>().0.get_mut(y * out + x) {
                for (byte, sum) in pixel.iter_mut().zip(colour) {
                    *byte = sum.checked_div(total).unwrap_or(0) as u8;
                }
                pixel[3] = (total / n) as u8;
            }
        }
    }
    small
}

fn icns_of(icon: &Icon) -> Result<Vec<u8>, String> {
    let side = icon.width() as usize;
    let sizes = [
        (IconType::RGBA32_16x16, 16),
        (IconType::RGBA32_16x16_2x, 32),
        (IconType::RGBA32_32x32, 32),
        (IconType::RGBA32_32x32_2x, 64),
        (IconType::RGBA32_128x128, 128),
        (IconType::RGBA32_128x128_2x, 256),
        (IconType::RGBA32_256x256, 256),
        (IconType::RGBA32_256x256_2x, 512),
        (IconType::RGBA32_512x512, 512),
        (IconType::RGBA32_512x512_2x, 1024),
    ];
    let mut family = IconFamily::new();
    for (kind, px) in sizes {
        let data = shrink(icon.data(), side, side / px);
        let image = Icon::from_data(PixelFormat::RGBA, px as u32, px as u32, data)
            .map_err(|e| e.to_string())?;
        family
            .add_icon_with_type(&image, kind)
            .map_err(|e| e.to_string())?;
    }
    let mut out = Vec::new();
    family.write(&mut out).map_err(|e| e.to_string())?;
    Ok(out)
}

fn escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// A name safe as a folder name and bundle identifier part.
fn slug(text: &str) -> String {
    text.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_owned()
}

fn plist(name: &str, identifier: &str) -> String {
    let name = escape(name);
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n\
<plist version=\"1.0\">\n<dict>\n\
\t<key>CFBundleName</key>\n\t<string>{name}</string>\n\
\t<key>CFBundleDisplayName</key>\n\t<string>{name}</string>\n\
\t<key>CFBundleExecutable</key>\n\t<string>roundup</string>\n\
\t<key>CFBundleIconFile</key>\n\t<string>fork</string>\n\
\t<key>CFBundlePackageType</key>\n\t<string>APPL</string>\n\
\t<key>CFBundleIdentifier</key>\n\t<string>{identifier}</string>\n\
</dict>\n</plist>\n"
    )
}

fn shell_quote(path: &Path) -> String {
    format!("'{}'", path.to_string_lossy().replace('\'', "'\\''"))
}

/// U6266b: the `.app`'s executable: Finder gives the binary no environment, so it names the Fork's
/// folder and drops the live App's per-instance variables before it runs the binary.
fn launcher_script(fork: &Path, binary: &Path) -> String {
    format!(
        "#!/bin/sh\nunset ROUNDUP_DEV_PORT ROUNDUP_SLOT ROUNDUP_RUPD_BIN\nROUNDUP_DATA_DIR={} exec {} \"$@\"\n",
        shell_quote(fork),
        shell_quote(binary)
    )
}

/// FA5980b: `<fork>/<name>.app`, its executable a launcher that runs `binary` on the Fork. Replaces an earlier one;
/// a failure leaves no half-made bundle.
pub(crate) fn make(fork: &Path, binary: &Path) -> Result<PathBuf, String> {
    make_from(fork, binary, ARTWORK)
}

fn make_from(fork: &Path, binary: &Path, artwork: &[u8]) -> Result<PathBuf, String> {
    let record =
        record(fork).ok_or_else(|| format!("{}: no readable fork.json", fork.display()))?;
    let folder = fork
        .file_name()
        .map(|name| slug(&name.to_string_lossy()))
        .filter(|slug| !slug.is_empty())
        .ok_or_else(|| format!("{}: no folder name", fork.display()))?;
    let identifier = format!("app.roundup.fork.{folder}");
    let file: String = record
        .name
        .chars()
        .map(|c| {
            if c == '/' || c == ':' || c.is_control() {
                '-'
            } else {
                c
            }
        })
        .collect();
    let target = fork.join(format!("{file}.app"));
    let scratch = fork.join(".roundup-app.tmp");
    let _ = fs::remove_dir_all(&scratch);
    let built = (|| -> Result<(), String> {
        let icon = render_icon(artwork, record.colour)?;
        let io = |e: std::io::Error| e.to_string();
        fs::create_dir_all(scratch.join("Contents/MacOS")).map_err(io)?;
        fs::create_dir_all(scratch.join("Contents/Resources")).map_err(io)?;
        fs::write(
            scratch.join("Contents/Info.plist"),
            plist(&record.name, &identifier),
        )
        .map_err(io)?;
        fs::write(
            scratch.join("Contents/Resources/fork.icns"),
            icns_of(&icon)?,
        )
        .map_err(io)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let launcher = scratch.join("Contents/MacOS/roundup");
            fs::write(&launcher, launcher_script(fork, binary)).map_err(io)?;
            fs::set_permissions(&launcher, fs::Permissions::from_mode(0o755)).map_err(io)?;
        }
        #[cfg(not(unix))]
        return Err("a Fork's .app needs a unix launcher".into());
        // A renamed Fork leaves no `.app` of its old name behind.
        for entry in fs::read_dir(fork).map_err(io)?.flatten() {
            if entry.path().extension().is_some_and(|ext| ext == "app") {
                fs::remove_dir_all(entry.path()).map_err(io)?;
            }
        }
        fs::rename(&scratch, &target).map_err(io)
    })();
    if let Err(error) = built {
        let _ = fs::remove_dir_all(&scratch);
        return Err(error);
    }
    Ok(target)
}

#[cfg(test)]
mod tests {
    use super::*;

    const COLOURS: [ForkColour; 8] = [
        ForkColour::Red,
        ForkColour::Orange,
        ForkColour::Amber,
        ForkColour::Green,
        ForkColour::Teal,
        ForkColour::Blue,
        ForkColour::Violet,
        ForkColour::Pink,
    ];

    fn source() -> Icon {
        Icon::read_png(std::io::Cursor::new(ARTWORK)).unwrap()
    }

    fn fork_in(parent: &Path, folder: &str, name: &str, colour: ForkColour) -> PathBuf {
        let dir = parent.join(folder);
        fs::create_dir_all(&dir).unwrap();
        let record = ForkRecord {
            name: name.into(),
            colour,
            source: "live".into(),
            created_ms: 1,
            projects: None,
        };
        fs::write(
            dir.join("fork.json"),
            serde_json::to_string(&record).unwrap(),
        )
        .unwrap();
        dir
    }

    fn hue_gap(a: f64, b: f64) -> f64 {
        let d = (a - b).rem_euclid(360.0);
        d.min(360.0 - d)
    }

    #[test]
    fn fa5980a_only_the_plate_takes_the_fork_hue() {
        let from = source();
        for colour in COLOURS {
            let to = render_icon(ARTWORK, colour).unwrap();
            assert_eq!((to.width(), to.height()), (1024, 1024));
            let (mut sin, mut cos, mut plate) = (0.0f64, 0.0f64, 0usize);
            for (a, b) in from
                .data()
                .as_chunks::<4>()
                .0
                .iter()
                .zip(to.data().as_chunks::<4>().0.iter())
            {
                assert_eq!(a[3], b[3], "alpha");
                if a[3] > 0 && is_plate([a[0], a[1], a[2]]) {
                    let (h, s, _) = to_hsl([b[0], b[1], b[2]]);
                    if s > 0.3 {
                        sin += h.to_radians().sin();
                        cos += h.to_radians().cos();
                        plate += 1;
                    }
                } else {
                    assert_eq!(a, b, "a pixel outside the plate changed");
                }
            }
            assert!(plate > 400_000);
            let mean = sin.atan2(cos).to_degrees().rem_euclid(360.0);
            assert!(hue_gap(mean, hue(colour)) < 6.0, "{colour:?}: {mean}");
        }
    }

    #[test]
    fn fa5980a_orange_stays_near_the_source_plate() {
        let from = source();
        let to = render_icon(ARTWORK, ForkColour::Orange).unwrap();
        for (a, b) in from
            .data()
            .as_chunks::<4>()
            .0
            .iter()
            .zip(to.data().as_chunks::<4>().0.iter())
        {
            // a faint edge pixel carries too little alpha to see.
            for c in (0..3).filter(|_| a[3] > 200) {
                assert!(a[c].abs_diff(b[c]) <= 24, "{a:?} {b:?}");
            }
        }
    }

    #[test]
    fn fa5980a_the_live_icon_is_not_touched() {
        let icons = Path::new(env!("CARGO_MANIFEST_DIR")).join("icons");
        let read = || {
            (
                fs::read(icons.join("icon.png")).unwrap(),
                fs::read(icons.join("artwork.png")).unwrap(),
            )
        };
        let before = read();
        let tmp = tempfile::tempdir().unwrap();
        let fork = fork_in(tmp.path(), "a", "A", ForkColour::Blue);
        make(&fork, Path::new("/bin/true")).unwrap();
        assert!(read() == before);
    }

    #[test]
    fn fa5980b_the_app_holds_plist_icon_and_a_link() {
        let tmp = tempfile::tempdir().unwrap();
        let one = fork_in(tmp.path(), "feature-x", "Feature <X>", ForkColour::Teal);
        let two = fork_in(tmp.path(), "other", "Other", ForkColour::Pink);
        let binary = tmp.path().join("roundup-bin");
        let app = make(&one, &binary).unwrap();
        assert_eq!(app, one.join("Feature <X>.app"));
        let plist_text = fs::read_to_string(app.join("Contents/Info.plist")).unwrap();
        assert_eq!(
            plist_text
                .matches("<string>Feature &lt;X&gt;</string>")
                .count(),
            2
        );
        for token in [
            "<key>CFBundleExecutable</key>\n\t<string>roundup</string>",
            "<key>CFBundleIconFile</key>\n\t<string>fork</string>",
            "<key>CFBundlePackageType</key>\n\t<string>APPL</string>",
            "<string>app.roundup.fork.feature-x</string>",
        ] {
            assert!(plist_text.contains(token), "{token}");
        }
        let family =
            IconFamily::read(fs::File::open(app.join("Contents/Resources/fork.icns")).unwrap())
                .unwrap();
        let mut sizes: Vec<_> = family
            .available_icons()
            .iter()
            .map(|kind| kind.pixel_width())
            .collect();
        sizes.sort_unstable();
        assert_eq!(sizes.len(), 10);
        assert_eq!((sizes[0], sizes[9]), (16, 1024));
        let two = make(&two, &binary).unwrap();
        let other = fs::read_to_string(two.join("Contents/Info.plist")).unwrap();
        assert!(
            other.contains("app.roundup.fork.other")
                && !other.contains("app.roundup.fork.feature-x")
        );
    }

    #[test]
    fn fa5980b_making_again_replaces_and_follows_a_rename() {
        let tmp = tempfile::tempdir().unwrap();
        let fork = fork_in(tmp.path(), "f", "Old", ForkColour::Red);
        let binary = Path::new("/bin/true");
        make(&fork, binary).unwrap();
        make(&fork, binary).unwrap();
        fork_in(tmp.path(), "f", "New", ForkColour::Red);
        let app = make(&fork, binary).unwrap();
        assert!(!fork.join("Old.app").exists());
        let text = fs::read_to_string(app.join("Contents/Info.plist")).unwrap();
        assert!(text.contains("<string>New</string>") && text.contains("app.roundup.fork.f<"));
    }

    #[test]
    fn fa5980b_a_failed_make_leaves_no_bundle() {
        let tmp = tempfile::tempdir().unwrap();
        let fork = fork_in(tmp.path(), "f", "F", ForkColour::Red);
        assert!(make_from(&fork, Path::new("/bin/true"), b"not a png").is_err());
        let left: Vec<_> = fs::read_dir(&fork)
            .unwrap()
            .flatten()
            .map(|e| e.file_name())
            .collect();
        assert_eq!(left, ["fork.json"]);
    }

    #[test]
    fn fa5980c_the_icon_is_the_forks_only() {
        let tmp = tempfile::tempdir().unwrap();
        let fork = fork_in(tmp.path(), "f", "F", ForkColour::Green);
        let image = fork_icon(&fork).unwrap();
        assert_eq!((image.width(), image.height()), (1024, 1024));
        assert!(png(&image).unwrap().starts_with(b"\x89PNG"));
        assert!(fork_icon(&tmp.path().join("live")).is_none());
        fs::write(fork.join("fork.json"), "{").unwrap();
        assert!(fork_icon(&fork).is_none());
    }

    #[test]
    fn fa5980d_the_title_keeps_the_fork_name() {
        let long = "x".repeat(40);
        for name in ["a", long.as_str(), "🤌 fork"] {
            assert_eq!(
                window_title(Some(name), "roundup"),
                format!("roundup — {name}")
            );
            assert!(window_title(Some(name), "Project").ends_with(&format!(" — {name}")));
        }
        assert_eq!(window_title(None, "roundup"), "roundup");
    }

    #[test]
    fn fa5980e_a_make_writes_only_under_the_fork() {
        fn tree(dir: &Path, out: &mut Vec<(PathBuf, Vec<u8>)>) {
            let mut entries: Vec<_> = fs::read_dir(dir).unwrap().flatten().collect();
            entries.sort_by_key(|e| e.path());
            for e in entries {
                if e.path().is_dir() {
                    tree(&e.path(), out);
                } else {
                    out.push((e.path(), fs::read(e.path()).unwrap()));
                }
            }
        }
        let tmp = tempfile::tempdir().unwrap();
        let live = tmp.path().join("live");
        fs::create_dir_all(live.join("projects")).unwrap();
        fs::write(live.join("projects/state"), "data").unwrap();
        fs::write(live.join("icon.png"), "icon").unwrap();
        let fork = fork_in(tmp.path(), "fork", "F", ForkColour::Blue);
        let snapshot = || {
            let mut files = Vec::new();
            tree(&live, &mut files);
            files
        };
        let before = snapshot();
        make(&fork, Path::new("/bin/true")).unwrap();
        assert!(snapshot() == before);
        let mut top: Vec<_> = fs::read_dir(tmp.path())
            .unwrap()
            .flatten()
            .map(|e| e.file_name())
            .collect();
        top.sort();
        assert_eq!(top, ["fork", "live"]);
    }

    #[test]
    fn u6266b_the_app_runs_the_binary_on_the_forks_folder() {
        use std::os::unix::fs::PermissionsExt;
        let tmp = tempfile::tempdir().unwrap();
        let fork = fork_in(tmp.path(), "it's", "F", ForkColour::Blue);
        let binary = tmp.path().join("bin");
        fs::write(
            &binary,
            "#!/bin/sh\necho \"$ROUNDUP_DATA_DIR|$ROUNDUP_DEV_PORT\"\n",
        )
        .unwrap();
        fs::set_permissions(&binary, fs::Permissions::from_mode(0o755)).unwrap();
        let app = make(&fork, &binary).unwrap();
        let out = std::process::Command::new(app.join("Contents/MacOS/roundup"))
            .env_remove("ROUNDUP_DATA_DIR")
            .env("ROUNDUP_DEV_PORT", "5173")
            .output()
            .unwrap();
        assert_eq!(
            String::from_utf8_lossy(&out.stdout).trim(),
            format!("{}|", fork.display())
        );
    }
}
