//! Prepare an Agent launch: its files and argv.

use super::*;

impl Launcher {
    /// Prepare launch files and argv, trusting only a cwd inside the Project.
    /// A22: `resume` continues the saved conversation; `None` starts fresh.
    pub fn prepare(
        &self,
        folders: Folders<'_>,
        id: &str,
        attempt: &str,
        cwd: &Path,
        resume: Option<&str>,
        role: Role,
    ) -> Result<Vec<String>, RpcError> {
        self.prepare_on(folders, id, attempt, cwd, resume, role, &Pair::default())
    }

    /// Like `prepare`, on `pair` (A36): `--model` and `--effort` for each value that is set.
    #[allow(clippy::too_many_arguments)]
    pub fn prepare_on(
        &self,
        folders: Folders<'_>,
        id: &str,
        attempt: &str,
        cwd: &Path,
        resume: Option<&str>,
        role: Role,
        pair: &Pair,
    ) -> Result<Vec<String>, RpcError> {
        let Folders { project, data: dir } = folders;
        let invalid = |message: String| RpcError::new(code::INVALID_PARAMS, message);
        let id = parse_id(id).ok_or_else(|| invalid(format!("{id:?} is not a node id")))?;
        let cwd = cwd
            .canonicalize()
            .map_err(|err| invalid(format!("cwd {} is unusable: {err}", cwd.display())))?;
        if !cwd.is_dir() {
            return Err(invalid(format!("cwd {} is not a folder", cwd.display())));
        }
        if self
            .home
            .as_ref()
            .is_some_and(|home| home.canonicalize().is_ok_and(|home| home == cwd))
        {
            return Err(invalid(format!(
                "cwd {} is the home folder, which is never trusted",
                cwd.display()
            )));
        }
        let dir = dir
            .canonicalize()
            .map_err(|err| RpcError::internal(format!("{}: {err}", dir.display())))?;
        let project = project
            .canonicalize()
            .map_err(|err| RpcError::internal(format!("{}: {err}", project.display())))?;
        if !cwd.starts_with(&project) {
            return Err(invalid(format!(
                "cwd {} is outside the project folder {}",
                cwd.display(),
                project.display()
            )));
        }
        if !self.rup.is_absolute() || !self.rup.is_file() {
            return Err(RpcError::internal(format!(
                "rup not found at {}: hooks could not signal",
                self.rup.display()
            )));
        }
        // Refuse a symlinked agents directory (A13) before writing anything, through the
        // link or beside it: the Project's own files are not ours to trust, and a link
        // could land a write anywhere.
        let agents_dir = agents_dir(&dir);
        if is_symlink(&agents_dir) {
            return Err(invalid(format!("{} is a symlink", agents_dir.display())));
        }
        let settings = settings_path(&dir, id);
        let mcp_config = mcp_config_path(&dir, id);
        let shims = shim_dir(&dir, id);
        if is_symlink(&shims) {
            return Err(invalid(format!("{} is a symlink", shims.display())));
        }
        let path = self.shell_path((role == Role::Door).then_some(shims.as_path()));
        if role == Role::Door {
            write_shims(&shims).map_err(RpcError::internal)?;
        }
        let mcp = !pair.mcp_off;
        let lean = lean_of(role, pair);
        let role = match (&lean, role) {
            (Some(lean), Role::Agent) if lean.scout => Role::Scout,
            _ => role,
        };
        let delivery = match &lean {
            Some(lean) => extras::resolve(&self.extras_sources(&project), &lean.extras)?,
            None => extras::Delivery::default(),
        };
        let mut carried =
            user_settings(&self.conversation_dir, &project).map_err(RpcError::internal)?;
        let missing_intent = self.door_lacks_intent(role, &carried, &project);
        if carried.get("outputStyle").is_none() {
            carried["outputStyle"] = json!("hold:Plain");
        }
        replace_file(&settings, &{
            let mut own = self.settings_json(id, attempt, &path, mcp, missing_intent, &carried)?;
            super::super::memory::hook(
                &self.rup,
                &self.conversation_dir,
                self.home.as_deref(),
                &cwd,
                role,
                &carried,
                &mut own,
            )?;
            if role == Role::Door && mcp {
                own["permissions"]["allow"] = json!(
                    brief::door_tools()
                        .filter(|name| *name != "terminal_write")
                        .map(|name| format!("mcp__roundup__{name}"))
                        .collect::<Vec<_>>()
                );
            }
            if lean.is_some() {
                // LC17: the Brief carries each `CLAUDE.md` as LC1 lists it; Claude Code loads none.
                own["env"]["CLAUDE_CODE_DISABLE_CLAUDE_MDS"] = json!("1");
            }
            for (key, value) in pair.env() {
                own["env"][key] = json!(value);
            }
            if lean.is_none() {
                let command = own["hooks"]["SessionStart"][0]["hooks"][1]["command"]
                    .as_str()
                    .expect("context command");
                own["hooks"]["SessionStart"][0]["hooks"][1]["command"] = json!(format!(
                    "ROUNDUP_BRIEF_FILE={} {command}",
                    try_quote(
                        brief_path(&dir, id)
                            .to_str()
                            .ok_or_else(|| invalid("Brief path is not UTF-8".into()))?
                    )
                    .map_err(RpcError::internal)?
                ));
            }
            merge_settings(&mut carried, own);
            let mut settings = carried;
            if pair.yolo {
                settings["skipDangerousModePermissionPrompt"] = json!(true);
                // Roundup has already checked its Route and actor authority. Claude's
                // inbox class vocabulary differs from the launch-mode label on our notes.
                settings["crossSessionInbound"] = json!("accept");
            }
            settings
        })
        .map_err(RpcError::internal)?;
        let mut servers = Map::new();
        if mcp {
            servers.extend(self.mcp_servers(id));
            if let Some(guide) = &pair.naming_guide {
                servers.get_mut("roundup").expect("roundup MCP server")["env"] =
                    json!({"ROUNDUP_NAMING_GUIDE": guide});
            }
        }
        servers.extend(delivery.servers.clone());
        let has_config = !servers.is_empty();
        if has_config {
            replace_file(&mcp_config, &json!({ "mcpServers": servers }))
                .map_err(RpcError::internal)?;
        } else if is_symlink(&mcp_config) {
            return Err(invalid(format!("{} is a symlink", mcp_config.display())));
        } else {
            // An earlier launch with MCP on left its config; the Agent must not find it.
            match std::fs::remove_file(&mcp_config) {
                Err(err) if err.kind() != std::io::ErrorKind::NotFound => {
                    return Err(RpcError::internal(err));
                }
                _ => {}
            }
        }
        let brief_file = brief_path(&dir, id);
        let mut brief = brief::text(role, mcp);
        if missing_intent {
            brief = brief::without_intent(&brief);
        }
        if profile(role).global_instructions {
            self.append_global_instructions(&mut brief);
        }
        if lean.is_some() {
            for folder in std::iter::once(&project).chain((cwd != project).then_some(&cwd)) {
                if let Ok(text) = std::fs::read_to_string(folder.join("CLAUDE.md")) {
                    brief.push_str("\n## The Project's instructions (read-only)\n\n");
                    brief.push_str(&text);
                    brief.push('\n');
                }
            }
        }
        replace_text(&brief_file, &brief).map_err(RpcError::internal)?;
        self.trust(&cwd)?;
        let mut argv = vec![
            self.bin.clone(),
            "--settings".into(),
            settings.to_string_lossy().into_owned(),
        ];
        if has_config {
            argv.push("--mcp-config".into());
            argv.push(mcp_config.to_string_lossy().into_owned());
        }
        if let Some(lean) = &lean {
            argv.push("--append-system-prompt-file".into());
            argv.push(brief_file.to_string_lossy().into_owned());
            let row = profile(role);
            if let Some((with, without)) = row.tools {
                argv.push("--tools".into());
                argv.push(if mcp { with } else { without }.into());
            }
            if !delivery.skills.is_empty() {
                let folder = extras::skill_plugin(&extras_dir(&dir, id), &delivery.skills)?;
                argv.extend(["--plugin-dir".into(), folder.to_string_lossy().into_owned()]);
            }
            for plugin in &delivery.plugins {
                argv.extend(["--plugin-dir".into(), plugin.to_string_lossy().into_owned()]);
            }
            if delivery.computer_use {
                argv.push(extras::COMPUTER_USE_SWITCH.into());
            }
            if lean.fresh_brief && resume.is_some() {
                argv.extend(["--system-prompt-snapshot", "off"].map(String::from));
            }
        }
        for (flag, value) in [("--model", &pair.model), ("--effort", &pair.effort)] {
            if let Some(value) = value {
                argv.push(flag.into());
                argv.push(value.clone());
            }
        }
        self.retained_inboxes
            .lock()
            .expect("retained inboxes")
            .remove(&id.to_string());
        let socket = self.socket_path(id);
        match std::fs::remove_file(&socket) {
            Err(err) if err.kind() != ErrorKind::NotFound => return Err(RpcError::internal(err)),
            _ => {}
        }
        argv.push("--messaging-socket-path".into());
        argv.push(socket.to_string_lossy().into_owned());
        if pair.yolo {
            self.modes
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .remove(&id.to_string());
            argv.extend(["--permission-mode", "bypassPermissions"].map(String::from));
        } else {
            // A note names the same selected or inherited mode as this launch.
            let mode = match pair.permission_mode {
                Some(mode) => {
                    let mode = super::super::models::permission_mode(mode);
                    argv.extend(["--permission-mode".into(), mode.into()]);
                    mode.to_owned()
                }
                None => super::super::inbox::default_mode(&self.conversation_dir, &project),
            };
            self.modes
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .insert(
                    id.to_string(),
                    super::super::models::LaunchMode {
                        effective: mode,
                        selected: pair.permission_mode,
                    },
                );
        }
        if pair.yolo {
            argv.push("--dangerously-skip-permissions".into());
        }
        if let Some(conversation_id) = resume {
            argv.push("--resume".into());
            argv.push(conversation_id.to_owned());
            argv.extend(self.fork_session.then(|| "--fork-session".to_owned()));
        }
        Ok(argv)
    }
}
