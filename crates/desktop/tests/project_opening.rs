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
