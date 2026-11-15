//! AI7152: every App told apart. One table of the Channels' names and colours, and the one
//! comparison that decides whether a Fork's name or colour is already held.

use std::path::{Path, PathBuf};

use crate::data::{ForkColour, ForkRecord};

/// AI7152a: a Channel's fixed identity: the App's name, the colour of its plate and the other
/// names no Fork may take. `channel` is what a refusal names as the holder.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ChannelIdentity {
    pub channel: &'static str,
    pub app: &'static str,
    pub reserved: &'static [&'static str],
    pub colour: ForkColour,
}

/// CH7077c: the name of the Fork Dev runs on, which only Dev's own first make may take.
pub const DEV_FORK: &str = "Dev";

pub const STABLE: ChannelIdentity = ChannelIdentity {
    channel: "Stable",
    app: "Roundup",
    reserved: &[],
    colour: ForkColour::Orange,
};
pub const DEV: ChannelIdentity = ChannelIdentity {
    channel: "Dev",
    app: "Roundup Dev",
    reserved: &[DEV_FORK],
    colour: ForkColour::Violet,
};
pub const SOURCE: ChannelIdentity = ChannelIdentity {
    channel: "Source",
    app: "Roundup Source",
    reserved: &["Source"],
    colour: ForkColour::Blue,
};
pub const CHANNELS: [ChannelIdentity; 3] = [STABLE, DEV, SOURCE];

/// AI7152b: the one comparison: equal after trimming and lower-casing.
pub fn same_name(a: &str, b: &str) -> bool {
    a.trim().to_lowercase() == b.trim().to_lowercase()
}

/// AI7152c: Dev's own Fork lives in the folder `dev`.
pub fn is_dev_fork_path(folder: &Path) -> bool {
    folder.file_name().is_some_and(|name| name == "dev")
}

/// One Fork under `<home>/forks` that holds a name and colour.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TakenFork {
    pub path: PathBuf,
    pub name: String,
    pub colour: ForkColour,
    pub created_ms: u64,
}

/// Every Fork under `forks` with a readable `fork.json`, by folder name.
pub fn forks_in(forks: &Path) -> Vec<TakenFork> {
    let mut found: Vec<TakenFork> = std::fs::read_dir(forks)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            let text = std::fs::read_to_string(path.join("fork.json")).ok()?;
            let record: ForkRecord = serde_json::from_str(&text).ok()?;
            Some(TakenFork {
                path,
                name: record.name,
                colour: record.colour,
                created_ms: record.created_ms,
            })
        })
        .collect();
    found.sort_by(|a, b| a.path.cmp(&b.path));
    found
}

/// The Channel that holds `name`: its App name or a name it reserves. `dev_first` frees the one
/// name Dev's own Fork takes.
fn channel_named(name: &str, dev_first: bool) -> Option<&'static ChannelIdentity> {
    CHANNELS.iter().find(|channel| {
        std::iter::once(&channel.app)
            .chain(channel.reserved)
            .any(|held| same_name(held, name) && !(dev_first && *held == DEV_FORK))
    })
}

/// The Channel whose plate is `colour`; `dev_first` frees Dev's.
fn channel_coloured(colour: ForkColour, dev_first: bool) -> Option<&'static ChannelIdentity> {
    CHANNELS
        .iter()
        .find(|channel| channel.colour == colour && !(dev_first && *channel == &DEV))
}

/// AI7152c: who holds `name` or `colour` among the Channels, the reserved names and the Forks in
/// `forks`, as the refusal text; `None` when both are free. `own` is a Fork folder excused from
/// the check (its own current values); `dev_first` excuses the `Dev` name and `violet` colour,
/// which only Dev's own first make may take.
pub fn refusal(
    forks: &[TakenFork],
    name: &str,
    colour: ForkColour,
    own: Option<&Path>,
    dev_first: bool,
) -> Option<String> {
    let mut said = Vec::new();
    if let Some(channel) = channel_named(name, dev_first) {
        said.push(format!("name {name:?} is held by {}", channel.channel));
    } else if let Some(fork) = forks
        .iter()
        .find(|f| Some(f.path.as_path()) != own && same_name(&f.name, name))
    {
        said.push(format!(
            "name {name:?} is held by the Fork at {}",
            fork.path.display()
        ));
    }
    if let Some(channel) = channel_coloured(colour, dev_first) {
        said.push(format!(
            "colour {} is held by {}",
            colour_name(colour),
            channel.channel
        ));
    } else if let Some(fork) = forks
        .iter()
        .find(|f| Some(f.path.as_path()) != own && f.colour == colour)
    {
        said.push(format!(
            "colour {} is held by the Fork at {}",
            colour_name(colour),
            fork.path.display()
        ));
    }
    (!said.is_empty()).then(|| said.join("; "))
}

fn colour_name(colour: ForkColour) -> String {
    serde_json::to_value(colour)
        .ok()
        .and_then(|v| v.as_str().map(str::to_owned))
        .unwrap_or_default()
}

/// AI7152e: the other App a Fork collides with, or `None`; of two Forks, the later `created_ms`
/// is the one marked. The Channels are never marked, and Dev's own Fork keeps `Dev` and `violet`.
pub fn collides(forks: &[TakenFork], fork: &TakenFork) -> Option<String> {
    let dev = is_dev_fork_path(&fork.path);
    if let Some(channel) =
        channel_named(&fork.name, dev).or_else(|| channel_coloured(fork.colour, dev))
    {
        return Some(channel.app.to_owned());
    }
    forks
        .iter()
        .filter(|o| {
            o.path != fork.path && (same_name(&o.name, &fork.name) || o.colour == fork.colour)
        })
        .find(|o| (o.created_ms, &o.path) < (fork.created_ms, &fork.path))
        .map(|o| o.name.clone())
}

/// AI7152e: one row of `fork_list`.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct ForkListed {
    pub path: String,
    pub name: String,
    pub colour: ForkColour,
    pub collides: Option<String>,
}

/// AI7152e: every Fork in `forks` with the App it collides with.
pub fn listed(forks: &Path) -> Vec<ForkListed> {
    let taken = forks_in(forks);
    taken
        .iter()
        .map(|fork| ForkListed {
            path: fork.path.to_string_lossy().into_owned(),
            name: fork.name.clone(),
            colour: fork.colour,
            collides: collides(&taken, fork),
        })
        .collect()
}

/// AI7152e: rewrite only `name` and `colour` in the `fork.json` of the Fork at `path`, a folder
/// directly under `forks`. A value AI7152b holds is refused with AI7152c's message, the Fork's
/// own current values excepted (Dev's folder keeps `Dev` and `violet`). Returns the name before
/// the edit.
pub fn edit(
    forks: &Path,
    path: &Path,
    name: Option<&str>,
    colour: Option<ForkColour>,
) -> Result<String, String> {
    if path.parent() != Some(forks) {
        return Err(format!(
            "{} is not a Fork under {}",
            path.display(),
            forks.display()
        ));
    }
    let file = path.join("fork.json");
    let text = std::fs::read_to_string(&file).map_err(|e| format!("{}: {e}", file.display()))?;
    let mut json: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let record: ForkRecord = serde_json::from_value(json.clone()).map_err(|e| e.to_string())?;
    let name = name.map_or(record.name.as_str(), str::trim);
    let colour = colour.unwrap_or(record.colour);
    if let Some(said) = refusal(
        &forks_in(forks),
        name,
        colour,
        Some(path),
        is_dev_fork_path(path),
    ) {
        return Err(said);
    }
    let object = json.as_object_mut().ok_or("fork.json is not an object")?;
    object.insert("name".into(), name.into());
    object.insert(
        "colour".into(),
        serde_json::to_value(colour).map_err(|e| e.to_string())?,
    );
    let out = serde_json::to_string_pretty(&json).map_err(|e| e.to_string())?;
    std::fs::write(&file, out).map_err(|e| format!("{}: {e}", file.display()))?;
    Ok(record.name)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fork(name: &str, colour: ForkColour) -> TakenFork {
        TakenFork {
            path: format!("/h/forks/{name}").into(),
            name: name.into(),
            colour,
            created_ms: 1,
        }
    }

    /// A folder under the system temporary folder, empty and named for the test.
    fn scratch(test: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("{test}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write_fork(dir: &Path, folder: &str, text: &str) {
        std::fs::create_dir_all(dir.join(folder)).unwrap();
        std::fs::write(dir.join(folder).join("fork.json"), text).unwrap();
    }

    #[test]
    fn ai7152a_the_channels_differ_in_name_and_colour() {
        for (i, a) in CHANNELS.iter().enumerate() {
            for b in &CHANNELS[i + 1..] {
                assert!(!same_name(a.app, b.app) && a.colour != b.colour);
            }
        }
    }

    #[test]
    fn ai7152b_one_comparison() {
        for held in ["main", "Main ", "MAIN", "\tmain"] {
            assert!(same_name(held, "main"));
        }
        for free in ["roundups", "Mainline"] {
            assert!(!same_name(free, "main") && !same_name(free, "roundup"));
        }
        let forks = [fork("main", ForkColour::Teal)];
        for reserved in [
            "ROUNDUP",
            " dev ",
            "source",
            "roundup dev",
            "Roundup Source",
        ] {
            assert!(refusal(&forks, reserved, ForkColour::Pink, None, false).is_some());
        }
        for free in ["roundups", "Mainline"] {
            assert!(refusal(&forks, free, ForkColour::Pink, None, false).is_none());
        }
        // A tab-padded name collides with the Fork named `main`.
        assert!(refusal(&forks, "\tmain\t", ForkColour::Pink, None, false).is_some());
    }

    #[test]
    fn ai7152b_an_unreadable_fork_json_holds_nothing() {
        let home = scratch("ai7152b-unreadable");
        write_fork(&home, "broken", "{ not json");
        write_fork(&home, "partial", r#"{"name":"main"}"#);
        std::fs::create_dir_all(home.join("empty")).unwrap();
        write_fork(
            &home,
            "good",
            r#"{"name":"fine","colour":"red","source":"s","created_ms":1}"#,
        );
        let held = forks_in(&home);
        std::fs::remove_dir_all(&home).unwrap();
        assert_eq!(held.len(), 1);
        assert_eq!(held[0].name, "fine");
        assert!(refusal(&held, "main", ForkColour::Teal, None, false).is_none());
    }

    #[test]
    fn ai7152c_refusal_names_the_holder() {
        let forks = [fork("main", ForkColour::Teal)];
        let both = refusal(&forks, "MAIN", ForkColour::Violet, None, false).unwrap();
        assert!(
            both.contains("name \"MAIN\" is held by the Fork at /h/forks/main"),
            "{both}"
        );
        assert!(both.contains("colour violet is held by Dev"), "{both}");
        let reserved = refusal(&forks, " roundup ", ForkColour::Orange, None, false).unwrap();
        assert_eq!(
            reserved,
            "name \" roundup \" is held by Stable; colour orange is held by Stable"
        );
        let fork_colour = refusal(&forks, "x", ForkColour::Teal, None, false).unwrap();
        assert_eq!(
            fork_colour,
            "colour teal is held by the Fork at /h/forks/main"
        );
        assert!(refusal(&forks, "Dev", ForkColour::Violet, None, true).is_none());
        assert!(refusal(&forks, "Roundup Dev", ForkColour::Pink, None, true).is_some());
        assert!(
            refusal(
                &forks,
                "main",
                ForkColour::Teal,
                Some(&forks[0].path),
                false
            )
            .is_none()
        );
    }

    #[test]
    fn ai7152e_fork_list_reads_folders_and_marks_the_later() {
        let home = scratch("ai7152e-list");
        for (folder, name, colour, at) in [
            ("a", "main", "teal", 1),
            ("b", "Main", "pink", 2),
            ("c", "x", "red", 3),
        ] {
            let record = serde_json::json!({"name": name, "colour": colour, "source": "/l", "created_ms": at, "projects": null});
            write_fork(&home, folder, &record.to_string());
        }
        std::fs::create_dir_all(home.join("d")).unwrap();
        let rows = listed(&home);
        std::fs::remove_dir_all(&home).unwrap();
        let marks: Vec<_> = rows
            .iter()
            .map(|r| (r.name.as_str(), r.collides.as_deref()))
            .collect();
        assert_eq!(marks, [("main", None), ("Main", Some("main")), ("x", None)]);
    }

    #[test]
    fn ai7152e_the_later_fork_is_marked() {
        let older = fork("a", ForkColour::Teal);
        let mut later = fork("A ", ForkColour::Pink);
        later.created_ms = 2;
        let all = [older.clone(), later.clone()];
        assert_eq!(collides(&all, &older), None);
        assert_eq!(collides(&all, &later).as_deref(), Some("a"));
        assert_eq!(
            collides(&all, &fork("x", ForkColour::Orange)).as_deref(),
            Some("Roundup")
        );
        // Dev's own Fork keeps `Dev` and `violet`: it is not marked.
        let mut dev = fork("Dev", ForkColour::Violet);
        dev.path = "/h/forks/dev".into();
        assert_eq!(collides(std::slice::from_ref(&dev), &dev), None);
    }

    #[test]
    fn ai7152e_edit_rewrites_only_fork_json_and_refuses_a_held_value() {
        let home = scratch("ai7152e-edit");
        let forks = home.join("forks");
        for (folder, name, colour) in [("a", "main", "red"), ("b", "main2", "teal")] {
            write_fork(
                &forks,
                folder,
                &format!(
                    r#"{{"name":"{name}","colour":"{colour}","source":"s","created_ms":1,"extra":7}}"#
                ),
            );
        }
        let a = forks.join("a");
        assert!(
            edit(&forks, &a, Some("MAIN2"), None)
                .unwrap_err()
                .contains("is held by the Fork")
        );
        assert!(
            edit(&forks, &a, None, Some(ForkColour::Teal))
                .unwrap_err()
                .contains("colour teal")
        );
        assert!(edit(&forks, &a, Some(" Roundup "), None).is_err());
        assert_eq!(
            edit(&forks, &a, Some(" fresh "), Some(ForkColour::Pink)).unwrap(),
            "main"
        );
        let json: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(a.join("fork.json")).unwrap()).unwrap();
        assert_eq!(
            (
                json["name"].as_str(),
                json["colour"].as_str(),
                json["extra"].as_i64()
            ),
            (Some("fresh"), Some("pink"), Some(7))
        );
        assert!(edit(&forks, &home, Some("x"), None).is_err());
        std::fs::remove_dir_all(&home).unwrap();
    }
}
