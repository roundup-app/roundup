//! SK1–SK6: install, report and remove roundup's skill and hook in the user's Claude Code config
//! folder, touching nothing else. Every vendor string (folders, file, event and field names) stays
//! here (P4); callers see `Install`, `Plan` and `ItemState`. A `Plan` is made first and applying it
//! runs that same plan, so a dry run and the real run cannot differ.

use std::ffi::OsString;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use serde_json::{Map, Value, json};
use tempfile::NamedTempFile;

/// The version of the skill text this build writes (`roundup-skill: <n>`).
pub const SKILL_VERSION: u32 = 1;

const MARK: &str = "roundup-skill";

/// Event, matcher and arguments after `skill report` (SK7's table).
const HOOKS: [(&str, Option<&str>, &str); 6] = [
    ("SessionStart", None, "--state idle --where"),
    ("UserPromptSubmit", None, "--state working"),
    (
        "PermissionRequest",
        None,
        "--state blocked --kind permission",
    ),
    (
        "PreToolUse",
        Some("AskUserQuestion"),
        "--state blocked --kind question",
    ),
    ("Stop", None, "--state done"),
    ("SessionEnd", None, "--state clear"),
];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Item {
    Skill,
    Hook,
}

impl Item {
    pub fn as_str(self) -> &'static str {
        match self {
            Item::Skill => "skill",
            Item::Hook => "hook",
        }
    }
}

/// SK4: what is installed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ItemState {
    Current,
    Outdated,
    Missing,
    Foreign,
    Unreadable,
    Unsupported,
}

impl ItemState {
    pub fn as_str(self) -> &'static str {
        match self {
            ItemState::Current => "current",
            ItemState::Outdated => "outdated",
            ItemState::Missing => "missing",
            ItemState::Foreign => "foreign",
            ItemState::Unreadable => "unreadable",
            ItemState::Unsupported => "unsupported",
        }
    }
}

/// SK6: what a setup or remove does to an item.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Outcome {
    Installed,
    Updated,
    Unchanged,
    Removed,
    Missing,
    Foreign,
    Unreadable,
    Unsupported,
}

impl Outcome {
    pub fn as_str(self) -> &'static str {
        match self {
            Outcome::Installed => "installed",
            Outcome::Updated => "updated",
            Outcome::Unchanged => "unchanged",
            Outcome::Removed => "removed",
            Outcome::Missing => "missing",
            Outcome::Foreign => "foreign",
            Outcome::Unreadable => "unreadable",
            Outcome::Unsupported => "unsupported",
        }
    }

    /// Setup and remove fail on these (SK9).
    pub fn refused(self) -> bool {
        matches!(
            self,
            Outcome::Foreign | Outcome::Unreadable | Outcome::Unsupported
        )
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Reported {
    pub item: Item,
    pub state: ItemState,
    pub path: PathBuf,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Planned {
    pub item: Item,
    pub outcome: Outcome,
    pub path: PathBuf,
}

/// A write that failed: the path and the system's reason.
#[derive(Debug)]
pub struct WriteError {
    pub path: PathBuf,
    pub source: io::Error,
}

impl std::fmt::Display for WriteError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.path.display(), self.source)
    }
}

impl std::error::Error for WriteError {}

enum Action {
    Write(PathBuf, Vec<u8>),
    RemoveSkill(PathBuf),
}

pub struct Plan {
    pub entries: Vec<Planned>,
    actions: Vec<Action>,
}

impl Plan {
    /// Run the plan; the outcomes are the planned ones. A failed write stops the run and leaves
    /// that file as it was.
    pub fn apply(&self) -> Result<Vec<Planned>, WriteError> {
        for action in &self.actions {
            match action {
                Action::Write(path, bytes) => {
                    write_atomic(path, bytes).map_err(|source| WriteError {
                        path: path.clone(),
                        source,
                    })?
                }
                Action::RemoveSkill(file) => remove_skill(file).map_err(|source| WriteError {
                    path: file.clone(),
                    source,
                })?,
            }
        }
        Ok(self.entries.clone())
    }
}

#[derive(Clone)]
pub struct Install {
    config: PathBuf,
    rup: PathBuf,
    claude_found: bool,
    force: bool,
}

impl Install {
    /// The config folder is `CLAUDE_CONFIG_DIR` when set and non-empty, else `HOME/.claude`.
    /// `rup` is the absolute path the hook commands start with.
    pub fn from_vars(var: impl Fn(&str) -> Option<OsString>, rup: &Path) -> Result<Self, String> {
        let var = |name: &str| var(name).filter(|value| !value.is_empty());
        let config = match (var("CLAUDE_CONFIG_DIR"), var("HOME")) {
            (Some(dir), _) => PathBuf::from(dir),
            (None, Some(home)) => PathBuf::from(home).join(".claude"),
            (None, None) => return Err("neither CLAUDE_CONFIG_DIR nor HOME is set".into()),
        };
        let claude_found = var("PATH").is_some_and(|path| {
            std::env::split_paths(&path).any(|dir| dir.join(super::programs()[0]).is_file())
        });
        Ok(Self {
            config,
            rup: rup.to_owned(),
            claude_found,
            force: false,
        })
    }

    /// SK3: replace a foreign skill.
    #[must_use]
    pub fn force(mut self, force: bool) -> Self {
        self.force = force;
        self
    }

    fn skill_file(&self) -> PathBuf {
        self.config.join("skills/roundup/SKILL.md")
    }

    fn settings_file(&self) -> PathBuf {
        self.config.join("settings.json")
    }

    fn supported(&self) -> bool {
        self.config.exists() || self.claude_found
    }

    fn command(&self, args: &str) -> String {
        let rup = self.rup.to_string_lossy();
        let rup = shlex::try_quote(&rup).map_or_else(|_| rup.to_string(), |q| q.into_owned());
        format!("{rup} skill report {args}")
    }

    fn group(&self, matcher: Option<&str>, args: &str) -> Value {
        let mut group = Map::new();
        if let Some(matcher) = matcher {
            group.insert("matcher".into(), json!(matcher));
        }
        group.insert(
            "hooks".into(),
            json!([{ "type": "command", "command": self.command(args) }]),
        );
        Value::Object(group)
    }

    /// SK4: report each item. Reads only the config folder.
    pub fn status(&self) -> Vec<Reported> {
        let (skill, hook) = (self.skill_state(), self.hook_state().0);
        vec![
            Reported {
                item: Item::Skill,
                state: skill,
                path: self.skill_file(),
            },
            Reported {
                item: Item::Hook,
                state: hook,
                path: self.settings_file(),
            },
        ]
    }

    fn skill_state(&self) -> ItemState {
        if !self.supported() {
            return ItemState::Unsupported;
        }
        let file = self.skill_file();
        match std::fs::read(&file) {
            Ok(bytes) => {
                let text = String::from_utf8_lossy(&bytes);
                if skill_version(&text).is_none() {
                    ItemState::Foreign
                } else if text == skill_text() {
                    ItemState::Current
                } else {
                    ItemState::Outdated
                }
            }
            Err(e) if e.kind() == io::ErrorKind::NotFound => {
                let dir = file.parent().expect("skill file has a folder");
                let occupied = match std::fs::read_dir(dir) {
                    Ok(mut entries) => entries.next().is_some(),
                    Err(_) => dir.exists(),
                };
                if occupied {
                    ItemState::Foreign
                } else {
                    ItemState::Missing
                }
            }
            Err(_) => ItemState::Unreadable,
        }
    }

    fn hook_state(&self) -> (ItemState, Option<Map<String, Value>>) {
        if !self.supported() {
            return (ItemState::Unsupported, None);
        }
        let doc = match read_settings(&self.settings_file()) {
            Ok(doc) => doc,
            Err(()) => return (ItemState::Unreadable, None),
        };
        let Some(doc) = doc else {
            return (ItemState::Missing, None);
        };
        let Ok(lists) = event_lists(&doc) else {
            return (ItemState::Unreadable, None);
        };
        let mut current = 0;
        let mut marked = 0;
        for (event, matcher, args) in HOOKS {
            let list = lists
                .get(event)
                .and_then(Value::as_array)
                .map_or(&[][..], Vec::as_slice);
            let groups: Vec<&Value> = list.iter().filter(|g| group_marked(g)).collect();
            if !groups.is_empty() {
                marked += 1;
            }
            if groups.len() == 1 && *groups[0] == self.group(matcher, args) {
                current += 1;
            }
        }
        let state = if current == HOOKS.len() {
            ItemState::Current
        } else if marked > 0 || any_marked_elsewhere(&doc) {
            ItemState::Outdated
        } else {
            ItemState::Missing
        };
        (state, Some(doc))
    }

    /// SK1, SK2, SK3: what setup would do.
    pub fn plan_setup(&self) -> Plan {
        let skill = self.skill_state();
        let (hook, doc) = self.hook_state();
        let refused = skill == ItemState::Foreign && !self.force;
        let mut actions = Vec::new();

        let skill_outcome = match skill {
            _ if refused => Outcome::Foreign,
            ItemState::Current => Outcome::Unchanged,
            ItemState::Missing => Outcome::Installed,
            ItemState::Outdated | ItemState::Foreign => Outcome::Updated,
            ItemState::Unreadable => Outcome::Unreadable,
            ItemState::Unsupported => Outcome::Unsupported,
        };
        if matches!(skill_outcome, Outcome::Installed | Outcome::Updated) {
            actions.push(Action::Write(self.skill_file(), skill_text().into_bytes()));
        }

        let hook_outcome = match hook {
            _ if refused => Outcome::Foreign,
            ItemState::Current => Outcome::Unchanged,
            ItemState::Missing => Outcome::Installed,
            ItemState::Outdated => Outcome::Updated,
            ItemState::Foreign => Outcome::Foreign,
            ItemState::Unreadable => Outcome::Unreadable,
            ItemState::Unsupported => Outcome::Unsupported,
        };
        if matches!(hook_outcome, Outcome::Installed | Outcome::Updated) {
            let mut doc = doc.unwrap_or_default();
            self.add_hooks(&mut doc);
            actions.push(Action::Write(self.settings_file(), render(&doc)));
        }

        Plan {
            entries: vec![
                Planned {
                    item: Item::Skill,
                    outcome: skill_outcome,
                    path: self.skill_file(),
                },
                Planned {
                    item: Item::Hook,
                    outcome: hook_outcome,
                    path: self.settings_file(),
                },
            ],
            actions,
        }
    }

    /// SK5: what remove would do.
    pub fn plan_remove(&self) -> Plan {
        let skill = self.skill_state();
        let (hook, doc) = self.hook_state();
        let mut actions = Vec::new();
        let outcome = |state: ItemState| match state {
            ItemState::Current | ItemState::Outdated => Outcome::Removed,
            ItemState::Missing => Outcome::Missing,
            ItemState::Foreign => Outcome::Foreign,
            ItemState::Unreadable => Outcome::Unreadable,
            ItemState::Unsupported => Outcome::Unsupported,
        };
        let (skill_outcome, hook_outcome) = (outcome(skill), outcome(hook));
        if skill_outcome == Outcome::Removed {
            actions.push(Action::RemoveSkill(self.skill_file()));
        }
        if hook_outcome == Outcome::Removed {
            let mut doc = doc.unwrap_or_default();
            remove_hooks(&mut doc);
            actions.push(Action::Write(self.settings_file(), render(&doc)));
        }
        Plan {
            entries: vec![
                Planned {
                    item: Item::Skill,
                    outcome: skill_outcome,
                    path: self.skill_file(),
                },
                Planned {
                    item: Item::Hook,
                    outcome: hook_outcome,
                    path: self.settings_file(),
                },
            ],
            actions,
        }
    }

    fn add_hooks(&self, doc: &mut Map<String, Value>) {
        let hooks = doc.entry("hooks").or_insert_with(|| json!({}));
        let hooks = hooks.as_object_mut().expect("checked by hook_state");
        for (event, matcher, args) in HOOKS {
            let list = hooks.entry(event).or_insert_with(|| json!([]));
            let list = list.as_array_mut().expect("checked by hook_state");
            let expected = self.group(matcher, args);
            let marked: Vec<&Value> = list.iter().filter(|g| group_marked(g)).collect();
            if marked.len() == 1 && *marked[0] == expected {
                continue;
            }
            strip_marked(list);
            list.push(expected);
        }
    }
}

fn skill_text() -> String {
    format!(
        "---\nname: roundup\ndescription: Use when the user talks about roundup, its Projects, Agents or Terminals, or asks you to start, check or steer coding Agents from the shell.\n{MARK}: {SKILL_VERSION}\n---\n\n\
         # roundup\n\n\
         roundup supervises coding Agents in the user's Projects. Its command line is `rup`.\n\n\
         Run `rup help` to learn the commands before using one; this file holds no copy of them.\n"
    )
}

/// The version in the front matter's owner mark, when the text has one.
fn skill_version(text: &str) -> Option<u32> {
    let rest = text.strip_prefix("---\n")?;
    let front = rest.split("\n---").next()?;
    front.lines().find_map(|line| {
        line.strip_prefix(MARK)?
            .strip_prefix(':')?
            .trim()
            .parse()
            .ok()
    })
}

/// `Ok(None)` when the file is absent; `Err` when it cannot be read or is not a JSON object.
fn read_settings(path: &Path) -> Result<Option<Map<String, Value>>, ()> {
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(()),
    };
    match serde_json::from_slice(&bytes) {
        Ok(Value::Object(map)) => Ok(Some(map)),
        _ => Err(()),
    }
}

/// The event lists under `hooks`, or `Err` when `hooks` or a list has the wrong type.
fn event_lists(doc: &Map<String, Value>) -> Result<Map<String, Value>, ()> {
    let mut out = Map::new();
    match doc.get("hooks") {
        None => {}
        Some(Value::Object(hooks)) => {
            for (event, list) in hooks {
                if !list.is_array() {
                    return Err(());
                }
                out.insert(event.clone(), list.clone());
            }
        }
        Some(_) => return Err(()),
    }
    Ok(out)
}

fn any_marked_elsewhere(doc: &Map<String, Value>) -> bool {
    doc.get("hooks")
        .and_then(Value::as_object)
        .is_some_and(|hooks| {
            hooks
                .iter()
                .filter(|(event, _)| !HOOKS.iter().any(|(e, _, _)| e == event))
                .any(|(_, list)| list.as_array().is_some_and(|l| l.iter().any(group_marked)))
        })
}

/// The owner mark of a hook entry: `<absolute path>/rup skill report ...`.
fn command_marked(command: &str) -> bool {
    let Some(words) = shlex::split(command) else {
        return false;
    };
    matches!(words.as_slice(), [rup, skill, report, ..]
    if skill == "skill" && report == "report" && {
        let rup = Path::new(rup);
        rup.is_absolute() && rup.file_name().is_some_and(|n| n == "rup")
    })
}

fn hook_marked(hook: &Value) -> bool {
    hook.get("command")
        .and_then(Value::as_str)
        .is_some_and(command_marked)
}

fn group_marked(group: &Value) -> bool {
    group
        .get("hooks")
        .and_then(Value::as_array)
        .is_some_and(|h| h.iter().any(hook_marked))
}

/// Delete the marked hooks from an event list, and the groups they leave empty.
fn strip_marked(list: &mut Vec<Value>) -> bool {
    let mut removed = false;
    list.retain_mut(|group| {
        let Some(hooks) = group.get_mut("hooks").and_then(Value::as_array_mut) else {
            return true;
        };
        let before = hooks.len();
        hooks.retain(|h| !hook_marked(h));
        let changed = hooks.len() != before;
        removed |= changed;
        !(changed && hooks.is_empty())
    });
    removed
}

fn remove_hooks(doc: &mut Map<String, Value>) {
    let Some(hooks) = doc.get_mut("hooks").and_then(Value::as_object_mut) else {
        return;
    };
    let mut emptied = Vec::new();
    for (event, list) in hooks.iter_mut() {
        if let Some(list) = list.as_array_mut()
            && strip_marked(list)
            && list.is_empty()
        {
            emptied.push(event.clone());
        }
    }
    let touched = !emptied.is_empty();
    for event in emptied {
        hooks.shift_remove(&event);
    }
    if touched && hooks.is_empty() {
        doc.shift_remove("hooks");
    }
}

fn render(doc: &Map<String, Value>) -> Vec<u8> {
    let mut text = serde_json::to_string_pretty(doc).expect("a JSON map serializes");
    text.push('\n');
    text.into_bytes()
}

/// A temporary file in the target's folder, then a rename. A symbolic link is written through to
/// its target and stays a link.
fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let target = if std::fs::symlink_metadata(path).is_ok_and(|m| m.file_type().is_symlink()) {
        std::fs::canonicalize(path)?
    } else {
        path.to_owned()
    };
    let dir = target.parent().expect("a file has a folder");
    std::fs::create_dir_all(dir)?;
    let mut tmp = NamedTempFile::new_in(dir)?;
    tmp.write_all(bytes)?;
    if let Ok(meta) = std::fs::metadata(&target) {
        tmp.as_file().set_permissions(meta.permissions())?;
    }
    tmp.persist(&target).map_err(|e| e.error)?;
    Ok(())
}

/// Delete `SKILL.md`, then the folder when it is empty.
fn remove_skill(file: &Path) -> io::Result<()> {
    std::fs::remove_file(file)?;
    // Extra files keep the folder.
    let _ = std::fs::remove_dir(file.parent().expect("skill file has a folder"));
    Ok(())
}
