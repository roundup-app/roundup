//! U5502: native template mark and flat menu. Projection belongs to the connected App.

use std::collections::HashMap;
use std::sync::Mutex;

use rpc::RpcError;
use serde::{Deserialize, Serialize};
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Runtime};

const TRAY: &str = "roundup-menu-bar";

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub(crate) enum Action {
    Agent { path: String, agent: String },
    Open,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum Mark {
    Waiting,
    Ready,
    Empty,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Entry {
    label: String,
    action: Option<Action>,
    since: Option<i64>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Presentation {
    mark: Mark,
    entries: Vec<Entry>,
}

/// Native ids retain original identities while labels change; removed actions disappear.
pub(crate) struct MenuBar<R: Runtime> {
    dispatch: Mutex<Dispatch>,
    ages: Mutex<Vec<(MenuItem<R>, String, i64)>>,
}

impl<R: Runtime> Default for MenuBar<R> {
    fn default() -> Self {
        Self {
            dispatch: Mutex::new(Dispatch::default()),
            ages: Mutex::new(Vec::new()),
        }
    }
}

fn aged(label: &str, since: i64) -> String {
    let seconds = (time::OffsetDateTime::now_utc().unix_timestamp() - since / 1000).max(0);
    let age = match seconds {
        0..60 => "just now".to_owned(),
        60..3600 => format!("{}m", seconds / 60),
        3600..86400 => format!("{}h", seconds / 3600),
        _ => format!("{}d", seconds / 86400),
    };
    format!("{label} · {age}")
}

fn refresh_ages<R: Runtime>(app: &AppHandle<R>) {
    for (item, label, since) in app
        .state::<MenuBar<R>>()
        .ages
        .lock()
        .expect("menu-bar age lock")
        .iter()
    {
        if let Err(error) = item.set_text(aged(label, *since)) {
            crate::diagnostics::failure("refresh menu-bar ages", &error);
        }
    }
}

#[derive(Default)]
struct Dispatch {
    actions: HashMap<String, Action>,
}

impl Dispatch {
    fn replacement(&self, entries: &[Entry]) -> Self {
        let actions = entries
            .iter()
            .filter_map(|entry| entry.action.clone())
            .map(|action| (action_id(&action), action))
            .collect();
        Self { actions }
    }

    fn chosen(&self, id: &str, mut effect: impl FnMut(&Action)) {
        if let Some(action) = self.actions.get(id) {
            effect(action);
        }
    }
}

fn action_id(action: &Action) -> String {
    format!(
        "menu-bar:{}",
        serde_json::to_string(action).expect("menu action serializes")
    )
}

/// An 18px transparent monochrome template. Alpha alone supplies the three static looks;
/// macOS supplies the ink for the current menu-bar appearance.
fn image(mark: Mark) -> Image<'static> {
    let mut rgba = vec![0; 18 * 18 * 4];
    for y in 0..18 {
        for x in 0..18 {
            let radius = ((f64::from(x) - 8.5).powi(2) + (f64::from(y) - 8.5).powi(2)).sqrt();
            let alpha = match mark {
                Mark::Waiting => (6.0 - radius).clamp(0.0, 1.0),
                Mark::Ready => (3.0 - radius).clamp(0.0, 1.0),
                Mark::Empty => (6.0 - radius).clamp(0.0, 1.0) * (radius - 4.0).clamp(0.0, 1.0),
            };
            // The loop indices are 0..18; alpha is clamped to 0..1 before scaling to a byte.
            rgba[(y as usize * 18 + x as usize) * 4 + 3] = (alpha * 255.0) as u8;
        }
    }
    Image::new_owned(rgba, 18, 18)
}

fn internal(error: impl ToString) -> RpcError {
    RpcError::new(rpc::code::INTERNAL, error.to_string())
}

fn chosen<R: Runtime>(app: &AppHandle<R>, id: &str) {
    app.state::<MenuBar<R>>()
        .dispatch
        .lock()
        .expect("menu-bar lock")
        .chosen(id, |action| {
            if let Some(window) = app.get_webview_window("main")
                && let Err(error) = window
                    .unminimize()
                    .and_then(|()| window.show())
                    .and_then(|()| window.set_focus())
            {
                crate::diagnostics::failure("open roundup", &error);
            }
            if let Err(error) = app.emit("menu-bar-action", action) {
                crate::diagnostics::failure("open menu-bar selection", &error);
            }
        });
}

#[tauri::command]
pub(crate) fn set_menu_bar<R: Runtime>(
    app: AppHandle<R>,
    menu: Presentation,
) -> Result<(), RpcError> {
    let holder = app.state::<MenuBar<R>>();
    let mut dispatch = holder.dispatch.lock().expect("menu-bar lock");
    let next = dispatch.replacement(&menu.entries);
    let native = Menu::new(&app).map_err(internal)?;
    let mut ages = Vec::new();
    for (index, entry) in menu.entries.iter().enumerate() {
        let label = entry
            .since
            .map_or_else(|| entry.label.clone(), |since| aged(&entry.label, since));
        let item = MenuItem::with_id(
            &app,
            entry
                .action
                .as_ref()
                .map_or_else(|| format!("menu-bar:head:{index}"), action_id),
            label,
            entry.action.is_some(),
            None::<&str>,
        )
        .map_err(internal)?;
        native.append(&item).map_err(internal)?;
        if let Some(since) = entry.since {
            ages.push((item, entry.label.clone(), since));
        }
    }
    if let Some(tray) = app.tray_by_id(TRAY) {
        tray.set_menu(Some(native)).map_err(internal)?;
        tray.set_icon(Some(image(menu.mark))).map_err(internal)?;
        tray.set_icon_as_template(true).map_err(internal)?;
    } else {
        TrayIconBuilder::with_id(TRAY)
            .icon(image(menu.mark))
            .icon_as_template(true)
            .menu(&native)
            .show_menu_on_left_click(true)
            .on_menu_event(|app, event| chosen(app, event.id().as_ref()))
            .on_tray_icon_event(|tray, event| {
                if matches!(
                    event,
                    TrayIconEvent::Click {
                        button_state: MouseButtonState::Down,
                        ..
                    }
                ) {
                    refresh_ages(tray.app_handle());
                }
            })
            .build(&app)
            .map_err(internal)?;
    }
    *holder.ages.lock().expect("menu-bar age lock") = ages;
    *dispatch = next;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn u5502_native_menu_dispatches_only_the_chosen_action() {
        let entries = vec![
            Entry {
                label: "Waiting".into(),
                since: None,
                action: None,
            },
            Entry {
                label: "Ada".into(),
                since: None,
                action: Some(Action::Agent {
                    path: "/api".into(),
                    agent: "same".into(),
                }),
            },
            Entry {
                label: "Ada".into(),
                since: None,
                action: Some(Action::Agent {
                    path: "/web".into(),
                    agent: "same".into(),
                }),
            },
            Entry {
                label: "Open roundup".into(),
                since: None,
                action: Some(Action::Open),
            },
        ];
        let first = Dispatch::default().replacement(&entries);
        let mut effects = Vec::new();
        for id in [
            "head".to_owned(),
            "unknown".to_owned(),
            action_id(entries[2].action.as_ref().unwrap()),
            action_id(&Action::Open),
        ] {
            first.chosen(&id, |action| effects.push(action.clone()));
        }
        assert_eq!(
            effects,
            [
                Action::Agent {
                    path: "/web".into(),
                    agent: "same".into()
                },
                Action::Open
            ]
        );
        let closed = first.replacement(&entries[3..]);
        closed.chosen(&action_id(entries[1].action.as_ref().unwrap()), |_| {
            panic!("stale menu event reopened a closed Project")
        });
        closed.chosen(&action_id(&Action::Open), |action| {
            effects.push(action.clone())
        });
        assert_eq!(effects.last(), Some(&Action::Open));
    }
}
