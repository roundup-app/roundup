//! AI7152: every App told apart. One table of the Channels' names and colours, and the one
//! comparison that decides whether a Fork's name or colour is already taken.

use std::path::{Path, PathBuf};

use crate::data::{ForkColour, ForkRecord};

/// AI7152a: a Channel's fixed name and colour: Stable, Dev, Source.
pub const STABLE: (&str, ForkColour) = ("Roundup", ForkColour::Orange);
pub const DEV: (&str, ForkColour) = ("Roundup Dev", ForkColour::Violet);
pub const SOURCE: (&str, ForkColour) = ("Roundup Source", ForkColour::Blue);
pub const CHANNELS: [(&str, ForkColour); 3] = [STABLE, DEV, SOURCE];

/// AI7152b: names no Fork may take, besides the Channels' own.
const RESERVED: [&str; 2] = ["Dev", "Source"];

/// AI7152b: the one comparison: equal after trimming and lower-casing.
pub fn same_name(a: &str, b: &str) -> bool {
    a.trim().to_lowercase() == b.trim().to_lowercase()
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
    let channel_name = CHANNELS.iter().any(|(taken, _)| same_name(taken, name));
    let reserved = RESERVED.iter().any(|taken| same_name(taken, name));
    let dev_name = same_name("Dev", name);
    if channel_name || (reserved && !(dev_first && dev_name)) {
        said.push(format!("name {name:?} is reserved by an App"));
    } else if let Some(fork) = forks
        .iter()
        .find(|f| Some(f.path.as_path()) != own && same_name(&f.name, name))
    {
        said.push(format!(
            "name {name:?} is taken by the Fork at {}",
            fork.path.display()
        ));
    }
    let channel = CHANNELS
        .iter()
        .find(|(_, taken)| *taken == colour)
        .filter(|(taken, _)| !(dev_first && *taken == CHANNELS[1].0));
    if let Some((holder, _)) = channel {
        said.push(format!(
            "colour {} is taken by {holder}",
            colour_name(colour)
        ));
    } else if let Some(fork) = forks
        .iter()
        .find(|f| Some(f.path.as_path()) != own && f.colour == colour)
    {
        said.push(format!(
            "colour {} is taken by the Fork at {}",
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
/// is the one marked. The Channels are never marked.
pub fn collides(forks: &[TakenFork], fork: &TakenFork) -> Option<String> {
    if let Some((holder, _)) = CHANNELS
        .iter()
        .find(|(n, c)| same_name(n, &fork.name) || *c == fork.colour)
    {
        return Some((*holder).to_owned());
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
    let dev = path.file_name().is_some_and(|folder| folder == "dev");
    if let Some(said) = refusal(&forks_in(forks), name, colour, Some(path), dev) {
        return Err(said);
    }
    json["name"] = name.into();
    json["colour"] = serde_json::to_value(colour).map_err(|e| e.to_string())?;
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

    #[test]
    fn ai7152a_the_channels_differ_in_name_and_colour() {
        for (i, (a, ca)) in CHANNELS.iter().enumerate() {
            for (b, cb) in &CHANNELS[i + 1..] {
                assert!(!same_name(a, b) && ca != cb);
            }
        }
    }

    #[test]
    fn ai7152b_one_comparison() {
        for taken in ["main", "Main ", "MAIN", "\tmain"] {
            assert!(same_name(taken, "main"));
        }
        for free in ["roundups", "Mainline"] {
            assert!(!same_name(free, "main") && !same_name(free, "roundup"));
        }
        let forks = [fork("main", ForkColour::Teal)];
        for reserved in ["ROUNDUP", " dev ", "source", "roundup dev"] {
            assert!(refusal(&forks, reserved, ForkColour::Pink, None, false).is_some());
        }
        assert!(refusal(&forks, "roundups", ForkColour::Pink, None, false).is_none());
    }

    #[test]
    fn ai7152c_refusal_names_the_holder() {
        let forks = [fork("main", ForkColour::Teal)];
        let both = refusal(&forks, "MAIN", ForkColour::Violet, None, false).unwrap();
        assert!(
            both.contains("is taken by the Fork at /h/forks/main"),
            "{both}"
        );
        assert!(
            both.contains("colour violet is taken by Roundup Dev"),
            "{both}"
        );
        assert!(refusal(&forks, "Dev", ForkColour::Violet, None, true).is_none());
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
        let home = std::env::temp_dir().join(format!("ai7152e-{}", std::process::id()));
        for (folder, name, colour, at) in [
            ("a", "main", "teal", 1),
            ("b", "Main", "pink", 2),
            ("c", "x", "red", 3),
        ] {
            let dir = home.join(folder);
            std::fs::create_dir_all(&dir).unwrap();
            let record = serde_json::json!({"name": name, "colour": colour, "source": "/l", "created_ms": at, "projects": null});
            std::fs::write(dir.join("fork.json"), record.to_string()).unwrap();
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
    }

    #[test]
    fn ai7152e_edit_rewrites_only_fork_json_and_refuses_a_taken_value() {
        let home = std::env::temp_dir().join(format!("ai7152e-{}", std::process::id()));
        let forks = home.join("forks");
        for (folder, name, colour) in [("a", "main", "red"), ("b", "main2", "teal")] {
            std::fs::create_dir_all(forks.join(folder)).unwrap();
            std::fs::write(
                forks.join(folder).join("fork.json"),
                format!(r#"{{"name":"{name}","colour":"{colour}","source":"s","created_ms":1,"extra":7}}"#),
            )
            .unwrap();
        }
        let a = forks.join("a");
        assert!(
            edit(&forks, &a, Some("MAIN2"), None)
                .unwrap_err()
                .contains("is taken by the Fork")
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
