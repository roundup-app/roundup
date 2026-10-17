//! S2297a: turns off WebKit's `PreferPageRenderingUpdatesNear60FPSEnabled` so the webview draws at the display's rate.
//! WebKit has no public API for it. The private calls, `+[WKPreferences _features]` and
//! `-[WKPreferences _setEnabled:forFeature:]` (the ones Safari's Feature Flags menu uses), are named here and nowhere else.
#![allow(unsafe_code)]

use std::fmt;

use objc2::msg_send;
use objc2::rc::Retained;
use objc2::runtime::{AnyClass, AnyObject, Sel};
use objc2::sel;
use objc2_foundation::{NSArray, NSString};
use tauri::{Runtime, plugin::TauriPlugin};

#[link(name = "WebKit", kind = "framework")]
unsafe extern "C" {}

const FEATURE: &str = "PreferPageRenderingUpdatesNear60FPSEnabled";

/// What a WebKit lacks, so the webview keeps its own rate.
#[derive(Debug, PartialEq, Eq)]
pub enum Missing {
    Features,
    Setter,
    Feature,
}

impl fmt::Display for Missing {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let what = match self {
            Self::Features => "+[WKPreferences _features]",
            Self::Setter => "-[WKPreferences _setEnabled:forFeature:]",
            Self::Feature => FEATURE,
        };
        write!(
            f,
            "desktop: this WebKit lacks {what}, so the webview keeps its own frame rate"
        )
    }
}

fn responds(receiver: &AnyObject, selector: Sel) -> bool {
    unsafe { msg_send![receiver, respondsToSelector: selector] }
}

/// A new `WKPreferences`.
pub fn new_preferences() -> Option<Retained<AnyObject>> {
    let class: &AnyObject = AnyClass::get(c"WKPreferences")?.as_ref();
    unsafe { msg_send![class, new] }
}

/// `+[WKPreferences _features]`, or `None` when this WebKit has no such class method.
pub fn webkit_features() -> Option<Retained<NSArray<AnyObject>>> {
    let class = AnyClass::get(c"WKPreferences")?;
    let class: &AnyObject = class.as_ref();
    if !responds(class, sel!(_features)) {
        return None;
    }
    unsafe { msg_send![class, _features] }
}

fn find(features: &NSArray<AnyObject>) -> Option<Retained<AnyObject>> {
    features.iter().find(|feature| {
        let key: Option<Retained<NSString>> = unsafe { msg_send![&**feature, key] };
        key.is_some_and(|key| key.to_string() == FEATURE)
    })
}

/// Turns the feature off on `preferences`; `features` is `webkit_features()` (a parameter so a test can stand in for a WebKit).
pub fn turn_off(
    preferences: &AnyObject,
    features: Option<&NSArray<AnyObject>>,
) -> Result<(), Missing> {
    let features = features.ok_or(Missing::Features)?;
    if !responds(preferences, sel!(_setEnabled:forFeature:)) {
        return Err(Missing::Setter);
    }
    let feature = find(features).ok_or(Missing::Feature)?;
    unsafe { msg_send![preferences, _setEnabled: false, forFeature: &*feature] }
    Ok(())
}

/// Whether `preferences` reports the feature on, through `-[WKPreferences _isEnabledForFeature:]`; `None` when it cannot say.
pub fn is_on(preferences: &AnyObject) -> Option<bool> {
    let features = webkit_features()?;
    let feature = find(&features)?;
    Some(unsafe { msg_send![preferences, _isEnabledForFeature: &*feature] })
}

/// The setup for one webview: its preferences, with one stderr line when WebKit lacks a call.
pub fn apply(webview: &AnyObject) {
    let configuration: Option<Retained<AnyObject>> = unsafe { msg_send![webview, configuration] };
    let preferences: Option<Retained<AnyObject>> =
        configuration.and_then(|configuration| unsafe { msg_send![&*configuration, preferences] });
    let Some(preferences) = preferences else {
        return;
    };
    let features = webkit_features();
    if let Err(missing) = turn_off(&preferences, features.as_deref()) {
        eprintln!("{missing}");
    }
}

/// The plugin that runs `apply` on each webview as it is created, the main window's and any later one's.
pub(crate) fn plugin<R: Runtime>() -> TauriPlugin<R> {
    tauri::plugin::Builder::new("webkit-rate")
        .on_webview_ready(|webview| {
            let _ = webview.with_webview(|platform| {
                // SAFETY: on macOS `inner` is the `WKWebView`, alive for this call on the main thread.
                apply(unsafe { &*platform.inner().cast::<AnyObject>() });
            });
        })
        .build()
}
