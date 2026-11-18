use super::*;
#[tokio::test]
async fn u7415a_export_writes_the_text_and_the_images_folder() {
    let rig = Rig::new();
    let a = agent("a");
    rig.call(&a, "pad.create", json!({"name": "notes", "text": "stored"}))
        .await
        .unwrap();
    let out = TempDir::new().unwrap();
    let target = out.path().join("notes.md");
    rig.ok(
        &a,
        "pad.export",
        json!({"name": "notes", "path": target, "text": "![Diagram 1](notes/diagram-1.svg)",
               "images": [{"name": "diagram-1.svg", "svg": "<svg/>"}]}),
    )
    .await;
    assert_eq!(
        std::fs::read_to_string(&target).unwrap(),
        "![Diagram 1](notes/diagram-1.svg)"
    );
    assert_eq!(
        std::fs::read_to_string(out.path().join("notes").join("diagram-1.svg")).unwrap(),
        "<svg/>"
    );
}

#[tokio::test]
async fn u7415c_export_rejects_an_image_name_that_leaves_the_folder() {
    let rig = Rig::new();
    let a = agent("a");
    rig.call(&a, "pad.create", json!({"name": "notes", "text": "stored"}))
        .await
        .unwrap();
    let out = TempDir::new().unwrap();
    let target = out.path().join("notes.md");
    for name in ["../x.svg", "/abs/x.svg", "a/b.svg", "..", "x.png"] {
        let err = rig
            .call(
                &a,
                "pad.export",
                json!({"name": "notes", "path": target, "images": [{"name": name, "svg": "<svg/>"}]}),
            )
            .await
            .unwrap_err();
        assert_eq!(err.code, code::INVALID_PARAMS, "{name}");
    }
    assert_eq!(std::fs::read_dir(out.path()).unwrap().count(), 0);
}

#[tokio::test]
async fn u7415c_export_without_images_creates_no_folder() {
    let rig = Rig::new();
    let a = agent("a");
    rig.call(&a, "pad.create", json!({"name": "notes", "text": "stored"}))
        .await
        .unwrap();
    let out = TempDir::new().unwrap();
    let target = out.path().join("notes.md");
    rig.ok(
        &a,
        "pad.export",
        json!({"name": "notes", "path": target, "images": []}),
    )
    .await;
    assert_eq!(std::fs::read_to_string(&target).unwrap(), "stored");
    assert_eq!(std::fs::read_dir(out.path()).unwrap().count(), 1);
}

#[tokio::test]
async fn p6_export_writes_one_file_and_never_creates_directories() {
    let rig = Rig::new();
    let a = agent("a");
    rig.call(&a, "pad.create", json!({"name": "notes", "text": "hello"}))
        .await
        .unwrap();
    let out = TempDir::new().unwrap();

    let target = out.path().join("notes.md");
    rig.call(&a, "pad.export", json!({"name": "notes", "path": target}))
        .await
        .unwrap();
    assert_eq!(std::fs::read_to_string(&target).unwrap(), "hello");
    rig.ok(&a, "pad.setStorage", json!({"files": true})).await;
    let in_files_mode = out.path().join("files-mode.md");
    rig.ok(
        &a,
        "pad.export",
        json!({"name": "notes", "path": in_files_mode}),
    )
    .await;
    assert_eq!(std::fs::read_to_string(&in_files_mode).unwrap(), "hello");

    let missing_dir = out.path().join("nope").join("notes.md");
    let err = rig
        .call(
            &a,
            "pad.export",
            json!({"name": "notes", "path": missing_dir}),
        )
        .await
        .unwrap_err();
    assert_eq!(err.code, code::INVALID_PARAMS);
    assert!(!out.path().join("nope").exists());
}
