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
        checked: None,
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
        true,
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
    let labels: Vec<_> = app
        .menu()
        .unwrap()
        .items()
        .unwrap()
        .iter()
        .filter_map(|item| {
            if let MenuItemKind::Submenu(submenu) = item {
                submenu.text().ok()
            } else {
                None
            }
        })
        .collect();
    let edit = labels.iter().position(|label| label == "Edit").unwrap();
    let window = labels.iter().position(|label| label == "Window").unwrap();
    assert!(edit < window, "Edit stays before Window and Help");
    if let Some(file) = labels.iter().position(|label| label == "File") {
        assert_eq!(edit, file + 1, "Edit stays immediately after File");
    }
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
fn u5919a_native_project_menu_has_two_groups() {
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
    for path in [Some("/A"), None, Some("/B")] {
        let inputs: Vec<_> = [
            ("action:chord:⌘N", "New Agent", "⌘N"),
            ("action:chord:⇧⌘N", "New Agent with a Prompt…", "⇧⌘N"),
            ("action:chord:⌥⌘N", "New Workstream", "⌥⌘N"),
            ("action:chord:⇧⌘M", "New Mode", "⇧⌘M"),
            ("action:chord:⌘T", "New Terminal", "⌘T"),
            ("action:chord:⇧⌘T", "Capture a Todo", "⇧⌘T"),
            ("action:chord:⌃⌘J", "Jump to What Needs You", "⌃⌘J"),
            ("action:leader:C", "Review Changes", "⌘K C"),
            ("action:leader:P", "Switch Project", "⌘K P"),
            ("action:chord:⌘O", "Open Folder…", "⌘O"),
        ]
        .into_iter()
        .enumerate()
        .map(|(index, (id, label, shortcut))| {
            let mut entry = item(id, label, Some(shortcut), None);
            entry.group = Some(if index < 6 { "create" } else { "navigate" }.to_owned());
            entry.enabled = path != Some("/A") || index != 7;
            entry
        })
        .collect();
        let expected: Vec<_> = inputs
            .iter()
            .enumerate()
            .flat_map(|(index, entry)| {
                let mut ids = Vec::new();
                if index == 6 {
                    ids.push("separator".to_owned());
                }
                ids.push(entry.id.clone());
                ids
            })
            .collect();
        select_project_menu(app.handle().clone(), path.map(str::to_owned), Some(inputs)).unwrap();
        let MenuItemKind::Submenu(project) = app.menu().unwrap().get("project-menu").unwrap()
        else {
            panic!("Project submenu");
        };
        assert!(project.is_enabled().unwrap());
        let actual: Vec<_> = project
            .items()
            .unwrap()
            .into_iter()
            .map(|entry| match entry {
                MenuItemKind::MenuItem(entry) => {
                    assert_eq!(
                        entry.is_enabled().unwrap(),
                        path.is_some() && (path != Some("/A") || entry.id().0 != "action:leader:C")
                    );
                    entry.id().0.clone()
                }
                MenuItemKind::Predefined(_) => "separator".to_owned(),
                _ => panic!("Unexpected submenu"),
            })
            .collect();
        assert_eq!(actual, expected);
        received.lock().unwrap().clear();
        for id in expected.iter().filter(|id| id.as_str() != "separator") {
            app_chosen(
                app.handle(),
                &MenuEvent {
                    id: id.clone().into(),
                },
            );
        }
        let expected_events: Vec<_> = expected
            .iter()
            .filter(|id| {
                path.is_some()
                    && id.as_str() != "separator"
                    && (path != Some("/A") || id.as_str() != "action:leader:C")
            })
            .map(|id| serde_json::json!({"path": path, "command": id}))
            .collect();
        assert_eq!(*received.lock().unwrap(), expected_events);
    }
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
        ("⌘B", "Super+B"),
        ("⌘I", "Super+I"),
        ("⌘E", "Super+E"),
        ("⇧⌘B", "Shift+Super+B"),
        ("⌥⌘8", "Alt+Super+8"),
        ("⌥⌘7", "Alt+Super+7"),
        ("⌥⌘C", "Alt+Super+C"),
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
            true,
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
        false,
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
            true,
            |app, id, label, enabled, accelerator| {
                assert_eq!(accelerator, None);
                MenuItem::with_id(app, id, label, enabled, accelerator)
            },
        )
        .unwrap();
        assert_eq!(plain(built).text().unwrap(), source.label);
        assert_eq!(hint, [(vec![], key.into())]);
        assert_eq!(
            sequence_hints(std::slice::from_ref(&source)),
            [(source.label.clone(), key.into())]
        );
    }
}

#[test]
fn u4278b_leader_hints_register_no_accelerator() {
    let app = mock_app();
    for (prefix, key) in [
        ("⌘K", "P"),
        ("⌘K", "J"),
        ("⌘K", "I"),
        ("⌘K", "C"),
        ("⌘K", "A"),
        ("⌘K", "S"),
        ("⇧⌘T", "C"),
        ("⇧⌘T", "P"),
    ] {
        let shortcut = format!("{prefix} {key}");
        let source = item(
            &format!("action:leader:{key}"),
            "Run action",
            Some(&shortcut),
            None,
        );
        let (built, hint) = project_kind(
            app.handle(),
            &source,
            true,
            |app, id, label, enabled, accelerator| {
                assert_eq!(accelerator, None);
                MenuItem::with_id(app, id, label, enabled, accelerator)
            },
        )
        .unwrap();
        assert_eq!(plain(built).text().unwrap(), source.label);
        assert_eq!(hint, [(vec![], shortcut.clone())]);
        assert_eq!(sequence_hints(&[source]), [("Run action".into(), shortcut)]);
    }
}

#[test]
fn u5244d_copy_version_info_writes_the_app_version() {
    let app = mock_app();
    let text = info_text(app.handle(), "copy-version-info", false).unwrap();
    let version = app.handle().package_info().version.to_string();
    assert_eq!(
        text,
        format!("roundup {version} ({})", env!("ROUNDUP_BUILD"))
    );
    assert_eq!(info_text(app.handle(), "app-settings", true), None);
}

#[test]
fn u5244d_app_menu_keeps_settings_and_standard_items() {
    let app = mock_app();
    let menu = app_menu(app.handle()).unwrap();
    let Some(MenuItemKind::Submenu(application)) = menu.items().unwrap().into_iter().next() else {
        panic!("the application submenu leads");
    };
    let ids: Vec<_> = application
        .items()
        .unwrap()
        .iter()
        .map(|item| item.id().0.clone())
        .collect();
    let position = |id: &str| ids.iter().position(|found| found == id).unwrap();
    assert_eq!(
        position("copy-version-info"),
        position("copy-debug-info") - 1
    );
    assert_eq!(position("copy-debug-info"), position("app-settings") - 1);
    assert!(ids.len() > 3, "the standard items stay");
    let Some(MenuItemKind::MenuItem(copy)) = application.get("copy-version-info") else {
        panic!("Copy Version Info is a plain item");
    };
    assert!(copy.is_enabled().unwrap());
}

#[test]
fn u5244e_debug_info_holds_exactly_the_four_facts() {
    assert_eq!(
        debug_info("1.2.3", "abc", "15.1", true),
        "roundup 1.2.3 (abc)\nDaemon 1.2.3\nmacOS 15.1\nDaemon reachable"
    );
    assert_eq!(
        debug_info("1.2.3", "abc", "15.1", false),
        "roundup 1.2.3 (abc)\nDaemon unknown\nmacOS 15.1\nDaemon unreachable"
    );
}

#[tokio::test]
async fn u5244e_debug_info_reachability_follows_the_daemon_answer() {
    let paths = || vec!["/a".to_owned(), "/b".to_owned()];
    // A running Project whose Daemon answers is reachable, even when the first one is silent.
    assert!(any_answers(paths(), |path| async move { path == "/b" }).await);
    // No Project, or none answering, is unreachable.
    assert!(!any_answers(paths(), |_| async { false }).await);
    assert!(!any_answers(Vec::new(), |_| async { true }).await);
}

fn project_ids(inputs: Vec<Item>, popup: bool) -> Vec<String> {
    use tauri::test::{mock_builder, mock_context, noop_assets};
    let app = mock_builder()
        .manage(ProjectMenu::default())
        .menu(app_menu)
        .build(mock_context(noop_assets()))
        .unwrap();
    let entries = if popup {
        let menu = Menu::new(app.handle()).unwrap();
        append(app.handle(), &menu, &inputs).unwrap();
        menu.items().unwrap()
    } else {
        select_project_menu(app.handle().clone(), Some("/A".to_owned()), Some(inputs)).unwrap();
        let MenuItemKind::Submenu(project) = app.menu().unwrap().get("project-menu").unwrap()
        else {
            panic!("Project submenu");
        };
        project.items().unwrap()
    };
    entries
        .into_iter()
        .filter_map(|entry| match entry {
            MenuItemKind::MenuItem(entry) => Some(entry.id().0.clone()),
            MenuItemKind::Submenu(sub) => Some(format!("submenu:{}", sub.text().unwrap())),
            _ => None,
        })
        .collect()
}

#[test]
fn u5244b_project_menu_keeps_disabled_entries_and_context_menus_do_not() {
    let build = || {
        let mut off = item("action:leader:C", "Review Changes", Some("⌘K C"), None);
        off.enabled = false;
        vec![item("action:chord:⌘N", "New Agent", Some("⌘N"), None), off]
    };
    assert_eq!(
        project_ids(build(), false),
        ["action:chord:⌘N", "action:leader:C"]
    );
    assert_eq!(project_ids(build(), true), ["action:chord:⌘N"]);
}

#[test]
fn u5501_native_alert_choices_keep_their_checked_state() {
    let app = mock_app();
    for checked in [true, false] {
        let mut choice = item("alerts:quiet", "Quiet", None, None);
        choice.checked = Some(checked);
        let projected = kind(
            app.handle(),
            &choice,
            |app, id, label, enabled, accelerator| {
                MenuItem::with_id(app, id, label, enabled, accelerator)
            },
        )
        .unwrap();
        let MenuItemKind::Check(entry) = projected else {
            panic!("expected a native check item");
        };
        assert_eq!(entry.is_checked().unwrap(), checked);
        assert_eq!(entry.id().0, "alerts:quiet");
    }
}
