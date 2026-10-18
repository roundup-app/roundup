//! Q11: complete, byte-preserving plugins, delivered only beneath roundup's data directory.
//! The caller supplies Project data, never the Project working directory. No network or user
//! configuration is read. Keep the returned bundle alive for the lifetime of its Agent.

use std::collections::BTreeSet;
use std::fmt;
use std::io::Read;
use std::os::unix::fs::PermissionsExt;
use std::path::{Component, Path, PathBuf};
use std::time::Duration;

use serde::Deserialize;
use sha2::{Digest, Sha256};
use tokio::process::Command;

const PIN: &str = "595eda0e3b477d1af1daad82f395073d4f912c8d";
const PACKED: &[u8] = include_bytes!("../../assets/plugins/moo.json.gz");
const CHECKSUM: &str = include_str!("../../assets/plugins/moo.sha256");
const PROBE: &str = include_str!("../../assets/plugins/runtime.test.ts.in");
const PLUGINS: [(&str, &str); 3] = [("hope", "13.1.0"), ("hunch", "0.9.4"), ("hold", "0.0.9")];

#[derive(Debug)]
pub enum Error {
    Integrity(String),
    Storage(std::io::Error),
    UnsupportedRuntime(String),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Integrity(path) => write!(
                f,
                "Q11 plugin asset missing or corrupt: {path}; reinstall roundup's pinned bundle"
            ),
            Self::Storage(error) => write!(
                f,
                "Q11 cannot write plugin bundle to roundup data: {error}; check data directory permissions and free space"
            ),
            Self::UnsupportedRuntime(detail) => write!(
                f,
                "Q11 unsupported Claude runtime: {detail}; use a Claude release supporting function hooks, claude-code.update and plugin test (verified with 2.1.296); keep CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1"
            ),
        }
    }
}

impl std::error::Error for Error {}

impl From<std::io::Error> for Error {
    fn from(error: std::io::Error) -> Self {
        Self::Storage(error)
    }
}

#[derive(Deserialize)]
struct Source {
    repository: String,
    commit: String,
    assets: Vec<Asset>,
}

#[derive(Deserialize)]
struct Asset {
    path: String,
    mode: u32,
    sha256: String,
    content: String,
}

#[derive(Deserialize)]
struct Manifest {
    name: String,
    version: String,
}

/// Complete materialized plugin set. Its private staging directory is deleted on drop.
/// Every asset is checked before publication; callers cannot receive a partial set.
pub struct Plugins {
    storage: tempfile::TempDir,
    directories: [PathBuf; 3],
    source: Source,
}

/// Materialize all pinned bytes offline. `data` must be roundup-owned Project data.
/// Unique staging avoids concurrent delivery races and never overwrites an existing directory.
pub fn materialize(data: &Path) -> Result<Plugins, Error> {
    let source = source()?;
    std::fs::create_dir_all(data)?;
    let storage = tempfile::Builder::new()
        .prefix("q11-plugins-")
        .tempdir_in(data)?;
    for asset in &source.assets {
        let path = storage.path().join(&asset.path);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&path, &asset.content)?;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(asset.mode))?;
    }
    let directories = PLUGINS.map(|(name, _)| storage.path().join(name));
    let bundle = Plugins {
        storage,
        directories,
        source,
    };
    bundle.validate()?;
    Ok(bundle)
}

impl Plugins {
    pub fn directories(&self) -> &[PathBuf; 3] {
        &self.directories
    }

    /// Check every pinned file and its mode again immediately before configuring a launch.
    /// A symlink, absent file, changed byte or extra file rejects the whole set.
    pub fn validate(&self) -> Result<(), Error> {
        let mut found = BTreeSet::new();
        inventory(self.storage.path(), self.storage.path(), &mut found)?;
        let expected: BTreeSet<_> = self.source.assets.iter().map(|a| a.path.clone()).collect();
        if found != expected {
            return Err(Error::Integrity("bundle inventory".into()));
        }
        for asset in &self.source.assets {
            let path = self.storage.path().join(&asset.path);
            let bytes = std::fs::read(&path).map_err(|_| Error::Integrity(asset.path.clone()))?;
            let metadata = std::fs::symlink_metadata(&path)?;
            if !metadata.is_file()
                || metadata.permissions().mode() & 0o777 != asset.mode
                || checksum(&bytes) != asset.sha256
            {
                return Err(Error::Integrity(asset.path.clone()));
            }
        }
        Ok(())
    }

    /// Exercise the actual Claude module loader, including the vendor `update` import,
    /// hunch's local modules and both registration functions, without a model request/login.
    /// Run when selecting a runtime, outside the cold Agent-start path. Retain the returned
    /// runtime for launches; changing the executable requires another probe.
    pub async fn runtime(&self, executable: &Path) -> Result<Runtime, Error> {
        self.validate()?;
        let probe = tempfile::Builder::new().prefix("q11-runtime-").tempdir_in(
            self.storage
                .path()
                .parent()
                .ok_or_else(|| Error::Integrity("data directory".into()))?,
        )?;
        // Claude only imports relative modules inside its plugin root. Probe byte-identical
        // copies under a separate roundup root so pinned directories gain no test files.
        for asset in self
            .source
            .assets
            .iter()
            .filter(|a| !a.path.contains(".test."))
        {
            let path = probe.path().join(&asset.path);
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            std::fs::write(path, &asset.content)?;
        }
        std::fs::create_dir(probe.path().join("hooks"))?;
        std::fs::create_dir(probe.path().join(".claude-plugin"))?;
        std::fs::write(
            probe.path().join(".claude-plugin/plugin.json"),
            r#"{"name":"roundup-q11-probe","version":"1.0.0"}"#,
        )?;
        std::fs::write(
            probe.path().join("hooks/hooks.json"),
            r#"{"modules":["./q11.ts"]}"#,
        )?;
        std::fs::write(
            probe.path().join("hooks/q11.ts"),
            "import {register as hope} from '../hope/hooks/slop.tsx';\nimport {register as hunch} from '../hunch/hooks/tend.tsx';\nexport const register = (on) => { hope(on); hunch(on); };\n",
        )?;
        std::fs::write(probe.path().join("hooks/q11.test.ts"), PROBE)?;
        let executable = executable
            .canonicalize()
            .map_err(|e| Error::UnsupportedRuntime(e.to_string()))?;
        let mut command = Command::new(&executable);
        command
            .args(["plugin", "test"])
            .arg(probe.path())
            .current_dir(probe.path())
            .env("CLAUDE_CODE_ENABLE_FUNCTION_HOOKS", "1")
            .env("CLAUDE_CONFIG_DIR", probe.path().join("config"))
            .kill_on_drop(true);
        let output = tokio::time::timeout(Duration::from_secs(15), command.output())
            .await
            .map_err(|_| {
                Error::UnsupportedRuntime("hook loader probe timed out after 15 seconds".into())
            })?
            .map_err(|e| Error::UnsupportedRuntime(e.to_string()))?;
        let report = format!(
            "{}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        if !output.status.success()
            || !report.contains("Q11 runtime hook closure")
            || !report.contains("1 pass")
        {
            return Err(Error::UnsupportedRuntime(
                report.chars().take(2000).collect(),
            ));
        }
        Ok(Runtime { executable })
    }
}

/// A Claude executable whose actual hook loader successfully imported the packaged modules.
/// It is a capability, not a version guess. #1521 owns caching it per selected executable.
pub struct Runtime {
    executable: PathBuf,
}

impl Runtime {
    /// Create a launch command only after verifying the complete set. All three plugin paths
    /// and the function-hook flag are inseparable; the caller adds its Agent-specific args.
    pub fn command(&self, plugins: &Plugins) -> Result<Command, Error> {
        plugins.validate()?;
        let mut command = Command::new(&self.executable);
        command.env("CLAUDE_CODE_ENABLE_FUNCTION_HOOKS", "1");
        // Directory-development mode writes unpinned types/tsconfig into plugin roots,
        // poisoning exact inventory checks on subsequent launch, resume and clear.
        command.env("CLAUDE_CODE_PLUGIN_DIR_WATCH", "0");
        for path in plugins.directories() {
            command.arg("--plugin-dir").arg(path);
        }
        Ok(command)
    }
}

/// LC13: whether the pinned bundle holds the `hope` skill the Door's Brief names.
pub fn has_intent() -> bool {
    source().is_ok_and(|source| {
        source
            .assets
            .iter()
            .any(|asset| asset.path == "hope/skills/intent/SKILL.md")
    })
}

fn checksum(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn source() -> Result<Source, Error> {
    if checksum(PACKED) != CHECKSUM.trim() {
        return Err(Error::Integrity("embedded moo.json.gz".into()));
    }
    let mut bytes = Vec::new();
    flate2::read::GzDecoder::new(PACKED).read_to_end(&mut bytes)?;
    let source: Source =
        serde_json::from_slice(&bytes).map_err(|e| Error::Integrity(e.to_string()))?;
    if source.commit != PIN
        || source.repository != "https://github.com/saadshahd/moo.md"
        || source.assets.len() != 158
    {
        return Err(Error::Integrity("pinned source provenance".into()));
    }
    let mut paths = BTreeSet::new();
    for asset in &source.assets {
        if Path::new(&asset.path)
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
            || !paths.insert(&asset.path)
            || !matches!(asset.mode, 0o644 | 0o755)
            || checksum(asset.content.as_bytes()) != asset.sha256
        {
            return Err(Error::Integrity(asset.path.clone()));
        }
    }
    for (name, version) in PLUGINS {
        let path = format!("{name}/.claude-plugin/plugin.json");
        let asset = source
            .assets
            .iter()
            .find(|a| a.path == path)
            .ok_or_else(|| Error::Integrity(path.clone()))?;
        let manifest: Manifest =
            serde_json::from_str(&asset.content).map_err(|_| Error::Integrity(path.clone()))?;
        if manifest.name != name || manifest.version != version {
            return Err(Error::Integrity(path));
        }
    }
    Ok(source)
}

fn inventory(root: &Path, directory: &Path, files: &mut BTreeSet<String>) -> Result<(), Error> {
    for entry in std::fs::read_dir(directory)? {
        let entry = entry?;
        let kind = entry.file_type()?;
        if kind.is_symlink() {
            return Err(Error::Integrity(entry.path().display().to_string()));
        }
        if kind.is_dir() {
            inventory(root, &entry.path(), files)?;
        } else if kind.is_file() {
            let path = entry.path();
            let relative = path
                .strip_prefix(root)
                .map_err(|_| Error::Integrity(path.display().to_string()))?;
            files.insert(relative.to_string_lossy().into_owned());
        } else {
            return Err(Error::Integrity(entry.path().display().to_string()));
        }
    }
    Ok(())
}
