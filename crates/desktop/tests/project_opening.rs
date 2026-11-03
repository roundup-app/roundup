//! Native Project identity and repeated opening through the App seam.
use super::*;

#[test]
fn a5765c_opening_an_alias_returns_the_canonical_project_and_starts_nothing() {
    let fx = Fixture::new(TWO_DAEMONS);
    fx.serve_real_daemon_named("my-project");
    let (_app, webview) = app(fx.config.clone(), None);
    let alias = fx.dir.path().join("project-alias");
    std::os::unix::fs::symlink(&fx.project, &alias).unwrap();
    let first = open(&webview, &alias);
    assert_eq!(first["path"], fx.project.canonicalize().unwrap().display().to_string());

    let again = open(&webview, &fx.project);

    assert_eq!(again, first);
    let listed = invoke(&webview, "projects", json!({})).unwrap();
    assert_eq!(listed.as_array().unwrap().len(), 1);
    assert_eq!(listed[0]["path"], first["path"]);
    assert_eq!(fx.file("sockets").lines().count(), 1);
}
