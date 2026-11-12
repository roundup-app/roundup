//! U5502/U5959: native template mark and flat menu of two-line rows. Projection belongs to the connected App.

// The AppKit looks apply on macOS only; other platforms keep the plain two-part title.
#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

use crate::Unpoisoned;
use std::collections::HashMap;
use std::sync::Mutex;

use contracts::data::ForkColour;
use rpc::RpcError;
use serde::{Deserialize, Serialize};
use tauri::image::Image;
#[cfg(not(target_os = "macos"))]
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

/// The state a row's disc shows (U5959a).
#[derive(Clone, Copy, Deserialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum State {
    NeedsYou,
    Error,
    Ready,
}

/// The SF Symbol and Kind Glyph tone of a state; the symbols differ so state reads without colour.
fn disc(state: State) -> (&'static str, native::Tone) {
    match state {
        State::NeedsYou => ("exclamationmark.circle.fill", native::Tone::Amber),
        State::Error => ("xmark.circle.fill", native::Tone::Red),
        State::Ready => ("checkmark.circle.fill", native::Tone::Accent),
    }
}

#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Entry {
    label: String,
    #[serde(default)]
    subtitle: Option<String>,
    #[serde(default)]
    state: Option<State>,
    #[serde(default)]
    head: bool,
    action: Option<Action>,
    since: Option<i64>,
}

/// Each entry's native look at `now`; the badge is the age at the right edge.
fn looks(entries: &[Entry], now: i64) -> Vec<native::Look> {
    entries
        .iter()
        .map(|entry| match (&entry.state, &entry.subtitle) {
            _ if entry.head => native::Look::Head,
            (Some(state), subtitle) => {
                let (symbol, tone) = disc(*state);
                native::Look::Agent {
                    subtitle: subtitle.clone().unwrap_or_default(),
                    badge: entry.since.map(|since| age(since, now)),
                    symbol,
                    tone,
                }
            }
            _ => native::Look::Plain,
        })
        .collect()
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Presentation {
    mark: Mark,
    entries: Vec<Entry>,
    dock: Vec<Entry>,
}

/// Native ids retain original identities while labels change; removed actions disappear.
pub(crate) struct MenuBar<R: Runtime> {
    dispatch: Mutex<Dispatch>,
    entries: Mutex<Vec<Entry>>,
    dock: Mutex<Vec<Entry>>,
    gate: Mutex<Gate<Presentation>>,
    marker: std::marker::PhantomData<fn() -> R>,
}

impl<R: Runtime> Default for MenuBar<R> {
    fn default() -> Self {
        Self {
            dispatch: Mutex::new(Dispatch::default()),
            entries: Mutex::new(Vec::new()),
            dock: Mutex::new(Vec::new()),
            gate: Mutex::new(Gate::default()),
            marker: std::marker::PhantomData,
        }
    }
}

/// U6994b: while the list is open a presentation waits here; AppKit closes a menu its owner replaces.
/// Only the newest waits, and closing releases it.
struct Gate<P> {
    open: bool,
    waiting: Option<P>,
}

impl<P> Default for Gate<P> {
    fn default() -> Self {
        Self {
            open: false,
            waiting: None,
        }
    }
}

impl<P> Gate<P> {
    /// The presentation to apply now: `next` when the list is closed, nothing when it waits.
    fn submit(&mut self, next: P) -> Option<P> {
        if self.open {
            self.waiting = Some(next);
            None
        } else {
            Some(next)
        }
    }

    /// The waiting presentation, released when the list closes.
    fn tracking(&mut self, open: bool) -> Option<P> {
        self.open = open;
        if open { None } else { self.waiting.take() }
    }
}

fn age(since: i64, now: i64) -> String {
    let seconds = now.saturating_sub(since).max(0) / 1000;
    match seconds {
        0..60 => "just now".to_owned(),
        60..3600 => format!("{}m", seconds / 60),
        3600..86400 => format!("{}h", seconds / 3600),
        _ => format!("{}d", seconds / 86400),
    }
}

/// Re-style the tray menu at each opening: ages and light/dark tones stay current.
#[cfg(target_os = "macos")]
fn refresh_looks<R: Runtime>(app: &AppHandle<R>) {
    let entries = app
        .state::<MenuBar<R>>()
        .entries
        .lock()
        .unpoisoned()
        .clone();
    style_tray(app, &entries);
}

#[cfg(target_os = "macos")]
fn style_tray<R: Runtime>(app: &AppHandle<R>, entries: &[Entry]) {
    if let Some(tray) = app.tray_by_id(TRAY)
        && let Err(error) = native::style_tray(&tray, looks(entries, provenance::now_ms()))
    {
        crate::diagnostics::failure("style menu-bar rows", &error);
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

/// The one-line title: the tray's native rows replace it with line one; other platforms
/// and the Dock, which draws only a plain title, show both lines.
fn title(entry: &Entry, two_lines: bool) -> String {
    match &entry.subtitle {
        Some(subtitle) if !two_lines => format!("{} · {subtitle}", entry.label),
        _ => entry.label.clone(),
    }
}

fn action_id(action: &Action) -> String {
    format!(
        "menu-bar:{}",
        serde_json::to_string(action).unwrap_or_default()
    )
}

/// The mark's side in pixels: the menu bar's 18 pt at 2x. macOS scales it to 18 pt.
const SIDE: u32 = 36;

/// The 🤌 glyph's alpha, one byte per pixel, row by row (`icons/README.md`).
const GLYPH: &[u8; (SIDE * SIDE) as usize] = include_bytes!("../icons/menu-bar-glyph.gray");

/// Where the fingertips hold the state dot, in pixels from the top-left corner.
const FINGERTIPS: (f64, f64) = (25.2, 5.04);

/// A transparent monochrome template: the 🤌 glyph with the state dot at its fingertips.
/// A clear halo parts the dot from the fingers. Alpha alone supplies the three static looks;
/// macOS supplies the ink for the current menu-bar appearance.
fn image(mark: Mark) -> Image<'static> {
    let mut rgba = vec![0; GLYPH.len() * 4];
    for (index, (pixel, &gray)) in rgba
        .as_chunks_mut::<4>()
        .0
        .iter_mut()
        .zip(GLYPH.iter())
        .enumerate()
    {
        let (x, y) = (index as u32 % SIDE, index as u32 / SIDE);
        let distance = (f64::from(x) + 0.5 - FINGERTIPS.0).hypot(f64::from(y) + 0.5 - FINGERTIPS.1);
        let inside = |radius: f64| (radius - distance + 0.5).clamp(0.0, 1.0);
        let (halo, dot) = match mark {
            Mark::Waiting => (6.48, inside(4.32)),
            Mark::Ready => (4.68, inside(2.52)),
            Mark::Empty => (6.48, inside(4.32) - inside(2.16)),
        };
        let glyph = f64::from(gray) / 255.0 * (1.0 - inside(halo));
        // alpha is clamped to 0..1 before scaling to a byte.
        pixel[3] = (glyph.max(dot) * 255.0).round() as u8;
    }
    Image::new_owned(rgba, SIDE, SIDE)
}

fn internal(error: impl ToString) -> RpcError {
    RpcError::new(rpc::code::INTERNAL, error.to_string())
}

fn chosen<R: Runtime>(app: &AppHandle<R>, id: &str) {
    app.state::<MenuBar<R>>()
        .dispatch
        .lock()
        .unpoisoned()
        .chosen(id, |action| {
            deliver(app, action);
        });
}

fn deliver<R: Runtime>(app: &AppHandle<R>, action: &Action) {
    if let Err(error) = app.emit("menu-bar-action", action) {
        crate::diagnostics::failure("open native menu selection", &error);
    }
}
/// FA5980d: the mark and whether it is a template: the live mark is, a Fork's is drawn in its colour.
fn presented(mark: Mark, fork: Option<ForkColour>) -> (Image<'static>, bool) {
    match fork {
        Some(colour) => (crate::fork_app::tint(&image(mark), colour), false),
        None => (image(mark), true),
    }
}

#[tauri::command]
pub(crate) fn set_menu_bar<R: Runtime>(
    app: AppHandle<R>,
    menu: Presentation,
) -> Result<(), RpcError> {
    #[cfg(target_os = "macos")]
    watch_tracking(&app);
    let ready = app
        .state::<MenuBar<R>>()
        .gate
        .lock()
        .unpoisoned()
        .submit(menu);
    ready.map_or(Ok(()), |menu| apply(&app, menu))
}

/// U6994b: the list's open and close come from AppKit's menu tracking. The release runs after the
/// close returns to the event loop, so a chosen row's action reaches the dispatch it was drawn from.
#[cfg(target_os = "macos")]
fn watch_tracking<R: Runtime>(app: &AppHandle<R>) {
    thread_local! { static WATCHING: std::cell::Cell<bool> = const { std::cell::Cell::new(false) }; }
    if WATCHING.get() {
        return;
    }
    let handle = app.clone();
    WATCHING.set(native::watch_menu_tracking(move |open| {
        let handle = handle.clone();
        let release = move || {
            let released = handle
                .state::<MenuBar<R>>()
                .gate
                .lock()
                .unpoisoned()
                .tracking(open);
            if let Some(menu) = released
                && let Err(error) = apply(&handle, menu)
            {
                crate::diagnostics::failure(
                    "apply menu-bar presentation",
                    &tauri::Error::Io(std::io::Error::other(error.to_string())),
                );
            }
        };
        let queue = handle.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(error) = queue.run_on_main_thread(release) {
                crate::diagnostics::failure("queue menu-bar release", &error);
            }
        });
    }));
}

fn apply<R: Runtime>(app: &AppHandle<R>, menu: Presentation) -> Result<(), RpcError> {
    let holder = app.state::<MenuBar<R>>();
    let mut dispatch = holder.dispatch.lock().unpoisoned();
    let next = dispatch.replacement(&menu.entries);
    let rows: Vec<(String, String, bool)> = menu
        .entries
        .iter()
        .enumerate()
        .map(|(index, entry)| {
            let id = entry
                .action
                .as_ref()
                .map_or_else(|| format!("menu-bar:head:{index}"), action_id);
            (
                id,
                title(entry, cfg!(target_os = "macos")),
                entry.action.is_some(),
            )
        })
        .collect();
    let fork = app
        .state::<crate::fork_app::Identity>()
        .0
        .as_ref()
        .map(|fork| fork.colour);
    let (shown, template) = presented(menu.mark, fork);
    let tray = match app.tray_by_id(TRAY) {
        Some(tray) => {
            tray.set_icon(Some(shown.clone())).map_err(internal)?;
            tray.set_icon_as_template(template).map_err(internal)?;
            tray
        }
        None => TrayIconBuilder::with_id(TRAY)
            .icon(shown)
            .icon_as_template(template)
            .show_menu_on_left_click(true)
            .on_menu_event(|app, event| chosen(app, event.id().as_ref()))
            .on_tray_icon_event(|tray, event| {
                #[cfg(not(target_os = "macos"))]
                let _ = tray;
                if matches!(
                    event,
                    TrayIconEvent::Click {
                        button_state: MouseButtonState::Down,
                        ..
                    }
                ) {
                    #[cfg(target_os = "macos")]
                    refresh_looks(tray.app_handle());
                }
            })
            .build(app)
            .map_err(internal)?,
    };
    #[cfg(target_os = "macos")]
    native::set_tray_menu(&tray, rows, looks(&menu.entries, provenance::now_ms()))
        .map_err(internal)?;
    #[cfg(not(target_os = "macos"))]
    {
        let native = Menu::new(app).map_err(internal)?;
        for (id, title, enabled) in rows {
            let item =
                MenuItem::with_id(app, id, title, enabled, None::<&str>).map_err(internal)?;
            native.append(&item).map_err(internal)?;
        }
        tray.set_menu(Some(native)).map_err(internal)?;
    }
    *dispatch = next;
    drop(dispatch);
    *holder.entries.lock().unpoisoned() = menu.entries;
    *holder.dock.lock().unpoisoned() = menu.dock;
    #[cfg(target_os = "macos")]
    install_dock(app)?;
    Ok(())
}

// AppKit and Muda require main-thread ownership; no native pointer leaves this thread.
#[cfg(target_os = "macos")]
thread_local! {
    static DOCK: std::cell::RefCell<Option<native::DockMenu>> = const { std::cell::RefCell::new(None) };
}

#[cfg(target_os = "macos")]
fn install_dock<R: Runtime>(app: &AppHandle<R>) -> Result<(), RpcError> {
    DOCK.with_borrow_mut(|owner| {
        if owner.is_some() {
            return Ok(());
        }
        let refresh = app.clone();
        let failure = app.clone();
        *owner = Some(
            native::DockMenu::install(
                move || {
                    let entries = refresh
                        .state::<MenuBar<R>>()
                        .dock
                        .lock()
                        .unpoisoned()
                        .clone();
                    entries
                        .iter()
                        .map(|entry| native::Row {
                            title: title(entry, false),
                            action: entry
                                .action
                                .as_ref()
                                .map(|action| serde_json::to_string(action).unwrap_or_default()),
                        })
                        .collect()
                },
                move |message| {
                    if let Err(error) = failure.emit(
                        "menu-bar-action",
                        serde_json::json!({"kind": "failure", "message": message}),
                    ) {
                        crate::diagnostics::failure("report Dock menu failure", &error);
                    }
                },
            )
            .map_err(internal)?,
        );
        Ok(())
    })
}

#[cfg(target_os = "macos")]
pub(crate) fn dock_chosen<R: Runtime>(app: &AppHandle<R>, id: &str) {
    DOCK.with_borrow(|owner| {
        if let Some(action) = owner.as_ref().and_then(|menu| menu.chosen(id)) {
            // The displayed Dock row retains its original identity while tracking. The
            // connected App reports a removed Agent instead of silently choosing another.
            match serde_json::from_str::<Action>(&action) {
                Ok(action) => deliver(app, &action),
                Err(error) => crate::diagnostics::failure("read Dock action", &error.into()),
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn u6994b_presentation_waits_for_the_list_to_close() {
        let mut gate = Gate::default();
        let mut tray: Vec<&str> = Vec::new();

        tray.extend(gate.submit("closed"));
        gate.tracking(true);
        tray.extend(gate.submit("first while open"));
        tray.extend(gate.submit("second while open"));
        assert_eq!(tray, ["closed"]);

        tray.extend(gate.tracking(false));
        tray.extend(gate.tracking(false));
        assert_eq!(tray, ["closed", "second while open"]);

        tray.extend(gate.submit("closed again"));
        assert_eq!(tray, ["closed", "second while open", "closed again"]);
    }

    #[test]
    fn u5502_rows_keep_identity_and_event_age() {
        for (elapsed, expected) in [
            (-1, "just now"),
            (59_999, "just now"),
            (60_000, "1m"),
            (3_599_999, "59m"),
            (3_600_000, "1h"),
            (86_399_999, "23h"),
            (86_400_000, "1d"),
        ] {
            assert_eq!(age(1_001, 1_001 + elapsed), expected);
        }
    }

    #[test]
    fn u5502_native_menu_dispatches_only_the_chosen_action() {
        let entries = vec![
            Entry {
                label: "Waiting".into(),
                subtitle: None,
                state: None,
                head: true,
                since: None,
                action: None,
            },
            Entry {
                label: "Ada".into(),
                subtitle: None,
                state: None,
                head: false,
                since: None,
                action: Some(Action::Agent {
                    path: "/api".into(),
                    agent: "same".into(),
                }),
            },
            Entry {
                label: "Ada".into(),
                subtitle: None,
                state: None,
                head: false,
                since: None,
                action: Some(Action::Agent {
                    path: "/web".into(),
                    agent: "same".into(),
                }),
            },
            Entry {
                label: "Open roundup".into(),
                subtitle: None,
                state: None,
                head: false,
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

    fn row(state: Option<State>, head: bool, since: Option<i64>) -> Entry {
        Entry {
            label: "Ada".into(),
            subtitle: Some("question · api".into()),
            state,
            head,
            action: None,
            since,
        }
    }

    #[test]
    fn fa5980d_a_fork_mark_is_coloured_and_the_live_mark_a_template() {
        let (live, template) = presented(Mark::Ready, None);
        assert!(template);
        assert_eq!(live.rgba(), image(Mark::Ready).rgba());
        for colour in [ForkColour::Red, ForkColour::Teal, ForkColour::Pink] {
            let (fork, template) = presented(Mark::Ready, Some(colour));
            assert!(!template);
            let want = crate::fork_app::accent(colour);
            let opaque: Vec<_> = fork
                .rgba()
                .as_chunks::<4>()
                .0
                .iter()
                .filter(|p| p[3] > 0)
                .collect();
            assert!(!opaque.is_empty() && opaque.iter().all(|p| p[..3] == want));
        }
    }

    #[test]
    fn u5959a_heads_are_native_section_headers() {
        assert_eq!(
            looks(&[row(None, true, None), row(None, false, None)], 0),
            [native::Look::Head, native::Look::Plain]
        );
    }

    #[test]
    fn u5959a_rows_project_title_badge_and_subtitle() {
        let [
            native::Look::Agent {
                subtitle, badge, ..
            },
        ] = &looks(&[row(Some(State::Ready), false, Some(0))], 120_000)[..]
        else {
            panic!("an Agent row looks like an Agent");
        };
        assert_eq!(subtitle, "question · api");
        assert_eq!(badge.as_deref(), Some("2m"));
    }

    #[test]
    fn u5959c_dock_rows_are_plain_label_and_subtitle_titles() {
        assert_eq!(
            title(&row(Some(State::Ready), false, Some(0)), false),
            "Ada · question · api"
        );
        let mut bare = row(Some(State::Ready), false, None);
        bare.subtitle = None;
        assert_eq!(title(&bare, false), "Ada");
    }

    #[test]
    fn u5959a_state_picks_disc_symbol_and_tone() {
        let discs = [State::NeedsYou, State::Error, State::Ready].map(disc);
        assert_eq!(
            discs,
            [
                ("exclamationmark.circle.fill", native::Tone::Amber),
                ("xmark.circle.fill", native::Tone::Red),
                ("checkmark.circle.fill", native::Tone::Accent),
            ]
        );
    }
}
