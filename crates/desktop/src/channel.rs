//! CH7077: the three builds of the App, told apart by the identifier their Tauri config sets.
//! `tauri.conf.json` is Source (`just app`); `tauri.stable.conf.json` and `tauri.dev.conf.json`
//! are the overlays an installed build merges onto it.

use std::path::{Path, PathBuf};

/// Which build this is.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Channel {
    /// Installed, fed from the alpha feed, on the owner's data folder.
    Stable,
    /// Installed, fed from the dev feed, on the Fork named Dev.
    Dev,
    /// Built from a checkout by `just app`, on data of its own.
    #[default]
    Source,
}

/// Stable's identifier, which names the owner's data folder.
pub(crate) const STABLE_IDENTIFIER: &str = "dev.roundup.app";
const DEV_IDENTIFIER: &str = "dev.roundup.app.dev";

/// The name of the Fork Dev runs on.
const DEV_FORK: &str = "Dev";

/// The variables that point a build at a checkout's files; an installed build drops them.
pub(crate) const CHECKOUT_VARS: [&str; 4] = [
    "ROUNDUP_RUPD_BIN",
    "ROUNDUP_RUP_BIN",
    "ROUNDUP_SIDECAR_DIR",
    "ROUNDUP_DEV_PORT",
];

impl Channel {
    /// The build whose Tauri config names `identifier`.
    pub fn of(identifier: &str) -> Self {
        match identifier {
            STABLE_IDENTIFIER => Self::Stable,
            DEV_IDENTIFIER => Self::Dev,
            _ => Self::Source,
        }
    }

    /// Stable and Dev: installed from a signed feed, loading only from their own bundle.
    pub fn installed(self) -> bool {
        self != Self::Source
    }

    /// The herdr-core session its Daemons' Terminals live in; `None` keeps the Daemon's default.
    pub(crate) fn core_session(self) -> Option<&'static str> {
        (self == Self::Dev).then_some("roundup-dev")
    }
}

/// CH7077c: the data folder of the Fork named Dev under `home/forks`, or the text that says how
/// to make it.
pub(crate) fn dev_fork(home: &Path) -> Result<PathBuf, String> {
    let forks = home.join("forks");
    let found = std::fs::read_dir(&forks).ok().and_then(|entries| {
        entries
            .flatten()
            .map(|entry| entry.path())
            .find(|folder| crate::fork_app::read(folder).is_some_and(|fork| fork.name == DEV_FORK))
    });
    found.ok_or_else(|| {
        format!(
            "Dev runs on the Fork named {DEV_FORK}, and {} holds none. In a Terminal of the \
             Stable App run `rup data fork {} --name {DEV_FORK} --colour violet`, then open Dev again.",
            forks.display(),
            forks.join("dev").display()
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The base config with `overlay` merged on, as `tauri build --config` merges it.
    fn merged(overlay: Option<&str>) -> serde_json::Value {
        let read = |name: &str| -> serde_json::Value {
            let path = Path::new(env!("CARGO_MANIFEST_DIR")).join(name);
            serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
        };
        let mut config = read("tauri.conf.json");
        if let Some(overlay) = overlay {
            json_patch::merge(&mut config, &read(overlay));
        }
        config
    }

    #[test]
    fn ch7077a_each_config_is_its_own_channel_with_its_own_feed() {
        let builds = [
            (None, Channel::Source),
            (Some("tauri.stable.conf.json"), Channel::Stable),
            (Some("tauri.dev.conf.json"), Channel::Dev),
        ];
        let mut identities = std::collections::BTreeSet::new();
        let mut feeds = std::collections::BTreeSet::new();
        for (overlay, channel) in builds {
            let config = merged(overlay);
            let identifier = config["identifier"].as_str().unwrap();
            assert_eq!(Channel::of(identifier), channel, "{overlay:?}");
            let scheme = config["plugins"]["deep-link"]["desktop"]["schemes"].clone();
            assert!(identities.insert((identifier.to_owned(), scheme.to_string())));
            let updater = &config["plugins"]["updater"];
            if channel.installed() {
                assert!(
                    updater["pubkey"]
                        .as_str()
                        .is_some_and(|key| !key.is_empty())
                );
                let endpoints = updater["endpoints"].as_array().unwrap();
                assert_eq!(endpoints.len(), 1, "{overlay:?}");
                assert!(feeds.insert(endpoints[0].to_string()), "{overlay:?}");
            } else {
                assert!(updater.is_null(), "Source has no feed");
            }
        }
    }

    fn fork(home: &Path, folder: &str, name: &str) {
        let dir = home.join("forks").join(folder);
        std::fs::create_dir_all(&dir).unwrap();
        let record = serde_json::json!({
            "name": name, "colour": "violet", "source": "/live", "created_ms": 0, "projects": null
        });
        std::fs::write(dir.join("fork.json"), record.to_string()).unwrap();
    }

    #[test]
    fn ch7077c_dev_runs_on_the_fork_named_dev() {
        let home = tempfile::tempdir().unwrap();
        fork(home.path(), "login", "Login");
        fork(home.path(), "dev-2", "Dev");
        assert_eq!(
            dev_fork(home.path()).unwrap(),
            home.path().join("forks/dev-2")
        );
    }

    #[test]
    fn ch7077c_dev_without_the_fork_says_how_to_make_it() {
        let home = tempfile::tempdir().unwrap();
        fork(home.path(), "dev", "Login");
        let told = dev_fork(home.path()).unwrap_err();
        assert!(told.contains("rup data fork"), "{told}");
        assert!(told.contains(&home.path().join("forks/dev").display().to_string()));
    }
}
