//! AppKit owns the user's accent; Tauri exposes theme changes but no accent API.
use block2::RcBlock;
use objc2::{
    MainThreadMarker, msg_send,
    rc::Retained,
    runtime::{AnyClass, AnyObject, ProtocolObject},
};
use objc2_foundation::{NSNotification, NSNotificationCenter, NSObjectProtocol, NSString};
use std::{cell::RefCell, ptr::NonNull};
use tauri::{AppHandle, Emitter, Runtime};

type Token = Retained<ProtocolObject<dyn NSObjectProtocol>>;
struct Observer(Option<Token>);
impl Drop for Observer {
    fn drop(&mut self) {
        if let Some(token) = &self.0 {
            // SAFETY: this is exactly the token returned by the default center.
            unsafe {
                NSNotificationCenter::defaultCenter().removeObserver((**token).as_ref());
            }
        }
    }
}
thread_local! { static OBSERVER: RefCell<Observer> = const { RefCell::new(Observer(None)) }; }

/// The current normalized sRGB accent; an unavailable class or conversion selects the App fallback.
pub fn system_accent() -> Option<[f64; 3]> {
    let _main = MainThreadMarker::new()?;
    let color = AnyClass::get(c"NSColor")?;
    let space = AnyClass::get(c"NSColorSpace")?;
    // SAFETY: AppKit's documented class methods return owned NSObject-derived colors and spaces.
    let accent: Retained<AnyObject> = unsafe { msg_send![color, controlAccentColor] };
    let space: Retained<AnyObject> = unsafe { msg_send![space, sRGBColorSpace] };
    // SAFETY: conversion can return nil when this color cannot be represented in sRGB.
    let accent: Option<Retained<AnyObject>> =
        unsafe { msg_send![&*accent, colorUsingColorSpace: &*space] };
    let accent = accent?;
    // SAFETY: a successful sRGB conversion exposes CGFloat RGB components (f64 on supported Macs).
    let channels = unsafe {
        [
            msg_send![&*accent, redComponent],
            msg_send![&*accent, greenComponent],
            msg_send![&*accent, blueComponent],
        ]
    };
    Some(channels.map(|channel: f64| channel.clamp(0.0, 1.0)))
}

/// One app-wide observer; replacement releases the prior notification registration.
pub fn watch_accent<R: Runtime>(app: AppHandle<R>) {
    let Some(_main) = MainThreadMarker::new() else {
        return;
    };
    let block = RcBlock::new(move |_notification: NonNull<NSNotification>| {
        if let Err(error) = app.emit("system-accent", system_accent()) {
            crate::diagnostic("deliver system accent", &error);
        }
    });
    // SAFETY: AppKit posts this notification on the main thread; the block owns its App handle.
    let token = unsafe {
        NSNotificationCenter::defaultCenter().addObserverForName_object_queue_usingBlock(
            Some(&NSString::from_str("NSSystemColorsDidChangeNotification")),
            None,
            None,
            &block,
        )
    };
    OBSERVER.with(|observer| *observer.borrow_mut() = Observer(Some(token)));
}
