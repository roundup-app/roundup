//! A31: the Skills a Door can call, read from the vendor's folders at each call and kept nowhere.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use contracts::agent::Skill;
use serde_json::Value;

/// P9: commands roundup must never offer, for they change the Agent's model, effort or context.
pub const BANNED: [&str; 4] = ["model", "effort", "compact", "clear"];

/// A31: longest description, in characters, the `…` included.
const DESCRIPTION_CUT: usize = 160;

/// The Skills of an Agent working in `cwd` inside the Project `root`, for the user whose home
/// folder is `home`, sorted by name. Anything unreadable is skipped.
pub fn skills(home: &Path, cwd: &Path, root: &Path) -> Vec<Skill> {
    let vendor = home.join(".claude");
    let mut found = BTreeMap::new();
    let mut add = |entry: Option<Skill>| {
        if let Some(skill) = entry.filter(|skill| !banned(&skill.name)) {
            found.insert(skill.name.clone(), skill);
        }
    };
    for skill in in_folder(&vendor.join("skills"), None) {
        add(Some(skill));
    }
    for (plugin, path) in plugins(&vendor) {
        for skill in in_folder(&path.join("skills"), Some(&plugin)) {
            add(Some(skill));
        }
    }
    for skill in commands(&vendor.join("commands")) {
        add(Some(skill));
    }
    for folder in project_folders(cwd, root) {
        for skill in in_folder(&folder.join(".claude/skills"), None) {
            add(Some(skill));
        }
        for skill in commands(&folder.join(".claude/commands")) {
            add(Some(skill));
        }
    }
    found.into_values().collect()
}

/// `cwd` and each parent up to `root`, the farthest first. A `cwd` outside `root` is followed by
/// `root` itself.
fn project_folders(cwd: &Path, root: &Path) -> Vec<PathBuf> {
    let mut folders: Vec<PathBuf> = if cwd.starts_with(root) {
        cwd.ancestors()
            .take_while(|dir| dir.starts_with(root))
            .map(Path::to_path_buf)
            .collect()
    } else {
        vec![cwd.to_path_buf(), root.to_path_buf()]
    };
    folders.reverse();
    folders
}

fn banned(name: &str) -> bool {
    BANNED.contains(&name.rsplit(':').next().unwrap_or(name))
}

/// `<folder>/<dir>/SKILL.md` for each `dir`, in name order.
fn in_folder(folder: &Path, plugin: Option<&str>) -> Vec<Skill> {
    let mut dirs: Vec<PathBuf> = fs::read_dir(folder)
        .into_iter()
        .flatten()
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .collect();
    dirs.sort();
    dirs.iter()
        .filter_map(|dir| {
            let stem = dir.file_name()?.to_str()?;
            skill(&dir.join("SKILL.md"), stem, plugin)
        })
        .collect()
}

/// `<folder>/*.md`, each named by its stem.
fn commands(folder: &Path) -> Vec<Skill> {
    let mut files: Vec<PathBuf> = fs::read_dir(folder)
        .into_iter()
        .flatten()
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.is_file() && path.extension().is_some_and(|ext| ext == "md"))
        .collect();
    files.sort();
    files
        .iter()
        .filter_map(|file| skill(file, file.file_stem()?.to_str()?, None))
        .collect()
}

fn skill(file: &Path, fallback: &str, plugin: Option<&str>) -> Option<Skill> {
    let text = fs::read_to_string(file).ok()?;
    let fields = front_matter(&text)?;
    if fields
        .get("user-invocable")
        .is_some_and(|value| value.eq_ignore_ascii_case("false"))
    {
        return None;
    }
    let name = fields
        .get("name")
        .filter(|name| !name.is_empty())
        .map_or(fallback, String::as_str);
    let name = match plugin {
        Some(plugin) => format!("{plugin}:{name}"),
        None => name.to_owned(),
    };
    let description = fields
        .get("description")
        .map_or_else(String::new, |text| cut(text));
    Some(Skill { name, description })
}

/// The `key: value` pairs between a leading `---` line and the next one. `None` when the block
/// never closes or a line in it is neither a pair nor a continuation. No block gives no pairs.
fn front_matter(text: &str) -> Option<BTreeMap<String, String>> {
    let mut lines = text.lines();
    let mut fields = BTreeMap::new();
    if lines.next().map(str::trim_end) != Some("---") {
        return Some(fields);
    }
    let mut last: Option<String> = None;
    for line in lines {
        if line.trim_end() == "---" {
            return Some(fields);
        }
        if line.trim().is_empty() {
            continue;
        }
        if line.starts_with([' ', '\t']) {
            let key = last.as_ref()?;
            let value = fields.get_mut(key)?;
            value.push(' ');
            value.push_str(line.trim());
            continue;
        }
        let (key, value) = line.split_once(':')?;
        let value = value.trim();
        let value = if matches!(value, ">" | "|" | ">-" | "|-" | ">+" | "|+") {
            ""
        } else {
            unquote(value)
        };
        last = Some(key.trim().to_owned());
        fields.insert(key.trim().to_owned(), value.to_owned());
    }
    None
}

fn unquote(value: &str) -> &str {
    for quote in ['"', '\''] {
        if let Some(inner) = value
            .strip_prefix(quote)
            .and_then(|v| v.strip_suffix(quote))
        {
            return inner;
        }
    }
    value
}

/// One line of single spaces, at most [`DESCRIPTION_CUT`] characters.
fn cut(text: &str) -> String {
    let line = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if line.chars().count() <= DESCRIPTION_CUT {
        return line;
    }
    let mut head: String = line.chars().take(DESCRIPTION_CUT - 1).collect();
    head.truncate(head.trim_end().len());
    head.push('…');
    head
}

/// Each plugin `installed_plugins.json` lists, by name and install path. Version 1 holds one
/// object per plugin, version 2 a list of them.
fn plugins(vendor: &Path) -> Vec<(String, PathBuf)> {
    let Ok(text) = fs::read_to_string(vendor.join("plugins/installed_plugins.json")) else {
        return Vec::new();
    };
    let Ok(Value::Object(root)) = serde_json::from_str::<Value>(&text) else {
        return Vec::new();
    };
    let Some(Value::Object(listed)) = root.get("plugins") else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for (key, value) in listed {
        let name = key.split('@').next().unwrap_or(key).to_owned();
        let installs = match value {
            Value::Array(items) => items.iter().collect(),
            other => vec![other],
        };
        for install in installs {
            if let Some(path) = install["installPath"].as_str().map(PathBuf::from)
                && path.is_dir()
            {
                out.push((name.clone(), path));
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(path: &Path, text: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }

    fn skill_file(base: &Path, dir: &str, front: &str) {
        write(
            &base.join(dir).join("SKILL.md"),
            &format!("---\n{front}\n---\nbody\n"),
        );
    }

    fn names(list: &[Skill]) -> Vec<&str> {
        list.iter().map(|s| s.name.as_str()).collect()
    }

    #[test]
    fn a31_lists_user_project_plugin_and_command_skills() {
        let dir = tempfile::tempdir().unwrap();
        let (home, root) = (dir.path().join("home"), dir.path().join("proj"));
        skill_file(
            &home.join(".claude/skills"),
            "reduce",
            "name: reduce\ndescription: Shorten it",
        );
        skill_file(
            &root.join(".claude/skills"),
            "tdd",
            "description: Test first",
        );
        let plugin = dir.path().join("cache/p");
        skill_file(&plugin.join("skills"), "ship", "name: ship");
        write(
            &home.join(".claude/plugins/installed_plugins.json"),
            &format!(
                r#"{{"version":2,"plugins":{{"extras@market":[{{"installPath":"{}"}}]}}}}"#,
                plugin.display()
            ),
        );
        write(&home.join(".claude/commands/deploy.md"), "run it");
        write(
            &root.join(".claude/commands/lint.md"),
            "---\ndescription: Lint\n---\n",
        );

        let list = skills(&home, &root, &root);

        assert_eq!(
            names(&list),
            ["deploy", "extras:ship", "lint", "reduce", "tdd"]
        );
        assert_eq!(list[3].description, "Shorten it");
        assert_eq!(list[4].description, "Test first");
    }

    #[test]
    fn a31_a_nearer_project_skill_replaces_a_farther_one() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("proj");
        let cwd = root.join("a/b");
        skill_file(&root.join(".claude/skills"), "x", "description: far");
        skill_file(&cwd.join(".claude/skills"), "x", "description: near");

        let list = skills(&dir.path().join("home"), &cwd, &root);

        assert_eq!(
            list,
            [Skill {
                name: "x".into(),
                description: "near".into()
            }]
        );
    }

    #[test]
    fn a31_a_plugin_skill_is_prefixed() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path().join("home");
        let plugin = dir.path().join("p");
        skill_file(&plugin.join("skills"), "dir", "name: review");
        write(
            &home.join(".claude/plugins/installed_plugins.json"),
            &format!(
                r#"{{"plugins":{{"sound@m":{{"installPath":"{}"}}}}}}"#,
                plugin.display()
            ),
        );

        let list = skills(&home, dir.path(), dir.path());

        assert_eq!(names(&list), ["sound:review"]);
    }

    #[test]
    fn a31_description_is_one_cut_line() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path().join("home");
        let long = "word ".repeat(100);
        skill_file(
            &home.join(".claude/skills"),
            "a",
            "description: >\n  two\n  lines",
        );
        skill_file(
            &home.join(".claude/skills"),
            "b",
            &format!("description: \"{long}\""),
        );

        let list = skills(&home, dir.path(), dir.path());

        assert_eq!(list[0].description, "two lines");
        assert_eq!(list[1].description.chars().count(), 160);
        assert!(list[1].description.ends_with('…'));
    }

    #[test]
    fn a31_broken_entries_are_skipped() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path().join("home");
        let skills_dir = home.join(".claude/skills");
        fs::create_dir_all(skills_dir.join("empty")).unwrap();
        write(&skills_dir.join("unclosed/SKILL.md"), "---\nname: u\n");
        write(&skills_dir.join("junk/SKILL.md"), "---\nnot a pair\n---\n");
        skill_file(&skills_dir, "good", "name: good");
        write(
            &home.join(".claude/plugins/installed_plugins.json"),
            r#"{"plugins":{"gone@m":[{"installPath":"/nowhere"}]}}"#,
        );

        assert_eq!(names(&skills(&home, dir.path(), dir.path())), ["good"]);
        assert!(skills(&dir.path().join("none"), dir.path(), dir.path()).is_empty());
    }

    #[test]
    fn a31_banned_commands_are_never_listed() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path().join("home");
        for name in BANNED {
            skill_file(&home.join(".claude/skills"), name, &format!("name: {name}"));
            write(&home.join(format!(".claude/commands/{name}.md")), "x");
        }
        let plugin = dir.path().join("p");
        skill_file(&plugin.join("skills"), "m", "name: model");
        write(
            &home.join(".claude/plugins/installed_plugins.json"),
            &format!(
                r#"{{"plugins":{{"p@m":[{{"installPath":"{}"}}]}}}}"#,
                plugin.display()
            ),
        );

        assert!(skills(&home, dir.path(), dir.path()).is_empty());
    }

    #[test]
    fn a31_a_skill_added_after_a_call_shows_on_the_next() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path().join("home");
        assert!(skills(&home, dir.path(), dir.path()).is_empty());

        skill_file(&home.join(".claude/skills"), "late", "name: late");

        assert_eq!(names(&skills(&home, dir.path(), dir.path())), ["late"]);
    }

    #[test]
    fn a31_a_non_invocable_skill_is_left_out() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path().join("home");
        skill_file(
            &home.join(".claude/skills"),
            "hidden",
            "user-invocable: false",
        );
        skill_file(
            &home.join(".claude/skills"),
            "shown",
            "user-invocable: true",
        );

        assert_eq!(names(&skills(&home, dir.path(), dir.path())), ["shown"]);
    }
}
