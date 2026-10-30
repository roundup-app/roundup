//! S2297a: turns off WebKit's `PreferPageRenderingUpdatesNear60FPSEnabled` so the webview draws at the display's rate.
//! WebKit has no public API for it. The private calls, `+[WKPreferences _features]` and
//! `-[WKPreferences _setEnabled:forFeature:]` (the ones Safari's Feature Flags menu uses), are named here and nowhere else.

use std::fmt;

use objc2::rc::Retained;
use objc2::runtime::{AnyClass, AnyObject, Sel};
use objc2::sel;
use objc2::{MainThreadMarker, msg_send};
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
    // SAFETY: every receiver here is a live NSObject-derived WebKit object or its class.
    unsafe { msg_send![receiver, respondsToSelector: selector] }
}

/// A new `WKPreferences`.
fn new_preferences() -> Option<Retained<AnyObject>> {
    let class: &AnyObject = AnyClass::get(c"WKPreferences")?.as_ref();
    // SAFETY: WKPreferences inherits NSObject; new returns an owned preferences instance.
    unsafe { msg_send![class, new] }
}

/// `+[WKPreferences _features]`, or `None` when this WebKit has no such class method.
fn webkit_features() -> Option<Retained<NSArray<AnyObject>>> {
    let class = AnyClass::get(c"WKPreferences")?;
    let class: &AnyObject = class.as_ref();
    if !responds(class, sel!(_features)) {
        return None;
    }
    // SAFETY: the checked WebKit class method returns its retained array of feature objects.
    unsafe { msg_send![class, _features] }
}

fn find(features: &NSArray<AnyObject>) -> Option<Retained<AnyObject>> {
    features.iter().find(|feature| {
        // SAFETY: these objects come only from WKPreferences._features; key returns NSString.
        let key: Option<Retained<NSString>> = unsafe { msg_send![&**feature, key] };
        key.is_some_and(|key| key.to_string() == FEATURE)
    })
}

/// Turns the feature off on `preferences`; `features` is `webkit_features()` (a parameter so a test can stand in for a WebKit).
fn turn_off(preferences: &AnyObject, features: Option<&NSArray<AnyObject>>) -> Result<(), Missing> {
    let features = features.ok_or(Missing::Features)?;
    if !responds(preferences, sel!(_setEnabled:forFeature:)) {
        return Err(Missing::Setter);
    }
    let feature = find(features).ok_or(Missing::Feature)?;
    // SAFETY: preferences is owned WKPreferences (or the selector-refusal test); the feature
    // is retained from its WebKit array, and this selector takes a BOOL and feature object.
    unsafe { msg_send![preferences, _setEnabled: false, forFeature: &*feature] }
    Ok(())
}

/// Whether `preferences` reports the feature on, through `-[WKPreferences _isEnabledForFeature:]`; `None` when it cannot say.
fn is_on(preferences: &AnyObject) -> Option<bool> {
    let features = webkit_features()?;
    let feature = find(&features)?;
    if !responds(preferences, sel!(_isEnabledForFeature:)) {
        return None;
    }
    // SAFETY: this is a WKPreferences; the selector was checked and the feature comes from WebKit.
    Some(unsafe { msg_send![preferences, _isEnabledForFeature: &*feature] })
}

/// Owned WebKit preferences, constructed only on the main thread and never transferable to another thread.
/// No native pointer or Objective-C receiver crosses this interface.
pub struct Preferences {
    object: Retained<AnyObject>,
    _main: MainThreadMarker,
}

impl Preferences {
    /// Returns `None` off the main thread or when WebKit has no preferences class.
    pub fn new() -> Option<Self> {
        let main = MainThreadMarker::new()?;
        Some(Self {
            object: new_preferences()?,
            _main: main,
        })
    }

    /// Preserve WebKit's default when its private feature API is unavailable.
    pub fn turn_off(&self) -> Result<(), Missing> {
        turn_off(&self.object, webkit_features().as_deref())
    }

    /// Read WebKit's actual feature value, or `None` if it cannot report it.
    pub fn is_on(&self) -> Option<bool> {
        is_on(&self.object)
    }
}

/// The setup for one webview: its preferences, with one stderr line when WebKit lacks a call.
fn apply(webview: &AnyObject, main: MainThreadMarker) {
    // SAFETY: the only caller borrows Tauri's live WKWebView in its main-thread callback.
    // Both getters return retained objects; no WKWebView pointer escapes this callback.
    let configuration: Option<Retained<AnyObject>> = unsafe { msg_send![webview, configuration] };
    let preferences: Option<Retained<AnyObject>> =
        configuration.and_then(|configuration| unsafe { msg_send![&*configuration, preferences] });
    let Some(preferences) = preferences else {
        return;
    };
    let preferences = Preferences {
        object: preferences,
        _main: main,
    };
    if let Err(missing) = preferences.turn_off() {
        log::warn!(target: "roundup::shell", "configure WebKit frame rate: {missing}");
    }
}

/// The plugin that runs `apply` on each webview as it is created, the main window's and any later one's.
pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    tauri::plugin::Builder::new("webkit-rate")
        .on_webview_ready(|webview| {
            if let Err(error) = webview.with_webview(|platform| {
                let main = MainThreadMarker::new()
                    .expect("Tauri dispatches with_webview on the main thread");
                // SAFETY: on macOS `inner` is the `WKWebView`, alive for this call on the main thread.
                apply(unsafe { &*platform.inner().cast::<AnyObject>() }, main);
            }) {
                crate::diagnostic("configure WebKit frame rate", &error);
            }
        })
        .build()
}

#[cfg(test)]
pub(crate) mod tests {
    use super::{Missing, is_on, new_preferences, turn_off, webkit_features};
    use objc2::runtime::NSObject;
    use objc2_foundation::NSArray;

    pub fn s2297a_a_webkit_without_the_feature_keeps_its_rate_and_says_so() {
        let preferences = new_preferences().expect("WebKit has WKPreferences");
        let features = webkit_features().expect("this WebKit lists its features");

        let gap = turn_off(&preferences, None).unwrap_err();
        assert_eq!(gap, Missing::Features);
        assert!(gap.to_string().contains("_features"));

        let no_setter = NSObject::new();
        let gap = turn_off(&no_setter, Some(&*features)).unwrap_err();
        assert_eq!(gap, Missing::Setter);
        assert!(gap.to_string().contains("_setEnabled:forFeature:"));

        let empty = NSArray::new();
        let gap = turn_off(&preferences, Some(&*empty)).unwrap_err();
        assert_eq!(gap, Missing::Feature);
        assert!(
            gap.to_string()
                .contains("PreferPageRenderingUpdatesNear60FPSEnabled")
        );
        assert_eq!(is_on(&preferences), Some(true), "a gap changes nothing");
    }
    pub(crate) fn run() {
        let tests: &[(&str, fn())] = &[
            (
                "u3787b_native_responder_find_and_close_follow_availability",
                crate::menu::tests::u3787b_native_responder_find_and_close_follow_availability,
            ),
            (
                "s2297a_a_webkit_without_the_feature_keeps_its_rate_and_says_so",
                s2297a_a_webkit_without_the_feature_keeps_its_rate_and_says_so,
            ),
            (
                "u4462_the_hint_uses_the_tertiary_tone_and_menu_font",
                crate::menu::tests::u4462_the_hint_uses_the_tertiary_tone_and_menu_font,
            ),
            (
                "u4462_the_hint_stop_is_the_key_equivalent_edge",
                crate::menu::tests::u4462_the_hint_stop_is_the_key_equivalent_edge,
            ),
            (
                "u4462_installed_and_tracked_menus_use_one_decoration",
                crate::menu::tests::u4462_installed_and_tracked_menus_use_one_decoration,
            ),
        ];
        let args: Vec<_> = std::env::args().collect();
        if args.iter().any(|arg| arg == "--list") {
            if !args.iter().any(|arg| arg == "--ignored") {
                for (name, _) in tests {
                    println!("{name}: test");
                }
            }
            return;
        }
        for (name, test) in tests {
            if !args
                .iter()
                .any(|arg| tests.iter().any(|(name, _)| arg == name))
                || args.iter().any(|arg| arg == name)
            {
                test();
                println!("test {name} ... ok");
            }
        }
    }
}
