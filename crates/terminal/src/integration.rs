//! X15: the environment that makes a shell the user opens print shell marks (OSC 133 and OSC 7).
//! Nothing of the user's is edited: zsh, bash and fish are pointed at Daemon-written files that
//! read the user's own startup files first.

use std::collections::BTreeMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

const ZSHENV: &str = include_str!("integration/zshenv");
const ZPROFILE: &str = include_str!("integration/zprofile");
const ZSHRC: &str = include_str!("integration/zshrc");
const BASHRC: &str = include_str!("integration/bashrc");
const FISH: &str = include_str!("integration/roundup.fish");

/// How a shell starts: its arguments and the environment it gains.
pub struct Start {
    pub args: Vec<String>,
    pub env: BTreeMap<String, String>,
}

/// The start for `shell` (a path), writing the files it needs under `root` (mode `0700`,
/// rewritten each time). A shell that is not zsh, bash or fish starts as `-l` with no change.
pub fn start(root: &Path, shell: &str, user: &BTreeMap<String, String>) -> io::Result<Start> {
    let var = |name: &str| {
        user.get(name)
            .cloned()
            .or_else(|| std::env::var(name).ok())
            .filter(|value| !value.is_empty())
    };
    let name = Path::new(shell).file_name().and_then(|n| n.to_str());
    let mut env = user.clone();
    let args = match name {
        Some("zsh") => {
            let dir = private(root, "zsh")?;
            for (file, text) in [
                (".zshenv", ZSHENV),
                (".zprofile", ZPROFILE),
                (".zshrc", ZSHRC),
            ] {
                fs::write(dir.join(file), text)?;
            }
            let user = var("ZDOTDIR").or_else(|| var("HOME")).unwrap_or_default();
            env.insert("ROUNDUP_USER_ZDOTDIR".into(), user);
            env.insert("ZDOTDIR".into(), dir.to_string_lossy().into_owned());
            vec!["-l".to_owned()]
        }
        Some("bash") => {
            let dir = private(root, "bash")?;
            let rc = dir.join("bashrc");
            fs::write(&rc, BASHRC)?;
            // `--rcfile` is read by an interactive shell that is not a login one; the file reads
            // the login files itself.
            vec!["--rcfile".to_owned(), rc.to_string_lossy().into_owned()]
        }
        Some("fish") => {
            let dir = private(root, "fish")?;
            let conf = dir.join("fish").join("vendor_conf.d");
            fs::create_dir_all(&conf)?;
            fs::write(conf.join("roundup.fish"), FISH)?;
            let rest = var("XDG_DATA_DIRS").unwrap_or_else(|| "/usr/local/share:/usr/share".into());
            env.insert(
                "XDG_DATA_DIRS".into(),
                format!("{}:{rest}", dir.to_string_lossy()),
            );
            vec!["-l".to_owned()]
        }
        _ => vec!["-l".to_owned()],
    };
    Ok(Start { args, env })
}

fn private(root: &Path, name: &str) -> io::Result<PathBuf> {
    let dir = root.join(name);
    fs::create_dir_all(&dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        for path in [root, dir.as_path()] {
            fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
        }
    }
    Ok(dir)
}
