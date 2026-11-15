//! AI7152: every App told apart. One table of the Channels' names and colours, and the one
//! comparison that decides whether a Fork's name or colour is already held.

use std::path::{Path, PathBuf};

use crate::data::{ForkColour, ForkRecord};

/// AI7152a: a Channel's fixed name and colour: Stable, Dev, Source.
pub const CHANNELS: [(&str, ForkColour); 3] = [
    ("Roundup", ForkColour::Orange),
    ("Roundup Dev", ForkColour::Violet),
    ("Roundup Source", ForkColour::Blue),
];

/// AI7152b: names no Fork may take, besides the Channels' own.
const RESERVED: [&str; 2] = ["Dev", "Source"];

/// AI7152b: the one comparison: equal after trimming and lower-casing.
pub fn same_name(a: &str, b: &str) -> bool {
    a.trim().to_lowercase() == b.trim().to_lowercase()
}

/// One Fork under `<home>/forks` that holds a name and colour.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HeldFork {
    pub path: PathBuf,
    pub name: String,
    pub colour: ForkColour,
    pub created_ms: u64,
}

/// Every Fork under `forks` with a readable `fork.json`, by folder name.
pub fn forks_in(forks: &Path) -> Vec<HeldFork> {
    let mut found: Vec<HeldFork> = std::fs::read_dir(forks)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            let text = std::fs::read_to_string(path.join("fork.json")).ok()?;
            let record: ForkRecord = serde_json::from_str(&text).ok()?;
            Some(HeldFork {
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
    forks: &[HeldFork],
    name: &str,
    colour: ForkColour,
    own: Option<&Path>,
    dev_first: bool,
) -> Option<String> {
    let mut said = Vec::new();
    let channel_name = CHANNELS.iter().any(|(held, _)| same_name(held, name));
    let reserved = RESERVED.iter().any(|held| same_name(held, name));
    let dev_name = same_name("Dev", name);
    if channel_name || (reserved && !(dev_first && dev_name)) {
        said.push(format!("name {name:?} is reserved by an App"));
    } else if let Some(fork) = forks
        .iter()
        .find(|f| Some(f.path.as_path()) != own && same_name(&f.name, name))
    {
        said.push(format!(
            "name {name:?} is held by the Fork at {}",
            fork.path.display()
        ));
    }
    let channel = CHANNELS
        .iter()
        .find(|(_, held)| *held == colour)
        .filter(|(held, _)| !(dev_first && *held == CHANNELS[1].0));
    if let Some((holder, _)) = channel {
        said.push(format!(
            "colour {} is held by {holder}",
            colour_name(colour)
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
/// is the one marked. The Channels are never marked.
pub fn collides(forks: &[HeldFork], fork: &HeldFork) -> Option<String> {
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

#[cfg(test)]
mod tests {
    use super::*;

    fn fork(name: &str, colour: ForkColour) -> HeldFork {
        HeldFork {
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
        for held in ["main", "Main ", "MAIN", "\tmain"] {
            assert!(same_name(held, "main"));
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
            both.contains("is held by the Fork at /h/forks/main"),
            "{both}"
        );
        assert!(
            both.contains("colour violet is held by Roundup Dev"),
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
}
