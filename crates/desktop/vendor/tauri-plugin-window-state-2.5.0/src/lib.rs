// Copyright 2019-2023 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

//! Save window positions and sizes and restore them when the app is reopened.

#![doc(
    html_logo_url = "https://github.com/tauri-apps/tauri/raw/dev/app-icon.png",
    html_favicon_url = "https://github.com/tauri-apps/tauri/raw/dev/app-icon.png"
)]
#![cfg(not(any(target_os = "android", target_os = "ios")))]

use bitflags::bitflags;
use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalSize, RunEvent, Runtime, WebviewWindow, Window,
    WindowEvent,
    plugin::{Builder as PluginBuilder, TauriPlugin},
};

use std::{
    collections::{HashMap, HashSet},
    fs::create_dir_all,
    io::BufReader,
    sync::{Arc, Mutex},
};

mod cmd;

type LabelMapperFn = dyn Fn(&str) -> &str + Send + Sync;
type FilterCallbackFn = dyn Fn(&str) -> bool + Send + Sync;

/// Default filename used to store window state.
///
/// If using a custom filename, you should probably use [`AppHandleExt::filename`] instead.
pub const DEFAULT_FILENAME: &str = ".window-state.json";

/// The error type returned by this plugin's fallible functions.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// An I/O error occurred while reading or writing the window state file.
    #[error(transparent)]
    Io(#[from] std::io::Error),
    /// An error occurred while calling into Tauri, e.g. while resolving the app config directory
    /// or manipulating a window.
    #[error(transparent)]
    Tauri(#[from] tauri::Error),
    /// An error occurred while serializing or deserializing the window state file.
    #[error(transparent)]
    SerdeJson(#[from] serde_json::Error),
}

// Never format foreign messages: JSON errors can contain saved values.
fn diagnostic(operation: &'static str, error: &Error) {
    match error {
        Error::Io(error) => {
            log::warn!(target: "roundup::shell", "{operation}: IO {:?}", error.kind())
        }
        Error::SerdeJson(error) => {
            log::warn!(target: "roundup::shell", "{operation}: JSON {:?} at {}:{}", error.classify(), error.line(), error.column())
        }
        Error::Tauri(_) => {
            log::warn!(target: "roundup::shell", "{operation}: native window operation failed")
        }
    }
}

/// Alias for a [`Result`](std::result::Result) with the error type [`Error`].
pub type Result<T> = std::result::Result<T, Error>;

bitflags! {
    /// Flags controlling which parts of a window's state are saved and restored.
    ///
    /// Flags can be combined with the bitwise OR operator (`|`), e.g. `StateFlags::SIZE | StateFlags::POSITION`.
    #[derive(Clone, Copy, Debug)]
    pub struct StateFlags: u32 {
        /// Save and restore the window size.
        const SIZE        = 1 << 0;
        /// Save and restore the window position.
        const POSITION    = 1 << 1;
        /// Save and restore whether the window is maximized.
        const MAXIMIZED   = 1 << 2;
        /// Save and restore whether the window is visible.
        const VISIBLE     = 1 << 3;
        /// Save and restore whether the window has decorations.
        const DECORATIONS = 1 << 4;
        /// Save and restore whether the window is fullscreen.
        const FULLSCREEN  = 1 << 5;
    }
}

impl Default for StateFlags {
    /// Default to [`all`](Self::all)
    fn default() -> Self {
        Self::all()
    }
}

struct PluginState {
    pub(crate) state_flags: StateFlags,
    filename: String,
    map_label: Option<Box<LabelMapperFn>>,
    load_failed: bool,
    tracked: Mutex<HashSet<String>>,
}

#[derive(Debug, Deserialize, Serialize, PartialEq)]
struct WindowState {
    #[serde(default = "unit_scale")]
    scale: f64,
    width: u32,
    height: u32,
    x: i32,
    y: i32,
    // prev_x and prev_y are used to store position
    // before maximization happened, because maximization
    // will set x and y to the top-left corner of the monitor
    prev_x: i32,
    prev_y: i32,
    maximized: bool,
    visible: bool,
    decorated: bool,
    fullscreen: bool,
}

fn unit_scale() -> f64 {
    1.0
}

impl Default for WindowState {
    fn default() -> Self {
        Self {
            scale: 1.0,
            width: Default::default(),
            height: Default::default(),
            x: Default::default(),
            y: Default::default(),
            prev_x: Default::default(),
            prev_y: Default::default(),
            maximized: Default::default(),
            visible: true,
            decorated: true,
            fullscreen: Default::default(),
        }
    }
}

struct WindowStateCache(Arc<Mutex<HashMap<String, WindowState>>>);
/// Used to prevent deadlocks from resize and position event listeners setting the cached state on restoring states
struct RestoringWindowState(Mutex<()>);

/// Extension trait for [`AppHandle`] exposing window state APIs.
pub trait AppHandleExt {
    /// Saves all open windows state to disk
    fn save_window_state(&self, flags: StateFlags) -> Result<()>;
    /// Get the name of the file used to store window state.
    fn filename(&self) -> String;
}

impl<R: Runtime> AppHandleExt for tauri::AppHandle<R> {
    fn save_window_state(&self, flags: StateFlags) -> Result<()> {
        let app_dir = self.path().app_config_dir()?;
        let plugin_state = self.state::<PluginState>();
        if plugin_state.load_failed {
            return Err(std::io::Error::other(
                "window state was unreadable; original file retained",
            )
            .into());
        }
        let state_path = app_dir.join(&plugin_state.filename);
        let windows = self.webview_windows();
        let cache = self.state::<WindowStateCache>();
        let mut state = cache.0.lock().unwrap();

        for (label, s) in state.iter_mut() {
            if !plugin_state.tracked.lock().unwrap().contains(label) {
                continue;
            }
            let window = if let Some(map) = &plugin_state.map_label {
                windows
                    .iter()
                    .find_map(|(l, window)| (map(l) == label).then_some(window))
            } else {
                windows.get(label)
            };

            if let Some(window) = window {
                window.update_state(s, flags)?;
            }
        }

        create_dir_all(app_dir)?;
        std::fs::write(state_path, serde_json::to_vec_pretty(&*state)?)?;

        Ok(())
    }

    fn filename(&self) -> String {
        self.state::<PluginState>().filename.clone()
    }
}

/// Extension trait for [`Window`] and [`WebviewWindow`] exposing window state APIs.
pub trait WindowExt {
    /// Restores this window state from disk
    fn restore_state(&self, flags: StateFlags) -> tauri::Result<()>;
}

impl<R: Runtime> WindowExt for WebviewWindow<R> {
    fn restore_state(&self, flags: StateFlags) -> tauri::Result<()> {
        self.as_ref().window().restore_state(flags)
    }
}

impl<R: Runtime> WindowExt for Window<R> {
    fn restore_state(&self, flags: StateFlags) -> tauri::Result<()> {
        let plugin_state = self.app_handle().state::<PluginState>();
        let label = plugin_state
            .map_label
            .as_ref()
            .map(|map| map(self.label()))
            .unwrap_or_else(|| self.label());

        let restoring_window_state = self.state::<RestoringWindowState>();
        let _restoring_window_lock = restoring_window_state.0.lock().unwrap();
        let cache = self.state::<WindowStateCache>();
        let mut c = cache.0.lock().unwrap();
        let mut fullscreen = false;

        if let Some(state) = c
            .get(label)
            .filter(|state| state != &&WindowState::default())
        {
            if flags.contains(StateFlags::DECORATIONS) {
                self.set_decorations(state.decorated)?;
            }

            // The file stores physical normal bounds with their source scale. Convert before
            // applying them on the current display; fullscreen/zoom never supply normal bounds.
            if state.scale.is_finite()
                && state.scale > 0.0
                && state.width > 0
                && state.height > 0
                && state.width <= 100_000
                && state.height <= 100_000
            {
                self.set_fullscreen(false)?;
                self.unmaximize()?;
                let scale = self.scale_factor()?;
                let width = (f64::from(state.width) / state.scale).max(1280.0);
                let height = f64::from(state.height) / state.scale;
                let monitors = self.available_monitors()?;
                let position = tauri::LogicalPosition::new(
                    f64::from(state.x) / state.scale,
                    f64::from(state.y) / state.scale,
                )
                .to_physical::<i32>(scale);
                let monitor = monitors.iter().find(|m| {
                    let area = m.work_area();
                    i64::from(position.x) >= i64::from(area.position.x)
                        && i64::from(position.y) >= i64::from(area.position.y)
                        && i64::from(position.x) + (width * scale) as i64
                            <= i64::from(area.position.x) + i64::from(area.size.width)
                        && i64::from(position.y) + 32
                            <= i64::from(area.position.y) + i64::from(area.size.height)
                });
                let available = monitor.or_else(|| monitors.first());
                if flags.contains(StateFlags::SIZE) {
                    let width = available.map_or(width, |m| {
                        width.min((f64::from(m.work_area().size.width) / scale).max(1280.0))
                    });
                    let height = available
                        .map_or(height, |m| {
                            height.min(f64::from(m.work_area().size.height) / scale - 32.0)
                        })
                        .max(100.0);
                    self.set_size(tauri::LogicalSize::new(width, height))?;
                }
                if flags.contains(StateFlags::POSITION) {
                    if monitor.is_some() {
                        self.set_position(position)?;
                    } else if let Some(m) = available {
                        self.set_position(m.work_area().position)?;
                    }
                }
            } else {
                log::warn!(target: "roundup::shell", "restore window bounds: invalid normal bounds; using startup bounds");
            }

            if flags.contains(StateFlags::MAXIMIZED) && state.maximized {
                self.maximize()?;
            }

            fullscreen = flags.contains(StateFlags::FULLSCREEN) && state.fullscreen;
        } else {
            let mut metadata = WindowState {
                scale: self.scale_factor()?,
                ..WindowState::default()
            };

            if flags.contains(StateFlags::SIZE) {
                let size = restorable_size(self)?;
                metadata.width = size.width;
                metadata.height = size.height;
            }

            if flags.contains(StateFlags::POSITION) {
                let pos = self.outer_position()?;
                metadata.x = pos.x;
                metadata.y = pos.y;
            }

            if flags.contains(StateFlags::MAXIMIZED) {
                metadata.maximized = self.is_maximized()?;
            }

            if flags.contains(StateFlags::VISIBLE) {
                metadata.visible = self.is_visible()?;
            }

            if flags.contains(StateFlags::DECORATIONS) {
                metadata.decorated = self.is_decorated()?;
            }

            if flags.contains(StateFlags::FULLSCREEN) {
                metadata.fullscreen = self.is_fullscreen()?;
            }

            c.insert(label.into(), metadata);
            self.maximize()?;
        }

        {
            self.emit("window-state-restored", ())?;
            self.show()?;
            self.set_focus()?;
            // AppKit ignores a fullscreen request on a hidden window, so enter it once shown.
            if fullscreen {
                self.set_fullscreen(true)?;
            }
        }

        Ok(())
    }
}

trait WindowExtInternal {
    fn update_state(&self, state: &mut WindowState, flags: StateFlags) -> tauri::Result<()>;
}

impl<R: Runtime> WindowExtInternal for WebviewWindow<R> {
    fn update_state(&self, state: &mut WindowState, flags: StateFlags) -> tauri::Result<()> {
        self.as_ref().window().update_state(state, flags)
    }
}

impl<R: Runtime> WindowExtInternal for Window<R> {
    fn update_state(&self, state: &mut WindowState, flags: StateFlags) -> tauri::Result<()> {
        let is_maximized = flags
            .intersects(StateFlags::MAXIMIZED | StateFlags::POSITION | StateFlags::SIZE)
            && self.is_maximized()?;
        let is_minimized =
            flags.intersects(StateFlags::POSITION | StateFlags::SIZE) && self.is_minimized()?;

        if flags.contains(StateFlags::MAXIMIZED) {
            state.maximized = is_maximized;
        }

        if flags.contains(StateFlags::FULLSCREEN) {
            state.fullscreen = self.is_fullscreen()?;
        }

        if flags.contains(StateFlags::DECORATIONS) {
            state.decorated = self.is_decorated()?;
        }

        if flags.contains(StateFlags::VISIBLE) {
            state.visible = self.is_visible()?;
        }

        let normal = !is_maximized && !is_minimized && !self.is_fullscreen()?;
        if flags.contains(StateFlags::SIZE) && normal {
            let size = restorable_size(self)?;
            state.scale = self.scale_factor()?;
            // It doesn't make sense to save a window with 0 height or width
            if size.width > 0 && size.height > 0 {
                state.width = size.width;
                state.height = size.height;
            }
        }

        if flags.contains(StateFlags::POSITION) && normal {
            let position = self.outer_position()?;
            state.x = position.x;
            state.y = position.y;
        }

        Ok(())
    }
}

/// Builder for the window-state [plugin](TauriPlugin).
#[derive(Default)]
pub struct Builder {
    denylist: HashSet<String>,
    filter_callback: Option<Box<FilterCallbackFn>>,
    skip_initial_state: HashSet<String>,
    state_flags: StateFlags,
    map_label: Option<Box<LabelMapperFn>>,
    filename: Option<String>,
}

impl Builder {
    /// Creates a new [`Builder`] with the default configuration:
    /// all [`StateFlags`] enabled, no denylist, no filter, and the [`DEFAULT_FILENAME`].
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets the state flags to control what state gets restored and saved.
    pub fn with_state_flags(mut self, flags: StateFlags) -> Self {
        self.state_flags = flags;
        self
    }

    /// Sets a custom filename to use when saving and restoring window states from disk.
    pub fn with_filename(mut self, filename: impl Into<String>) -> Self {
        self.filename.replace(filename.into());
        self
    }

    /// Sets a list of windows that shouldn't be tracked and managed by this plugin
    /// For example, splash screen windows.
    pub fn with_denylist(mut self, denylist: &[&str]) -> Self {
        self.denylist = denylist.iter().map(|l| l.to_string()).collect();
        self
    }

    /// Sets a filter callback to exclude specific windows from being tracked.
    /// Return `true` to save the state, or `false` to skip and not save it.
    pub fn with_filter<F>(mut self, filter_callback: F) -> Self
    where
        F: Fn(&str) -> bool + Send + Sync + 'static,
    {
        self.filter_callback = Some(Box::new(filter_callback));
        self
    }

    /// Adds the given window label to a list of windows to skip initial state restore.
    pub fn skip_initial_state(mut self, label: &str) -> Self {
        self.skip_initial_state.insert(label.into());
        self
    }

    /// Transforms the window label when saving the window state.
    ///
    /// This can be used to group different windows to use the same state.
    pub fn map_label<F>(mut self, map_fn: F) -> Self
    where
        F: Fn(&str) -> &str + Sync + Send + 'static,
    {
        self.map_label = Some(Box::new(map_fn));
        self
    }

    /// Builds the [`TauriPlugin`].
    ///
    /// The plugin loads the previously saved window state on setup, restores each window's
    /// state when it becomes ready (unless denylisted, filtered out, or opted out with
    /// [`Builder::skip_initial_state`]), tracks move/resize events to keep the state up to date,
    /// and saves the state of all windows to disk when the app exits.
    pub fn build<R: Runtime>(self) -> TauriPlugin<R> {
        let state_flags = self.state_flags;
        let filename = self.filename.unwrap_or_else(|| DEFAULT_FILENAME.into());
        let map_label = self.map_label;

        PluginBuilder::new("window-state")
            .invoke_handler(tauri::generate_handler![
                cmd::save_window_state,
                cmd::restore_state,
                cmd::filename
            ])
            .setup(move |app, _api| {
                let (cache, load_failed) = match load_saved_window_states(app, &filename) {
                    Ok(cache) => (cache, false),
                    Err(Error::Io(e)) if e.kind() == std::io::ErrorKind::NotFound => {
                        (HashMap::new(), false)
                    }
                    Err(error) => {
                        diagnostic("restore window state; original file retained", &error);
                        (HashMap::new(), true)
                    }
                };
                app.manage(WindowStateCache(Arc::new(Mutex::new(cache))));
                app.manage(RestoringWindowState(Mutex::new(())));
                app.manage(PluginState {
                    state_flags,
                    load_failed,
                    tracked: Mutex::new(HashSet::new()),
                    filename,
                    map_label,
                });
                Ok(())
            })
            .on_window_ready(move |window| {
                let plugin_state = window.app_handle().state::<PluginState>();
                let label = plugin_state
                    .map_label
                    .as_ref()
                    .map(|map| map(window.label()))
                    .unwrap_or_else(|| window.label());

                // Check deny list names
                if self.denylist.contains(label) {
                    return;
                }

                // Check deny list callback
                if let Some(filter_callback) = &self.filter_callback {
                    // Don't save the state if the callback returns false
                    if !filter_callback(label) {
                        return;
                    }
                }

                plugin_state
                    .tracked
                    .lock()
                    .unwrap()
                    .insert(label.to_string());
                if !self.skip_initial_state.contains(label) {
                    if let Err(error) = window.restore_state(state_flags) {
                        diagnostic("restore window state", &error.into());
                        if let Err(error) = window.show() {
                            diagnostic("reveal window after failed restore", &error.into());
                        }
                    }
                }

                let cache = window.state::<WindowStateCache>();
                let cache = cache.0.clone();
                let label = label.to_string();
                let window_clone = window.clone();

                // insert a default state if this window should be tracked and
                // the disk cache doesn't have a state for it
                {
                    cache
                        .lock()
                        .unwrap()
                        .entry(label.clone())
                        .or_insert_with(WindowState::default);
                }

                window.on_window_event(move |e| match e {
                    WindowEvent::CloseRequested { .. } => {
                        let mut c = cache.lock().unwrap();
                        if let Some(state) = c.get_mut(&label) {
                            if let Err(error) = window_clone.update_state(state, state_flags) {
                                diagnostic("retain normal window bounds", &error.into());
                            }
                        }
                    }

                    WindowEvent::Moved(position)
                        if state_flags.contains(StateFlags::POSITION)
                            && window_clone
                                .state::<RestoringWindowState>()
                                .0
                                .try_lock()
                                .is_ok()
                            && !window_clone.is_minimized().unwrap_or_default()
                            && !window_clone.is_maximized().unwrap_or_default()
                            && !window_clone.is_fullscreen().unwrap_or_default() =>
                    {
                        let mut c = cache.lock().unwrap();
                        if let Some(state) = c.get_mut(&label) {
                            state.prev_x = state.x;
                            state.prev_y = state.y;

                            state.x = position.x;
                            state.y = position.y;
                        }
                    }
                    WindowEvent::Resized(size)
                        if state_flags.contains(StateFlags::SIZE)
                            && window_clone
                                .state::<RestoringWindowState>()
                                .0
                                .try_lock()
                                .is_ok() =>
                    {
                        // TODO: Remove once https://github.com/tauri-apps/tauri/issues/5812 is resolved.
                        let is_maximized = if cfg!(target_vendor = "apple")
                            && (!window_clone.is_decorated().unwrap_or_default()
                                || !window_clone.is_resizable().unwrap_or_default())
                        {
                            false
                        } else {
                            window_clone.is_maximized().unwrap_or_default()
                        };

                        if !window_clone.is_minimized().unwrap_or_default()
                            && !is_maximized
                            && !window_clone.is_fullscreen().unwrap_or_default()
                        {
                            let mut c = cache.lock().unwrap();
                            if let Some(state) = c.get_mut(&label) {
                                let size = restorable_size(&window_clone).unwrap_or(*size);
                                state.scale = window_clone.scale_factor().unwrap_or(1.0);
                                state.width = size.width;
                                state.height = size.height;
                            }
                        }
                    }
                    _ => {}
                });
            })
            .on_event(move |app, event| {
                if let RunEvent::Exit = event {
                    if let Err(error) = app.save_window_state(state_flags) {
                        diagnostic("save window state", &error);
                    }
                }
            })
            .build()
    }
}

fn load_saved_window_states<R: Runtime>(
    app: &AppHandle<R>,
    filename: &String,
) -> Result<HashMap<String, WindowState>> {
    let app_dir = app.path().app_config_dir()?;
    let state_path = app_dir.join(filename);
    let file = std::fs::File::open(state_path)?;
    let reader = BufReader::new(file);
    let states = serde_json::from_reader(reader)?;
    Ok(states)
}

// Overlay titlebars are included in inner_size on macOS, but set_size accepts
// the content rect. Subtract the native titlebar to prevent growth on each reopen.
fn restorable_size<R: Runtime>(window: &Window<R>) -> tauri::Result<PhysicalSize<u32>> {
    #[cfg(target_vendor = "apple")]
    {
        let outer = window.outer_size()?;
        let title_bar = window.inner_position()?.y - window.outer_position()?.y;
        Ok(PhysicalSize::new(
            outer.width,
            outer.height.saturating_sub(title_bar.max(0) as u32),
        ))
    }
    #[cfg(not(target_vendor = "apple"))]
    window.inner_size()
}
