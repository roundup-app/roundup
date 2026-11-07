//! The launch seam: a process-free command and the production launch.
#![deny(clippy::fn_params_excessive_bools)]

use super::*;

impl Launcher {
    /// A3507a: process-free Agent launch construction, shared by starts and resumes.
    pub fn command_on(&self, request: &Request<'_>) -> Result<std::process::Command, RpcError> {
        let Request {
            id,
            cwd,
            role,
            facts: pair,
            ..
        } = *request;
        let argv = self.prepare_on(request)?;
        let mut command = std::process::Command::new(&argv[0]);
        command.args(&argv[1..]).current_dir(cwd).envs(pair.env());
        let settings: Value =
            serde_json::from_slice(&std::fs::read(&argv[2]).map_err(RpcError::internal)?)
                .map_err(RpcError::internal)?;
        for key in [
            "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS",
            "CLAUDE_CODE_PLUGIN_DIR_WATCH",
        ] {
            if !self.user_defaults.contains(key)
                && let Some(value) = settings["env"][key].as_str()
            {
                command.env(key, value);
            }
        }
        for marker in super::super::MARKERS {
            command.env_remove(marker);
        }
        if lean_of(role, pair).is_some() {
            command.env("CLAUDE_CODE_DISABLE_CLAUDE_MDS", "1");
        }
        command.env("ROUNDUP_AGENT", id);
        if let Some(dir) = self.rup.parent().filter(|dir| dir.is_absolute()) {
            let inherited = std::env::var_os("PATH").unwrap_or_default();
            let paths = std::iter::once(dir.to_path_buf()).chain(std::env::split_paths(&inherited));
            if let Ok(path) = std::env::join_paths(paths) {
                command.env("PATH", path);
            }
        }
        Ok(command)
    }

    /// Q11: the production launch seam. Keep this Launcher alive while its Agents run:
    /// it owns their complete bundle. Initial launch, resume and clear use this same seam.
    /// Probe the selected executable once; validate the pinned files before every launch.
    pub async fn launch_on(
        &self,
        request: &Request<'_>,
    ) -> Result<(Vec<String>, BTreeMap<String, String>), RpcError> {
        let Request {
            folders,
            id,
            attempt,
            cwd,
            resume,
            role,
            facts: pair,
        } = *request;
        let (launcher, project, data, id, attempt, cwd, resume, pair) = (
            self.clone(),
            folders.project.to_owned(),
            folders.data.to_owned(),
            id.to_owned(),
            attempt.to_owned(),
            cwd.to_owned(),
            resume.map(str::to_owned),
            pair.clone(),
        );
        let lean = lean_of(role, &pair);
        let (resume_given, id_text) = (resume.is_some(), id.clone());
        let bundled = match &lean {
            None => profile(Role::Agent).bundled_plugins,
            Some(lean) => profile(if lean.scout { Role::Scout } else { role }).bundled_plugins,
        };
        let command = tokio::task::spawn_blocking(move || {
            launcher.command_on(&Request {
                folders: Folders {
                    project: &project,
                    data: &data,
                },
                id: &id,
                attempt: &attempt,
                cwd: &cwd,
                resume: resume.as_deref(),
                role,
                facts: &pair,
            })
        })
        .await
        .map_err(RpcError::internal)??;
        let mut argv = std::iter::once(command.get_program())
            .chain(command.get_args())
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        let mut env: BTreeMap<String, String> = command
            .get_envs()
            .filter_map(|(key, value)| {
                Some((
                    key.to_string_lossy().into_owned(),
                    value?.to_string_lossy().into_owned(),
                ))
            })
            .collect();
        let data = folders.data.canonicalize().map_err(RpcError::internal)?;
        let delivery = self
            .plugins
            .get_or_try_init(|| async {
                let dir = data.clone();
                let plugins = tokio::task::spawn_blocking(move || plugins::materialize(&dir))
                    .await
                    .map_err(RpcError::internal)?
                    .map_err(RpcError::internal)?;
                let executable = self.executable()?;
                let runtime = plugins
                    .runtime(&executable)
                    .await
                    .map_err(RpcError::internal)?;
                Ok::<_, RpcError>(Delivery {
                    data: data.clone(),
                    plugins,
                    runtime,
                })
            })
            .await?;
        if delivery.data != data {
            return Err(RpcError::internal(
                "Q11 Launcher belongs to another Project data directory",
            ));
        }
        let command = delivery
            .runtime
            .command(&delivery.plugins)
            .map_err(RpcError::internal)?;
        let command = command.as_std();
        argv[0] = command.get_program().to_string_lossy().into_owned();
        let settings: Value =
            serde_json::from_slice(&std::fs::read(&argv[2]).map_err(RpcError::internal)?)
                .map_err(RpcError::internal)?;
        let missing_intent = self.door_lacks_intent(role, &settings, folders.project);
        // LC5: a user's enabled install takes precedence over the bundled plugin of the same name.
        let args: Vec<_> = command.get_args().collect();
        for pair in args.chunks(2) {
            let named = Path::new(pair[1]).file_name().and_then(OsStr::to_str);
            if named.is_some_and(|name| {
                bundled.contains(&name)
                    && enabled_plugin(&settings, name).is_none()
                    && !(name == "hope" && missing_intent)
            }) {
                argv.extend(pair.iter().map(|arg| arg.to_string_lossy().into_owned()));
            }
        }
        for (key, value) in command.get_envs() {
            let key = key.to_string_lossy();
            if !self.user_defaults.contains(key.as_ref())
                && let Some(value) = value
            {
                env.entry(key.into_owned())
                    .or_insert_with(|| value.to_string_lossy().into_owned());
            }
        }
        // LC8: the changed Brief has applied once.
        if let Some(mut lean) = lean.filter(|lean| lean.fresh_brief && resume_given) {
            lean.fresh_brief = false;
            Self::save_lean(folders.data, &id_text, &lean)?;
        }
        Ok((argv, env))
    }

    pub(super) fn executable(&self) -> Result<PathBuf, RpcError> {
        let path = Path::new(&self.bin);
        if path.components().count() > 1 || path.is_absolute() {
            return Ok(path.to_owned());
        }
        std::env::var_os("PATH")
            .and_then(|paths| {
                std::env::split_paths(&paths)
                    .map(|dir| dir.join(path))
                    .find(|path| {
                        std::fs::metadata(path).is_ok_and(|meta| {
                            meta.is_file() && meta.permissions().mode() & 0o111 != 0
                        })
                    })
            })
            .ok_or_else(|| {
                RpcError::internal(format!(
                    "Q11 Claude executable {} not found on PATH",
                    self.bin
                ))
            })
    }
}
