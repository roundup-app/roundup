//! PG1, PG3: the Project program's entry and stop, kept in the Project's settings.
use super::*;

impl Agents {
    pub fn project_program(&self) -> Result<Option<contracts::project::ProjectProgram>, RpcError> {
        Ok(self.shared.rail().get_program()?)
    }

    /// `None` clears the entry and any stop.
    pub fn store_project_program(&self, program: Option<&contracts::project::ProjectProgram>) -> Result<(), RpcError> {
        Ok(self.shared.rail().set_program(program)?)
    }

    pub fn project_program_stopped(&self) -> Result<bool, RpcError> {
        Ok(self.shared.rail().program_stopped()?)
    }

    pub fn store_project_program_stopped(&self, stopped: bool) -> Result<(), RpcError> {
        Ok(self.shared.rail().set_program_stopped(stopped)?)
    }

    /// A43: the directory of `rup`, which an Agent's `PATH` starts with.
    pub fn rup_dir(&self) -> Option<PathBuf> {
        self.launcher.rup_dir()
    }

    /// FOP5978b: a Fork attaches no Terminal owner and starts no program.
    pub fn is_fork(&self) -> bool {
        self.forked
    }

    /// The Project's path: `.roundup/`'s parent.
    pub fn project_path(&self) -> &std::path::Path {
        self.project_dir()
    }
}
