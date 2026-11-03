//! Native Project identity and repeated opening through the App seam.
use super::*;

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
