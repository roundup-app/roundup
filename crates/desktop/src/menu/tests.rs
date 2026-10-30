use super::*;
use tauri::test::mock_app;

fn item(id: &str, label: &str, shortcut: Option<&str>, children: Option<Vec<Item>>) -> Item {
    Item {
        id: id.to_owned(),
        label: label.to_owned(),
        shortcut: shortcut.map(str::to_owned),
        group: Some(
            if id.starts_with("view:") {
                "views"
            } else if id.starts_with("action:chord:") && id != "action:chord:⌘/" {
                "create"
            } else {
                "navigate"
            }
            .to_owned(),
        ),
        enabled: true,
        children,
    }
}

fn plain<R: Runtime>(built: MenuItemKind<R>) -> MenuItem<R> {
    match built {
        MenuItemKind::MenuItem(plain) => plain,
        _ => panic!("expected a plain item"),
    }
}

#[test]
fn u4322b_items_carry_native_accelerators() {
    let app = mock_app();
    for (chord, accelerator) in [
        (Some("F2"), Some("F2")),
        (Some("⌘⌫"), Some("Super+Backspace")),
        (None, None),
    ] {
        let built = kind(
            app.handle(),
            &item("action", "Rename", chord, None),
            |app, id, label, enabled, supplied| {
                assert_eq!(supplied, accelerator);
                MenuItem::with_id(app, id, label, enabled, supplied)
            },
        )
        .unwrap();
        let leaf = plain(built);
        assert_eq!(leaf.text().unwrap(), "Rename");
        assert_eq!(leaf.id().0, "action");
    }
}

#[test]
fn u4322b_native_groups_and_submenus_reach_the_menu() {
    let app = mock_app();
    let menu = Menu::new(app.handle()).unwrap();
    let mut rename = item("rename", "Rename", Some("F2"), None);
    rename.group = Some("edit".into());
    let mut remove = item("remove", "Remove", Some("⌘⌫"), None);
    remove.group = Some("remove".into());
    let mut hidden = item("hidden", "Hidden", None, None);
    hidden.enabled = false;
    hidden.group = Some("omitted".into());
    append(
        app.handle(),
        &menu,
        &[
            rename,
            hidden,
            item("empty", "Empty", None, Some(vec![])),
            remove,
            item(
                "add",
                "Add",
                None,
                Some(vec![
                    item("child", "Pad", None, None),
                    Item {
                        enabled: false,
                        ..item("unavailable-child", "Unavailable", None, None)
                    },
                ]),
            ),
        ],
    )
    .unwrap();
    let built = menu.items().unwrap();
    assert_eq!(built.len(), 5);
    assert_eq!(plain(built[0].clone()).id().0, "rename");
    assert!(matches!(built[1], MenuItemKind::Predefined(_)));
    assert_eq!(plain(built[2].clone()).id().0, "remove");
    assert!(matches!(built[3], MenuItemKind::Predefined(_)));
    let MenuItemKind::Submenu(sub) = &built[4] else {
        panic!("submenu missing")
    };
    assert_eq!(sub.items().unwrap().len(), 1);
    assert_eq!(plain(sub.items().unwrap()[0].clone()).id().0, "child");
}

#[test]
fn u4322b_sequences_remain_hints() {
    let app = mock_app();
    let action = item("close", "Close", Some("⌘K W"), None);
    let (entry, hint) = project_kind(
        app.handle(),
        &action,
        |app, id, label, enabled, accelerator| {
            assert_eq!(accelerator, None);
            MenuItem::with_id(app, id, label, enabled, accelerator)
        },
    )
    .unwrap();
    assert_eq!(plain(entry).text().unwrap(), "Close");
    assert_eq!(hint, [(vec![], "⌘K W".into())]);
    assert_eq!(sequence_hints(&[action]), [("Close".into(), "⌘K W".into())]);
}

#[test]
fn u4322b_popup_accelerators_stay_in_the_popup() {
    use tauri::test::{mock_builder, mock_context, noop_assets};
    let app = mock_builder()
        .menu(app_menu)
        .build(mock_context(noop_assets()))
        .unwrap();
    let popup = Menu::new(app.handle()).unwrap();
    append(
        app.handle(),
        &popup,
        &[item("popup-rename", "Rename", Some("F2"), None)],
    )
    .unwrap();
    assert!(popup.get("popup-rename").is_some());
    assert!(app.menu().unwrap().get("popup-rename").is_none());
    drop(popup);
    assert!(app.menu().unwrap().get("popup-rename").is_none());
}

#[test]
fn u3787a_edit_menu_tracks_focused_history() {
    use std::sync::Arc;
    use tauri::Listener;
    use tauri::test::{mock_builder, mock_context, noop_assets};
    let app = mock_builder()
        .manage(ProjectMenu::default())
        .menu(app_menu)
        .build(mock_context(noop_assets()))
        .unwrap();
    let received = Arc::new(Mutex::new(Vec::new()));
    let observed = Arc::clone(&received);
    app.listen("open-project-page", move |event| {
        observed
            .lock()
            .unwrap()
            .push(serde_json::from_str::<serde_json::Value>(event.payload()).unwrap());
    });
    for (label, enabled, redo_label, redo_enabled) in [
        ("Undo Delete Todo", true, "Redo", false),
        ("Undo", false, "Redo Delete Todo", true),
        ("Undo", false, "Redo", false),
    ] {
        let mut undo = item("action:chord:⌘Z", label, Some("⌘Z"), None);
        undo.group = Some("edit".into());
        undo.enabled = enabled;
        let mut redo = item("action:chord:⇧⌘Z", redo_label, Some("⇧⌘Z"), None);
        redo.group = Some("edit".into());
        redo.enabled = redo_enabled;
        select_project_menu(
            app.handle().clone(),
            Some("/A".into()),
            Some(vec![undo, redo]),
        )
        .unwrap();
        let MenuItemKind::Submenu(edit) = app.menu().unwrap().get("edit-menu").unwrap() else {
            panic!("Edit menu")
        };
        let undo = plain(edit.get("action:chord:⌘Z").unwrap());
        assert_eq!(undo.text().unwrap(), label);
        assert_eq!(undo.is_enabled().unwrap(), enabled);
        let redo = plain(edit.get("action:chord:⇧⌘Z").unwrap());
        assert_eq!(redo.text().unwrap(), redo_label);
        assert_eq!(redo.is_enabled().unwrap(), redo_enabled);
        for command in ["action:chord:⌘Z", "action:chord:⇧⌘Z"] {
            app_chosen(app.handle(), &MenuEvent { id: command.into() });
        }
    }
    assert_eq!(
        *received.lock().unwrap(),
        [
            serde_json::json!({"path":"/A", "command":"action:chord:⌘Z"}),
            serde_json::json!({"path":"/A", "command":"action:chord:⇧⌘Z"}),
        ]
    );
    select_project_menu(app.handle().clone(), Some("/A".into()), None).unwrap();
    let MenuItemKind::Submenu(edit) = app.menu().unwrap().get("edit-menu").unwrap() else {
        panic!("Edit menu")
    };
    assert!(matches!(
        edit.items().unwrap()[0],
        MenuItemKind::Predefined(_)
    ));
    assert!(matches!(
        edit.items().unwrap()[1],
        MenuItemKind::Predefined(_)
    ));
}

#[test]
fn s_u3813_project_menu_tracks_the_selected_project() {
    use std::sync::Arc;
    use tauri::Listener;
    use tauri::test::{mock_builder, mock_context, noop_assets};
    let app = mock_builder()
        .manage(ProjectMenu::default())
        .menu(app_menu)
        .build(mock_context(noop_assets()))
        .unwrap();
    let menu = app.menu().unwrap();
    let project = menu
        .items()
        .unwrap()
        .into_iter()
        .find_map(|item| match item {
            MenuItemKind::Submenu(sub) if sub.text().unwrap() == "Project" => Some(sub),
            _ => None,
        })
        .expect("Project menu");
    let received = Arc::new(Mutex::new(Vec::new()));
    let observed = Arc::clone(&received);
    app.listen("open-project-page", move |event| {
        observed
            .lock()
            .unwrap()
            .push(serde_json::from_str::<serde_json::Value>(event.payload()).unwrap())
    });
    for path in [None, Some("/A"), Some("/B"), None] {
        select_project_menu(app.handle().clone(), path.map(str::to_owned), None).unwrap();
        let before = received.lock().unwrap().len();
        let items = project.items().unwrap();
        assert_eq!(items.len(), if path.is_some() { 2 } else { 0 });
        assert_eq!(project.is_enabled().unwrap(), path.is_some());
        for item in items.into_iter().map(plain) {
            assert!(item.is_enabled().unwrap());
            app_chosen(
                app.handle(),
                &MenuEvent {
                    id: item.id().clone(),
                },
            );
        }
        let replies = received.lock().unwrap();
        if let Some(path) = path {
            assert_eq!(
                &replies[before..],
                &[
                    serde_json::json!({"path": path, "command": "import-work"}),
                    serde_json::json!({"path": path, "command": "project-settings"}),
                ]
            );
        } else {
            assert_eq!(replies.len(), before);
        }
    }
}
#[test]
fn u4278a_native_separators_split_action_groups() {
    use tauri::test::{mock_builder, mock_context, noop_assets};
    let app = mock_builder()
        .manage(ProjectMenu::default())
        .menu(app_menu)
        .build(mock_context(noop_assets()))
        .unwrap();
    select_project_menu(
        app.handle().clone(),
        Some("/A".to_owned()),
        Some(vec![
            item("action:chord:⇧⌘T", "Capture a Todo", Some("⇧⌘T"), None),
            item("action:chord:⌘/", "Focus Ask", Some("⌘/"), None),
            item("action:leader:A", "Assign Todo", Some("⌘K A"), None),
            item("action:leader:S", "Open work items", Some("⌘K S"), None),
            item("view:notes", "Recover notes", None, None),
            item("action:leader:C", "Review changes", Some("⌘K C"), None),
            item("action:chord:⌘N", "New Agent", Some("⌘N"), None),
            item("action:chord:⌘T", "New Terminal", Some("⌘T"), None),
            item("action:leader:T", "Capture a Todo", Some("⌘K T"), None),
            item(
                "action:chord:⇧⌘N",
                "New Agent with a prompt",
                Some("⇧⌘N"),
                None,
            ),
            item("action:leader:P", "Switch Project", Some("⌘K P"), None),
            item(
                "action:leader:J",
                "Jump to what needs you",
                Some("⌘K J"),
                None,
            ),
            item("action:leader:I", "Open the Inbox", Some("⌘K I"), None),
            item("action:future", "A newly registered action", None, None),
            item("view:workstreams", "Open Workstreams", None, None),
        ]),
    )
    .unwrap();
    let MenuItemKind::Submenu(project) = app.menu().unwrap().get("project-menu").unwrap() else {
        panic!("Project submenu");
    };
    let ids: Vec<_> = project
        .items()
        .unwrap()
        .into_iter()
        .map(|entry| match entry {
            MenuItemKind::MenuItem(entry) => entry.id().0.clone(),
            MenuItemKind::Predefined(_) => "separator".to_owned(),
            _ => panic!("Unexpected submenu"),
        })
        .collect();
    assert_eq!(
        ids,
        [
            "action:chord:⇧⌘T",
            "action:chord:⌘N",
            "action:chord:⌘T",
            "action:chord:⇧⌘N",
            "separator",
            "action:chord:⌘/",
            "action:leader:A",
            "action:leader:S",
            "action:leader:C",
            "action:leader:T",
            "action:leader:P",
            "action:leader:J",
            "action:leader:I",
            "action:future",
            "separator",
            "view:notes",
            "view:workstreams",
            "separator",
            "import-work",
            "project-settings",
        ]
    );
}

#[test]
fn u4278b_one_step_items_carry_native_accelerators() {
    let app = mock_app();
    for (chord, expected) in [
        ("⌘N", "Super+N"),
        ("⌘T", "Super+T"),
        ("⇧⌘T", "Shift+Super+T"),
        ("⌃⇧Y", "Ctrl+Shift+Y"),
        ("⌘/", "Super+/"),
        ("⌥⏎", "Alt+Enter"),
        ("⌃↑", "Ctrl+ArrowUp"),
        ("⌘=", "Super+="),
        ("⌘-", "Super+-"),
        ("⌘0", "Super+0"),
    ] {
        let source = item(
            &format!("action:chord:{chord}"),
            "Run action",
            Some(chord),
            None,
        );
        let (built, hint) = project_kind(
            app.handle(),
            &source,
            |app, id, label, enabled, accelerator| {
                assert_eq!(accelerator, Some(expected));
                MenuItem::with_id(app, id, label, enabled, accelerator)
            },
        )
        .unwrap();
        assert_eq!(plain(built).text().unwrap(), source.label);
        assert!(hint.is_empty());
    }
}

#[test]
fn u3787b_numbered_submenu_keeps_each_target_and_hint() {
    let app = mock_app();
    let source = item(
        "assignment",
        "Assign to",
        None,
        Some(vec![
            item(
                "action:chord:1–9:Digit1",
                "Assign to same name",
                Some("1"),
                None,
            ),
            Item {
                enabled: false,
                ..item("unavailable", "Assign to hidden", Some("2"), None)
            },
            item(
                "action:chord:1–9:Digit9",
                "Assign to same name",
                Some("9"),
                None,
            ),
        ]),
    );
    let (entry, hints) = project_kind(
        app.handle(),
        &source,
        |app, id, label, enabled, accelerator| {
            assert_eq!(accelerator, None);
            MenuItem::with_id(app, id, label, enabled, accelerator)
        },
    )
    .unwrap();
    let MenuItemKind::Submenu(sub) = entry else {
        panic!("assignment submenu missing")
    };
    let ids: Vec<_> = sub
        .items()
        .unwrap()
        .into_iter()
        .map(|item| plain(item).id().0.clone())
        .collect();
    assert_eq!(ids, ["action:chord:1–9:Digit1", "action:chord:1–9:Digit9"]);
    assert_eq!(hints, [(vec![0], "1".into()), (vec![1], "9".into())]);
}

#[test]
fn u3787b_plain_key_commands_register_no_accelerator() {
    let app = mock_app();
    for key in [
        "D", "E", "M", "J K", "⇧Tab", "Tab", "1–9", "⏎", "F2", "?", "1", "9",
    ] {
        let source = item(
            &format!("action:chord:{key}"),
            "Run action",
            Some(key),
            None,
        );
        let (built, hint) = project_kind(
            app.handle(),
            &source,
            |app, id, label, enabled, accelerator| {
                assert_eq!(accelerator, None);
                MenuItem::with_id(app, id, label, enabled, accelerator)
            },
        )
        .unwrap();
        assert_eq!(plain(built).text().unwrap(), source.label);
        assert_eq!(hint, [(vec![], key.into())]);
        assert_eq!(
            sequence_hints(&[source]),
            [("Run action".into(), key.into())]
        );
    }
}

#[test]
fn u4278b_leader_hints_register_no_accelerator() {
    let app = mock_app();
    for key in ["P", "J", "I", "C", "A", "S"] {
        let shortcut = format!("⌘K {key}");
        let source = item(
            &format!("action:leader:{key}"),
            "Run action",
            Some(&shortcut),
            None,
        );
        let (built, hint) = project_kind(
            app.handle(),
            &source,
            |app, id, label, enabled, accelerator| {
                assert_eq!(accelerator, None);
                MenuItem::with_id(app, id, label, enabled, accelerator)
            },
        )
        .unwrap();
        assert_eq!(plain(built).text().unwrap(), source.label);
        assert_eq!(hint, [(vec![], shortcut)]);
    }
}

#[test]
fn u2539b_native_menu_projects_the_task_chords() {
    use std::sync::Arc;
    use tauri::Listener;
    use tauri::test::{mock_builder, mock_context, noop_assets};
    let app = mock_builder()
        .manage(ProjectMenu::default())
        .menu(app_menu)
        .build(mock_context(noop_assets()))
        .unwrap();
    let received = Arc::new(Mutex::new(Vec::new()));
    let observed = Arc::clone(&received);
    app.listen("open-project-page", move |event| {
        observed
            .lock()
            .unwrap()
            .push(serde_json::from_str::<serde_json::Value>(event.payload()).unwrap());
    });
    for path in ["/A", "/B"] {
        let mut unavailable = item("action:leader:A", "Assign Todo", Some("⌘K A"), None);
        unavailable.enabled = false;
        select_project_menu(
            app.handle().clone(),
            Some(path.to_owned()),
            Some(vec![
                item("action:leader:C", "Review changes", Some("⌘K C"), None),
                item("action:chord:⌘F", "Find…", Some("⌘F"), None),
                item("action:chord:F2", "Rename", Some("F2"), None),
                item("action:chord:⏎", "Open", Some("⏎"), None),
                item("action:chord:?", "Help", Some("?"), None),
                item("action:chord:⌘=", "Larger Terminal text", Some("⌘="), None),
                item("action:chord:⌘-", "Smaller Terminal text", Some("⌘-"), None),
                item(
                    "action:chord:⌘0",
                    "Reset Terminal text size",
                    Some("⌘0"),
                    None,
                ),
                item("action:chord:A", "Assign", Some("A"), None),
                item("action:chord:W", "Move", Some("W"), None),
                item("action:chord:X", "Complete", Some("X"), None),
                item("action:chord:C", "Comment", Some("C"), None),
                item("action:chord:Tab", "Nest", Some("Tab"), None),
                item("action:chord:⇧Tab", "Unnest", Some("⇧Tab"), None),
                item(
                    "action:chord:1–9:Digit1",
                    "Assign to first Agent",
                    Some("1"),
                    None,
                ),
                item(
                    "action:chord:1–9:Digit9",
                    "Assign to ninth Agent",
                    Some("9"),
                    None,
                ),
                unavailable,
            ]),
        )
        .unwrap();
        let menu = app.menu().unwrap();
        let MenuItemKind::Submenu(project) = menu.get("project-menu").unwrap() else {
            panic!("Project submenu");
        };
        let changes = plain(project.get("action:leader:C").unwrap());
        assert_eq!(changes.text().unwrap(), "Review changes");
        for id in [
            "action:leader:C",
            "action:chord:⌘F",
            "action:chord:F2",
            "action:chord:⏎",
            "action:chord:?",
            "action:chord:⌘=",
            "action:chord:⌘-",
            "action:chord:⌘0",
            "action:chord:A",
            "action:chord:W",
            "action:chord:X",
            "action:chord:C",
            "action:chord:Tab",
            "action:chord:⇧Tab",
            "action:chord:1–9:Digit1",
            "action:chord:1–9:Digit9",
            "action:leader:A",
        ] {
            app_chosen(app.handle(), &MenuEvent { id: id.into() });
        }
    }
    assert_eq!(
        *received.lock().unwrap(),
        vec![
            serde_json::json!({"path": "/A", "command": "action:leader:C"}),
            serde_json::json!({"path": "/A", "command": "action:chord:⌘F"}),
            serde_json::json!({"path": "/A", "command": "action:chord:F2"}),
            serde_json::json!({"path": "/A", "command": "action:chord:⏎"}),
            serde_json::json!({"path": "/A", "command": "action:chord:?"}),
            serde_json::json!({"path": "/A", "command": "action:chord:⌘="}),
            serde_json::json!({"path": "/A", "command": "action:chord:⌘-"}),
            serde_json::json!({"path": "/A", "command": "action:chord:⌘0"}),
            serde_json::json!({"path": "/A", "command": "action:chord:A"}),
            serde_json::json!({"path": "/A", "command": "action:chord:W"}),
            serde_json::json!({"path": "/A", "command": "action:chord:X"}),
            serde_json::json!({"path": "/A", "command": "action:chord:C"}),
            serde_json::json!({"path": "/A", "command": "action:chord:Tab"}),
            serde_json::json!({"path": "/A", "command": "action:chord:⇧Tab"}),
            serde_json::json!({"path": "/A", "command": "action:chord:1–9:Digit1"}),
            serde_json::json!({"path": "/A", "command": "action:chord:1–9:Digit9"}),
            serde_json::json!({"path": "/B", "command": "action:leader:C"}),
            serde_json::json!({"path": "/B", "command": "action:chord:⌘F"}),
            serde_json::json!({"path": "/B", "command": "action:chord:F2"}),
            serde_json::json!({"path": "/B", "command": "action:chord:⏎"}),
            serde_json::json!({"path": "/B", "command": "action:chord:?"}),
            serde_json::json!({"path": "/B", "command": "action:chord:⌘="}),
            serde_json::json!({"path": "/B", "command": "action:chord:⌘-"}),
            serde_json::json!({"path": "/B", "command": "action:chord:⌘0"}),
            serde_json::json!({"path": "/B", "command": "action:chord:A"}),
            serde_json::json!({"path": "/B", "command": "action:chord:W"}),
            serde_json::json!({"path": "/B", "command": "action:chord:X"}),
            serde_json::json!({"path": "/B", "command": "action:chord:C"}),
            serde_json::json!({"path": "/B", "command": "action:chord:Tab"}),
            serde_json::json!({"path": "/B", "command": "action:chord:⇧Tab"}),
            serde_json::json!({"path": "/B", "command": "action:chord:1–9:Digit1"}),
            serde_json::json!({"path": "/B", "command": "action:chord:1–9:Digit9"}),
        ]
    );
}
