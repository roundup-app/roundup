//! The pieces of a launch: trust, settings, PATH, MCP servers and global instructions.

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

    /// A20: the hook command, not the program, carries the launch's Attempt.
    /// A43: `path` is the Agent's `PATH` in Claude Code's `env`, and `ROUNDUP_AGENT_ID` its id.
    pub(super) fn settings_json(
        &self,
        id: u64,
        attempt: &str,
        path: &OsStr,
        mcp: bool,
        missing_intent: bool,
        carried: &Value,
    ) -> Result<Value, RpcError> {
        let agent_id = id.to_string();
        let rup = try_quote(
            self.rup
                .to_str()
                .ok_or_else(|| RpcError::internal("rup path is not UTF-8"))?,
        )
        .map_err(RpcError::internal)?;
        let id = try_quote(&agent_id).expect("numeric Agent id");
        let attempt = try_quote(attempt).map_err(RpcError::internal)?;
        let signal = json!([{ "hooks": [{
            "type": "command",
            "command": format!("ROUNDUP_ATTEMPT={attempt} {rup} signal {id}"),
            "timeout": 5,
        }] }]);
        let session_start = json!([{ "hooks": [
            signal[0]["hooks"][0].clone(),
            { "type": "command", "command": format!("{rup} context {id}"), "timeout": 5 },
        ] }]);
        let hooks: Map<String, Value> = STATE_EVENTS
            .iter()
            .chain(&super::super::background::BACKGROUND_EVENTS)
            .map(|event| {
                let hook = match *event {
                    "SessionStart" => &session_start,
                    _ => &signal,
                };
                ((*event).to_owned(), hook.clone())
            })
            .collect();
        let mut settings = json!({ "hooks": hooks });
        if mcp {
            settings["permissions"] = json!({ "allow": ["mcp__roundup__*"] });
        }
        // LC14: Claude Code's status line keeps the one line on screen for the whole session.
        if missing_intent {
            settings["statusLine"] = json!({
                "type": "command",
                "command": format!("printf %s {}", try_quote(INTENT_MISSING).expect("status line has no NUL")),
            });
        }
        // User env wins over defaults; identity, PATH and the named lean exclusion are explicit.
        let mut env = Map::new();
        for (key, default) in [
            ("CLAUDE_CODE_ENABLE_FUNCTION_HOOKS", "1"),
            ("CLAUDE_CODE_PLUGIN_DIR_WATCH", "0"),
            ("ENABLE_TOOL_SEARCH", "true"),
        ] {
            if carried["env"].get(key).is_none() && !self.user_defaults.contains(key) {
                env.insert(key.into(), default.into());
            }
        }
        env.insert("ROUNDUP_AGENT_ID".into(), agent_id.into());
        env.insert("PATH".into(), path.to_string_lossy().into());
        settings["env"] = Value::Object(env);
        Ok(settings)
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

    /// `RUPD_SOCKET` is left out: Claude Code's environment, which the server inherits, has it.
    pub(super) fn mcp_servers(&self, id: u64) -> Map<String, Value> {
        let Value::Object(servers) = json!({ "roundup": {
            "type": "stdio",
            "command": self.rup.to_string_lossy(),
            "args": ["mcp", id.to_string()],
        } }) else {
            unreachable!("an object literal");
        };
        servers
    }

    /// LC5: the user's global `CLAUDE.md`, as read-only text under a heading.
    pub(super) fn append_global_instructions(&self, brief: &mut String) {
        if let Ok(text) = std::fs::read_to_string(self.conversation_dir.join("CLAUDE.md"))
            && !text.trim().is_empty()
        {
            brief.push_str("\n## The user's global instructions (read-only)\n\n");
            brief.push_str(text.trim_end());
            brief.push('\n');
        }
    }

    pub(super) fn unreadable(&self, err: impl std::fmt::Display) -> RpcError {
        RpcError::internal(format!("{}: {err}", self.claude_json.display()))
    }
}

fn object(value: &mut Value) -> Result<&mut Map<String, Value>, &'static str> {
    value.as_object_mut().ok_or("expected a JSON object")
}
