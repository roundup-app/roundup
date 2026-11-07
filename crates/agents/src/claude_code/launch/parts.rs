//! The pieces of a launch: trust, PATH and global instructions.
#![deny(clippy::fn_params_excessive_bools)]

use super::*;

impl Launcher {
    /// Set `hasTrustDialogAccepted` for `cwd`, under its NFC form (the key Claude Code looks up), keeping every other key. A config that cannot be
    /// read as a JSON object is an error, never overwritten. Trust is never withdrawn: an Agent
    /// ending says nothing about the folder, and the user may have trusted it before roundup did.
    pub(super) fn trust(&self, cwd: &Path) -> Result<(), RpcError> {
        let _serial = TRUSTING.lock().unwrap_or_else(PoisonError::into_inner);
        let _lock = ConfigLock::take(&self.claude_json).map_err(RpcError::internal)?;
        let mut config = match std::fs::read_to_string(&self.claude_json) {
            Ok(text) => serde_json::from_str(&text).map_err(|err| self.unreadable(err))?,
            Err(err) if err.kind() == ErrorKind::NotFound => json!({}),
            Err(err) => return Err(self.unreadable(err)),
        };
        let projects = object(&mut config)
            .and_then(|root| object(root.entry("projects").or_insert_with(|| json!({}))))
            .map_err(|err| self.unreadable(err))?;
        let project = projects
            .entry(cwd.to_string_lossy().nfc().collect::<String>())
            .or_insert_with(|| json!({}));
        object(project)
            .map_err(|err| self.unreadable(err))?
            .insert("hasTrustDialogAccepted".into(), true.into());
        replace_file(
            &landing(&self.claude_json).map_err(RpcError::internal)?,
            &config,
        )
        .map_err(RpcError::internal)
    }

    /// A43: the folder of `rup`, then (F4) a Door's `shims`, then the `PATH` this process has.
    pub(super) fn shell_path(&self, shims: Option<&Path>) -> OsString {
        let mut path = self
            .rup
            .parent()
            .map_or_else(OsString::new, |dir| dir.as_os_str().to_owned());
        for next in shims.map(Path::as_os_str).into_iter().chain(
            std::env::var_os("PATH")
                .as_deref()
                .filter(|p| !p.is_empty()),
        ) {
            path.push(":");
            path.push(next);
        }
        path
    }

    /// LC5: the user's global `CLAUDE.md`, when it holds text.
    pub(super) fn global_instructions(&self) -> Option<String> {
        let text = std::fs::read_to_string(self.conversation_dir.join("CLAUDE.md")).ok()?;
        (!text.trim().is_empty()).then(|| text.trim_end().to_owned())
    }

    pub(super) fn unreadable(&self, err: impl std::fmt::Display) -> RpcError {
        RpcError::internal(format!("{}: {err}", self.claude_json.display()))
    }
}

fn object(value: &mut Value) -> Result<&mut Map<String, Value>, &'static str> {
    value.as_object_mut().ok_or("expected a JSON object")
}
