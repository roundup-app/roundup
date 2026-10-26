//! Native integration owns Objective-C objects and thread obligations; callers supply only safe handles.
#[cfg(target_vendor = "apple")]
mod webkit_rate;
#[cfg(target_vendor = "apple")]
pub use webkit_rate::{Missing, Preferences, plugin};
#[cfg(target_vendor = "apple")]
mod application;
#[cfg(target_vendor = "apple")]
pub use application::{watch, watch_fullscreen};

#[cfg(target_vendor = "apple")]
mod capture;
#[cfg(target_vendor = "apple")]
pub use capture::{CapturePanel, CapturePanelState, register_capture};

// WKPreferences requires the process main thread, so these actual-WebKit proofs use a main-thread harness.
#[cfg(test)]
fn main() {
    #[cfg(target_vendor = "apple")]
    webkit_rate::tests::run();
}
