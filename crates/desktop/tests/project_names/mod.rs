//! Project-name persistence, validation and captured-write conflicts through the App seam.
use super::*;

#[test]
fn s10_a_rename_is_trimmed_listed_and_restored_and_an_empty_name_removes_it() {
    let fx = Fixture::new(SERVE_AND_WAIT);
    fx.serve_real_daemon();
    let path = fx.project.display().to_string();
    {
        let (_app, webview) = app(fx.config.clone(), None);
        open(&webview, &fx.project);

        let renamed = invoke(
            &webview,
            "rename_project",
            json!({ "path": path, "name": "  api  " }),
        );

        assert_eq!(renamed, Ok(json!({ "name": "api", "path": path })));
        assert_eq!(
            invoke(&webview, "projects", json!({})),
            Ok(json!([project_json(&fx.project, "api", true)]))
        );
    }
    let (_app, webview) = app(fx.config.clone(), None);
    assert_eq!(open(&webview, &fx.project)["name"], "api");

    let cleared = invoke(
        &webview,
        "rename_project",
        json!({ "path": path, "name": "   " }),
    );

    assert_eq!(cleared, Ok(json!({ "name": "my-project", "path": path })));
}

#[test]
fn s10_a_name_over_forty_characters_or_with_a_line_break_is_invalid_params() {
    let fx = Fixture::new(SERVE_AND_WAIT);
    fx.serve_real_daemon();
    let (_app, webview) = app(fx.config.clone(), None);
    open(&webview, &fx.project);
    let path = fx.project.display().to_string();

    let forty = invoke(
        &webview,
        "rename_project",
        json!({ "path": path, "name": "x".repeat(40) }),
    );
    let long = invoke(
        &webview,
        "rename_project",
        json!({ "path": path, "name": "x".repeat(41) }),
    )
    .unwrap_err();
    let broken = invoke(
        &webview,
        "rename_project",
        json!({ "path": path, "name": "a\nb" }),
    )
    .unwrap_err();

    assert!(forty.is_ok());
    for error in [long, broken] {
        assert_eq!(error["code"], code::INVALID_PARAMS);
        assert!(error["message"].as_str().unwrap().contains("40"));
    }
}

#[test]
fn s10_a_failed_write_of_the_names_never_fails_the_call() {
    let fx = Fixture::new(SERVE_AND_WAIT);
    fx.serve_real_daemon();
    std::fs::write(
        fx.dir.path().join("data"),
        "a file where the folder should be",
    )
    .unwrap();
    let (_app, webview) = app(fx.config.clone(), None);

    let opened = open(&webview, &fx.project);
    let renamed = invoke(
        &webview,
        "rename_project",
        json!({ "path": fx.project.display().to_string(), "name": "still works" }),
    );

    assert_eq!(opened["name"], "my-project");
    assert_eq!(renamed.unwrap()["name"], "still works");
}

#[test]
fn u2773c_header_external_change_keeps_original() {
    let fx = Fixture::new(SERVE_AND_WAIT);
    fx.serve_real_daemon();
    let (_app, webview) = app(fx.config.clone(), None);
    let path = fx.project.display().to_string();
    let captured = open(&webview, &fx.project)["name"].clone();
    let rename = |name: &str, base: Value| {
        invoke(
            &webview,
            "rename_project",
            json!({ "path": path, "name": name, "base": base }),
        )
    };
    assert!(rename("B", Value::Null).is_ok());
    assert_eq!(
        rename(" exact 雪 ", captured).unwrap_err()["code"],
        code::CONFLICT
    );
    assert_eq!(
        invoke(&webview, "projects", json!({})),
        Ok(json!([project_json(&fx.project, "B", true)]))
    );
}

#[test]
fn u2773c_header_unavailable_original_never_substitutes_same_named_project() {
    let fx = Fixture::new(SERVE_AND_WAIT);
    fx.serve_real_daemon();
    let (_app, webview) = app(fx.config.clone(), None);
    let path = fx.project.display().to_string();
    open(&webview, &fx.project);
    let other = fx.second_project("other-project");
    fx.serve_real_daemon_named("other-project");
    open(&webview, &other);
    invoke(
        &webview,
        "rename_project",
        json!({"path": other, "name": "my-project"}),
    )
    .unwrap();
    invoke(&webview, "close_project", json!({"path": path})).unwrap();
    assert_eq!(
        invoke(
            &webview,
            "rename_project",
            json!({"path": path, "name": "unavailable", "base": "my-project"})
        )
        .unwrap_err()["code"],
        code::CONFLICT
    );
    assert_eq!(
        invoke(&webview, "projects", json!({})),
        Ok(json!([project_json(&other, "my-project", true)]))
    );
}

#[test]
fn u2773c_header_unchanged_base_keeps_name_rules() {
    let fx = Fixture::new(SERVE_AND_WAIT);
    fx.serve_real_daemon();
    let (_app, webview) = app(fx.config.clone(), None);
    let path = fx.project.display().to_string();
    open(&webview, &fx.project);
    for (name, expected) in [(" C ", "C"), ("  ", "my-project")] {
        let current = invoke(&webview, "projects", json!({})).unwrap()[0]["name"].clone();
        let result = invoke(
            &webview,
            "rename_project",
            json!({"path": path, "name": name, "base": current}),
        );
        assert_eq!(result.unwrap()["name"], expected);
        assert_eq!(
            invoke(&webview, "projects", json!({})),
            Ok(json!([project_json(&fx.project, expected, true)]))
        );
    }
}

#[test]
fn u2773c_header_overlapping_captured_writes_accept_only_one() {
    let fx = Fixture::new(SERVE_AND_WAIT);
    fx.serve_real_daemon();
    let (app, webview) = app(fx.config.clone(), None);
    open(&webview, &fx.project);
    let path = fx.project.display().to_string();
    let state = app.state::<AppState>();
    let barrier = std::sync::Barrier::new(8);
    let replies = std::thread::scope(|scope| {
        let calls: Vec<_> = (0..8)
            .map(|i| {
                let barrier = &barrier;
                let state = &state;
                let path = &path;
                scope.spawn(move || {
                    barrier.wait();
                    state.rename_project(path, &format!("name-{i}"), Some("my-project"))
                })
            })
            .collect();
        calls
            .into_iter()
            .map(|call| call.join().unwrap())
            .collect::<Vec<_>>()
    });
    let accepted: Vec<_> = replies
        .iter()
        .filter_map(|reply| reply.as_ref().ok())
        .collect();
    assert_eq!(accepted.len(), 1);
    assert_eq!(
        replies
            .iter()
            .filter(|reply| reply
                .as_ref()
                .is_err_and(|error| error.code == code::CONFLICT))
            .count(),
        7
    );
    assert_eq!(
        invoke(&webview, "projects", json!({})),
        Ok(json!([project_json(&fx.project, &accepted[0].name, true)]))
    );
}
