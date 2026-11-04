//! Canonical Project identity through the native App seam.
use super::*;

#[test]
fn a5765c_project_identity_resolves_aliases_without_opening() {
    let fx = Fixture::new(SERVE_AND_WAIT);
    let (_app, webview) = app(fx.config.clone(), None);
    let alias = fx.dir.path().join("project-alias");
    std::os::unix::fs::symlink(&fx.project, &alias).unwrap();
    let resolved = invoke(&webview, "canonical_project_path", path_arg(&alias)).unwrap();
    assert_eq!(
        resolved,
        fx.project.canonicalize().unwrap().display().to_string()
    );
    assert_eq!(invoke(&webview, "projects", json!({})).unwrap(), json!([]));
}

#[test]
fn s8_opening_a_path_whose_daemon_runs_returns_it_and_starts_nothing() {
    let fx = Fixture::new(TWO_DAEMONS);
    fx.serve_real_daemon_named("my-project");
    let (_app, webview) = app(fx.config.clone(), None);
    let first = open(&webview, &fx.project);

    let again = open(&webview, &fx.project);

    assert_eq!(again, first);
    assert_eq!(fx.file("sockets").lines().count(), 1);
}

#[test]
fn s6123b_refused_project_first_line_holds_the_refusal() {
    let dir = tempfile::tempdir().unwrap();
    let project = dir.path().join("project");
    // A `.roundup/agents` folder is data this rupd refuses (S5810a).
    std::fs::create_dir_all(project.join(".roundup/agents")).unwrap();
    let mut config = desktop::Config::locate(
        Some(real_rupd().into_os_string()),
        Path::new("/unused/roundup"),
        dir.path(),
        std::process::id(),
    )
    .unwrap();
    config.data_dir = Some(dir.path().join("data"));
    let (_app, webview) = app(config, None);

    let error = invoke(&webview, "open_project", path_arg(&project)).unwrap_err();

    let first = error["message"]
        .as_str()
        .unwrap()
        .lines()
        .next()
        .unwrap()
        .to_owned();
    assert!(
        first.contains("Local data is incompatible with this build."),
        "{first}"
    );
}

fn real_rupd() -> PathBuf {
    let exe = std::env::current_exe().unwrap();
    let rupd = exe.parent().unwrap().parent().unwrap().join("rupd");
    assert!(rupd.is_file(), "build rupd before this observer");
    rupd
}
