//! MC40, MC41, MC44, MC45: the owner's `look.json` and `keys.json`, read by the Daemon and applied
//! live, and the `AGENTS.md` written for the owner's own agent. A refused file raises one
//! `config.problem` and leaves the last good state as it was.

use parking_lot::Mutex;
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use contracts::config::{ConfigProblem, ConfigState};
use contracts::{Actor, EventData};
use serde_json::Value;
use tokio::sync::mpsc;

use crate::Daemon;

/// MC44: what the owner's agent reads; written once, then the owner's.
const AGENTS_MD: &str = include_str!("config_agents.md");

/// How long saves are gathered into one read.
const SETTLE: Duration = Duration::from_millis(150);
/// The Terminal font sizes the design system allows (`--text-terminal-min` and `-max`).
const FONT_SIZE: std::ops::RangeInclusive<f64> = 9.0..=21.0;
/// The colour Tokens a look may name: neutrals and the accent, never a Kind's tone.
const COLOURS: [&str; 8] = [
    "accent", "ground", "sunken", "text", "grey", "hover", "selected", "hairline",
];

pub(crate) struct Config {
    dir: PathBuf,
    state: Mutex<Read>,
}

#[derive(Default)]
struct Read {
    good: ConfigState,
    /// The text each file had at its last read, so an unrelated save raises nothing twice.
    seen: [Option<Option<String>>; 2],
}

impl Config {
    pub(crate) fn new(dir: PathBuf) -> Self {
        Self {
            dir,
            state: Mutex::default(),
        }
    }

    pub(crate) fn state(&self) -> ConfigState {
        self.state.lock().good.clone()
    }

    /// MC44: writes `AGENTS.md` when the Config has none, never over the owner's.
    fn write_agents_md(&self) {
        use std::io::Write;
        if self.dir.as_os_str().is_empty() || std::fs::create_dir_all(&self.dir).is_err() {
            return;
        }
        let file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(self.dir.join("AGENTS.md"));
        if let Ok(mut file) = file {
            let _ = file.write_all(AGENTS_MD.as_bytes());
        }
    }

    /// Reads both files once, then again on each save, until the Daemon ends.
    pub(crate) fn start(&self, daemon: &Arc<Daemon>) {
        let daemon = Arc::clone(daemon);
        daemon.config.write_agents_md();
        tokio::spawn(async move {
            let (changes, mut changed) = mpsc::unbounded_channel();
            let _watcher = daemon.config.watch(changes);
            daemon.config.reload(&daemon);
            while changed.recv().await.is_some() {
                while let Ok(Some(())) = tokio::time::timeout(SETTLE, changed.recv()).await {}
                daemon.config.reload(&daemon);
            }
        });
    }

    fn watch(&self, changes: mpsc::UnboundedSender<()>) -> Option<notify::RecommendedWatcher> {
        use notify::Watcher;
        let mut watcher =
            notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
                if event.is_ok() {
                    let _ = changes.send(());
                }
            })
            .ok()?;
        watcher
            .watch(&self.dir, notify::RecursiveMode::NonRecursive)
            .ok()?;
        Some(watcher)
    }

    fn reload(&self, daemon: &Daemon) {
        let mut state = self.state.lock();
        let mut next = state.good.clone();
        let mut changed = false;
        for (slot, file) in ["look.json", "keys.json"].into_iter().enumerate() {
            let text = std::fs::read_to_string(self.dir.join(file)).ok();
            let Some(seen) = state.seen.get_mut(slot) else {
                continue;
            };
            if seen.as_ref() == Some(&text) {
                continue;
            }
            *seen = Some(text.clone());
            // A deleted file returns the defaults.
            let parsed = match &text {
                None => Ok(BTreeMap::new()),
                Some(text) if slot == 0 => parse_look(text),
                Some(text) => parse_keys(text),
            };
            match parsed {
                Ok(map) => {
                    let part = if slot == 0 {
                        &mut next.look
                    } else {
                        &mut next.keys
                    };
                    changed |= *part != map;
                    *part = map;
                }
                Err(cause) => daemon.bus.emit(
                    Actor::daemon(),
                    EventData::ConfigProblem(ConfigProblem {
                        file: file.into(),
                        cause,
                    }),
                ),
            }
        }
        if changed {
            state.good = next;
            daemon.bus.emit(Actor::daemon(), EventData::ConfigChanged);
        }
    }
}

/// MC45, MC46: a key of an attention rule, a second surface or an interruption refuses the file
/// before any other key is read.
fn object(text: &str) -> Result<serde_json::Map<String, Value>, String> {
    let value = serde_json::from_str(text);
    if let Some(cause) = value.as_ref().ok().and_then(crate::attention::refused_key) {
        return Err(cause);
    }
    match value {
        Ok(Value::Object(map)) => Ok(map),
        Ok(_) => Err("the file must hold one JSON object".into()),
        Err(error) => Err(format!("not valid JSON: {error}")),
    }
}

fn hex_colour(value: &str) -> bool {
    value.strip_prefix('#').is_some_and(|digits| {
        matches!(digits.len(), 3 | 4 | 6 | 8) && digits.chars().all(|c| c.is_ascii_hexdigit())
    })
}

/// MC40: `look.json` names Tokens; a key that is no Token or a value outside its type refuses it whole.
pub(crate) fn parse_look(text: &str) -> Result<BTreeMap<String, String>, String> {
    let mut look = BTreeMap::new();
    for (key, value) in object(text)? {
        let bad = || format!("{key}: not a value this Token takes");
        let text = value.as_str();
        match key.as_str() {
            "mode" if matches!(text, Some("dark" | "light" | "system")) => {}
            "interfaceScale" if matches!(text, Some("small" | "default" | "large")) => {}
            "fontFamily"
                if text.is_some_and(|t| !t.trim().is_empty() && !t.contains([';', '{', '}'])) => {}
            "fontSize" if value.as_f64().is_some_and(|n| FONT_SIZE.contains(&n)) => {
                look.insert(key, value.to_string());
                continue;
            }
            "colors" => {
                let Value::Object(colours) = &value else {
                    return Err(bad());
                };
                for (token, colour) in colours {
                    if !COLOURS.contains(&token.as_str()) {
                        return Err(format!("colors.{token}: no such colour Token"));
                    }
                    let Some(colour) = colour.as_str().filter(|c| hex_colour(c)) else {
                        return Err(format!("colors.{token}: not a hex colour"));
                    };
                    look.insert(format!("color.{token}"), colour.into());
                }
                continue;
            }
            "mode" | "interfaceScale" | "fontFamily" | "fontSize" => return Err(bad()),
            _ => return Err(format!("{key}: no such Token")),
        }
        look.insert(key, text.unwrap_or_default().into());
    }
    Ok(look)
}

/// MC41: whether `press` reads as `[ctrl+][alt+][meta+][shift+]<Code>` with `ctrl` or `meta` in it.
fn press_parses(press: &str) -> bool {
    let mut parts: Vec<&str> = press.split('+').collect();
    let Some(code) = parts.pop() else {
        return false;
    };
    let mut order = ["ctrl", "alt", "meta", "shift"].into_iter();
    let ordered = parts.iter().all(|m| order.any(|o| o == *m));
    let mut chars = code.chars();
    ordered
        && parts.iter().any(|m| matches!(*m, "ctrl" | "meta"))
        && chars.next().is_some_and(|c| c.is_ascii_alphabetic())
        && chars.all(|c| c.is_ascii_alphanumeric())
}

/// MC41: `keys.json` is `{ "<action name>": "<press>" }`; the App checks the names and the
/// Terminal's own chords, which only it knows.
pub(crate) fn parse_keys(text: &str) -> Result<BTreeMap<String, String>, String> {
    let mut keys = BTreeMap::new();
    for (name, value) in object(text)? {
        match value.as_str().filter(|press| press_parses(press)) {
            Some(press) => keys.insert(name, press.into()),
            None => return Err(format!("{name}: not a press")),
        };
    }
    Ok(keys)
}

#[cfg(test)]
#[path = "config_tests.rs"]
mod tests;
