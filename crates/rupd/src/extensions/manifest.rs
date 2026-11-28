//! UA2: `rup-extension.json`, checked before any code runs.

use crate::field::Field;
use std::path::{Component, Path};

use contracts::extension::Capability;
use serde_json::Value;

pub(super) const FILE: &str = "rup-extension.json";
const PERMISSIONS: [&str; 7] = ["agents", "todos", "pads", "bus", "ui", "store", "clock"];

/// MC42: what a single-file action may use, with no manifest to ask for more.
const NARROW: [&str; 3] = ["todos", "pads", "store"];

fn is_single_file(path: &Path) -> bool {
    path.is_file()
        && path
            .extension()
            .is_some_and(|ext| ext == "js" || ext == "mjs")
}

pub(super) struct Manifest {
    pub name: String,
    pub module: String,
    pub permissions: Vec<String>,
    /// EP5: the capabilities the manifest asks for, in the order of `Capability`, once each.
    pub uses: Vec<Capability>,
    /// EP5: the folder, which keys `$.store` and the `ext:` Actor (EP6); set by the loader.
    pub dir: String,
    /// EP5: what rupd granted; set by the loader from the owner's approvals.
    pub granted: Vec<Capability>,
}

/// What changes when the owner saves the manifest or the module; `None` for a folder with no
/// manifest, which is not an Extension.
pub(super) fn fingerprint(folder: &Path) -> Option<String> {
    if is_single_file(folder) {
        let meta = std::fs::metadata(folder).ok()?;
        return Some(format!("file|{:?}|{}", meta.modified().ok(), meta.len()));
    }
    let manifest = std::fs::read(folder.join(FILE)).ok()?;
    let module = serde_json::from_slice::<Value>(&manifest)
        .ok()
        .and_then(|manifest| {
            manifest
                .field("module")
                .as_str()
                .map(|module| folder.join(module))
        })
        .and_then(|module| std::fs::metadata(module).ok())
        .map(|meta| (meta.modified().ok(), meta.len()));
    Some(format!("{}|{module:?}", String::from_utf8_lossy(&manifest)))
}

/// The folder the module runs in, and its manifest, or the cause naming the file and the broken
/// part. A single `.js` file has no manifest and gets the narrow permissions (MC42).
pub(super) fn read(path: &Path) -> Result<(std::path::PathBuf, Manifest), String> {
    if is_single_file(path) {
        let file = path.file_name().unwrap_or_default().to_string_lossy();
        let stem = path.file_stem().unwrap_or_default().to_string_lossy();
        let manifest = Manifest {
            name: stem.into_owned(),
            module: file.into_owned(),
            permissions: NARROW.map(str::to_owned).to_vec(),
            uses: Vec::new(),
            dir: String::new(),
            granted: Vec::new(),
        };
        return Ok((path.parent().unwrap_or(path).to_path_buf(), manifest));
    }
    let manifest = read_folder(path)?;
    Ok((path.to_path_buf(), manifest))
}

fn read_folder(folder: &Path) -> Result<Manifest, String> {
    let folder_name = folder.file_name().unwrap_or_default().to_string_lossy();
    let at = format!("{folder_name}/{FILE}");
    let text = std::fs::read_to_string(folder.join(FILE))
        .map_err(|err| format!("{at}: unreadable: {err}"))?;
    let value: Value =
        serde_json::from_str(&text).map_err(|err| format!("{at}: not JSON: {err}"))?;
    let string = |key: &str| match value.field(key).as_str() {
        Some(text) if !text.is_empty() => Ok(text.to_owned()),
        _ => Err(format!("{at}: \"{key}\" is missing or not a string")),
    };
    let name = string("name")?;
    let module = string("module")?;
    let permissions = value
        .field("permissions")
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
        uses: uses(&value, &at)?,
        dir: String::new(),
        granted: Vec::new(),
    })
}

/// `uses`, absent for none. A name this roundup does not know asks for nothing it can grant: the
/// interface only grows, so a newer manifest still loads.
fn uses(manifest: &Value, at: &str) -> Result<Vec<Capability>, String> {
    let Some(listed) = manifest.get("uses").filter(|listed| !listed.is_null()) else {
        return Ok(Vec::new());
    };
    let listed = listed
        .as_array()
        .ok_or_else(|| format!("{at}: \"uses\" is not a list"))?;
    let mut asked = std::collections::BTreeSet::new();
    for item in listed {
        let name = item
            .as_str()
            .ok_or_else(|| format!("{at}: \"uses\" holds a non-string"))?;
        if let Ok(capability) = serde_json::from_value(Value::from(name)) {
            asked.insert(capability);
        }
    }
    Ok(asked.into_iter().collect())
}
