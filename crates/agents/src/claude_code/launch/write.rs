//! Prepare an Agent launch: check the request, read what the plan needs, make the plan and write
//! it. The decisions are `plan`'s; this shell only touches the disk.
#![deny(clippy::fn_params_excessive_bools, clippy::too_many_lines)]

use super::plan::{self, Facts, Plan, Spec};
use super::*;

/// A request whose folders exist and hold together.
struct Checked {
    id: u64,
    cwd: PathBuf,
    project: PathBuf,
    paths: Paths,
}

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
        self.prepare_on(&Request {
            folders,
            id,
            attempt,
            cwd,
            resume,
            role,
            facts: &LaunchFacts::default(),
        })
    }

    /// Like `prepare`, on `request.facts` (A36): `--model` and `--effort` for each value that is set.
    pub fn prepare_on(&self, request: &Request<'_>) -> Result<Vec<String>, RpcError> {
        let checked = self.check(request)?;
        let lean = lean_of(request.role, request.facts);
        let role = match (&lean, request.role) {
            (Some(lean), Role::Agent) if lean.scout => Role::Scout,
            _ => request.role,
        };
        if role == Role::Door {
            write_shims(&checked.paths.shims).map_err(RpcError::internal)?;
        }
        let facts = self.read_facts(request, &checked, role, lean.is_some())?;
        let spec = Spec {
            launcher: self,
            id: checked.id,
            attempt: request.attempt,
            role,
            lean,
            resume: request.resume,
            facts: request.facts,
            paths: &checked.paths,
        };
        let plan = plan::plan(&spec, facts)?;
        self.write(&plan, &checked)?;
        Ok(plan.argv)
    }

    fn check(&self, request: &Request<'_>) -> Result<Checked, RpcError> {
        let invalid = |message: String| RpcError::new(code::INVALID_PARAMS, message);
        let Folders { project, data: dir } = request.folders;
        let id = parse_id(request.id)
            .ok_or_else(|| invalid(format!("{:?} is not a node id", request.id)))?;
        let cwd = request
            .cwd
            .canonicalize()
            .map_err(|err| invalid(format!("cwd {} is unusable: {err}", request.cwd.display())))?;
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
        let paths = Paths::new(&dir, id);
        for folder in [&paths.agents, &paths.shims] {
            if is_symlink(folder) {
                return Err(invalid(format!("{} is a symlink", folder.display())));
            }
        }
        Ok(Checked {
            id,
            cwd,
            project,
            paths,
        })
    }

    /// Everything the plan reads from the disk and the environment.
    fn read_facts(
        &self,
        request: &Request<'_>,
        checked: &Checked,
        role: Role,
        lean: bool,
    ) -> Result<Facts, RpcError> {
        let Checked {
            id,
            cwd,
            project,
            paths,
        } = checked;
        let delivery = match &request.facts.lean {
            Some(lean) => extras::resolve(&self.extras_sources(project), &lean.extras)?,
            None => extras::Delivery::default(),
        };
        let mut carried =
            user_settings(&self.conversation_dir, project).map_err(RpcError::internal)?;
        let missing_intent = self.door_lacks_intent(role, &carried, project);
        if carried.get("outputStyle").is_none() {
            carried["outputStyle"] = json!("hold:Plain");
        }
        let mut guard = json!({ "hooks": { "PreToolUse": [] } });
        super::super::memory::hook(
            &self.rup,
            &self.conversation_dir,
            self.home.as_deref(),
            cwd,
            role,
            &carried,
            &mut guard,
        )?;
        let instructions = if lean || role == Role::Door {
            std::iter::once(project)
                .chain((cwd != project).then_some(cwd))
                .filter_map(|folder| std::fs::read_to_string(folder.join("CLAUDE.md")).ok())
                .collect()
        } else {
            Vec::new()
        };
        let inherited_mode = match request.facts.permission {
            Permission::Inherit => {
                super::super::inbox::default_mode(&self.conversation_dir, project)
            }
            _ => String::new(),
        };
        Ok(Facts {
            carried,
            missing_intent,
            delivery,
            memory_hooks: guard["hooks"]["PreToolUse"]
                .as_array()
                .cloned()
                .unwrap_or_default(),
            path: self.shell_path((role == Role::Door).then_some(paths.shims.as_path())),
            instructions,
            global_instructions: self.global_instructions(),
            inherited_mode,
            socket: self.socket_dir().join(format!("{id}.sock")),
        })
    }

    /// Put the plan on disk, then in the Launcher's notes.
    fn write(&self, plan: &Plan, checked: &Checked) -> Result<(), RpcError> {
        let Checked { id, cwd, paths, .. } = checked;
        replace_file(&paths.settings, &plan.settings).map_err(RpcError::internal)?;
        match &plan.mcp_config {
            Some(config) => replace_file(&paths.mcp_config, config).map_err(RpcError::internal)?,
            None if is_symlink(&paths.mcp_config) => {
                return Err(RpcError::new(
                    code::INVALID_PARAMS,
                    format!("{} is a symlink", paths.mcp_config.display()),
                ));
            }
            // An earlier launch with MCP on left its config; the Agent must not find it.
            None => remove_if_present(&paths.mcp_config)?,
        }
        replace_text(&paths.brief, &plan.brief).map_err(RpcError::internal)?;
        self.trust(cwd)?;
        if !plan.skills.is_empty() {
            extras::skill_plugin(&paths.extras, &plan.skills)?;
        }
        self.retained_inboxes
            .lock()
            .expect("retained inboxes")
            .remove(&id.to_string());
        remove_if_present(&plan.socket)?;
        let mut modes = self.modes.lock().unwrap_or_else(PoisonError::into_inner);
        match &plan.mode {
            Some(mode) => modes.insert(id.to_string(), mode.clone()),
            None => modes.remove(&id.to_string()),
        };
        Ok(())
    }
}

fn remove_if_present(file: &Path) -> Result<(), RpcError> {
    match std::fs::remove_file(file) {
        Err(err) if err.kind() != ErrorKind::NotFound => Err(RpcError::internal(err)),
        _ => Ok(()),
    }
}
