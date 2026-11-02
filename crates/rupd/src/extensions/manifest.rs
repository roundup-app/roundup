//! UA2: `rup-extension.json`, checked before any code runs.

use std::path::{Component, Path};

use serde_json::Value;

pub(super) const FILE: &str = "rup-extension.json";
const PERMISSIONS: [&str; 7] = ["agents", "todos", "pads", "bus", "ui", "store", "clock"];

pub(super) struct Manifest {
    pub name: String,
    pub module: String,
    pub permissions: Vec<String>,
}

/// What changes when the owner saves the manifest or the module; `None` for a folder with no
/// manifest, which is not an Extension.
pub(super) fn fingerprint(folder: &Path) -> Option<String> {
    let manifest = std::fs::read(folder.join(FILE)).ok()?;
    let module = serde_json::from_slice::<Value>(&manifest)
        .ok()
        .and_then(|manifest| {
            manifest["module"]
                .as_str()
                .map(|module| folder.join(module))
        })
        .and_then(|module| std::fs::metadata(module).ok())
        .map(|meta| (meta.modified().ok(), meta.len()));
    Some(format!("{}|{module:?}", String::from_utf8_lossy(&manifest)))
}

/// The manifest, or the cause naming the file and the broken part.
pub(super) fn read(folder: &Path) -> Result<Manifest, String> {
    let folder_name = folder.file_name().unwrap_or_default().to_string_lossy();
    let at = format!("{folder_name}/{FILE}");
    let text = std::fs::read_to_string(folder.join(FILE))
        .map_err(|err| format!("{at}: unreadable: {err}"))?;
    let value: Value =
        serde_json::from_str(&text).map_err(|err| format!("{at}: not JSON: {err}"))?;
    let string = |key: &str| match value[key].as_str() {
        Some(text) if !text.is_empty() => Ok(text.to_owned()),
        _ => Err(format!("{at}: \"{key}\" is missing or not a string")),
    };
    let name = string("name")?;
    let module = string("module")?;
    let permissions = value["permissions"]
        .as_array()
        .ok_or_else(|| format!("{at}: \"permissions\" is missing or not a list"))?
        .iter()
        .map(|permission| permission.as_str().map(str::to_owned))
        .collect::<Option<Vec<_>>>()
        .ok_or_else(|| format!("{at}: \"permissions\" holds a non-string"))?;
    if let Some(other) = permissions
        .iter()
        .find(|p| !PERMISSIONS.contains(&p.as_str()))
    {
        return Err(format!(
            "{at}: \"permissions\" lists \"{other}\"; the permissions are {}",
            PERMISSIONS.join(", ")
        ));
    }
    let relative = Path::new(&module);
    let inside = relative.is_relative()
        && relative
            .components()
            .all(|part| matches!(part, Component::Normal(_)));
    let resolved = folder.join(relative).canonicalize().ok();
    let inside = inside
        && resolved.as_ref().is_none_or(|resolved| {
            folder
                .canonicalize()
                .is_ok_and(|folder| resolved.starts_with(folder))
        });
    if !inside {
        return Err(format!(
            "{at}: \"module\" \"{module}\" is outside the Extension's own folder"
        ));
    }
    Ok(Manifest {
        name,
        module,
        permissions,
    })
}
