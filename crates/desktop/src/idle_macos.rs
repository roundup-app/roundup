//! AppKit notifications preserve native hide transitions even when JavaScript is suspended.
#![allow(unsafe_code)]
use block2::RcBlock;
use objc2::{
    msg_send,
    rc::Retained,
    runtime::{AnyClass, AnyObject, ProtocolObject},
};
use objc2_foundation::{NSNotification, NSNotificationCenter, NSObjectProtocol, NSString};
use std::{cell::RefCell, ptr::NonNull};
use tauri::{Runtime, WebviewWindow};

type Token = Retained<ProtocolObject<dyn NSObjectProtocol>>;
struct Observers(Vec<Token>);
impl Drop for Observers {
    fn drop(&mut self) {
        let center = NSNotificationCenter::defaultCenter();
        for token in &self.0 {
            // SAFETY: tokens are the exact observer objects returned by this center.
            unsafe {
                let object: &AnyObject = (**token).as_ref();
                center.removeObserver(object);
            }
        }
    }
}
thread_local! { static OBSERVERS: RefCell<Observers> = const { RefCell::new(Observers(Vec::new())) }; }

pub(super) fn watch<R: Runtime>(window: WebviewWindow<R>) {
    let center = NSNotificationCenter::defaultCenter();
    let application = AnyClass::get(c"NSApplication").expect("AppKit owns this webview");
    // SAFETY: NSApplication.sharedApplication is process-owned and queried on the main thread.
    let application: Retained<AnyObject> = unsafe { msg_send![application, sharedApplication] };
    let hidden: bool = unsafe { msg_send![&*application, isHidden] };
    super::idle::application(&window, "initial", hidden);
    for (name, hidden) in [
        ("NSApplicationDidHideNotification", true),
        ("NSApplicationDidUnhideNotification", false),
    ] {
        let observed = window.clone();
        let block = RcBlock::new(move |_notification: NonNull<NSNotification>| super::idle::application(&observed, name, hidden));
        // SAFETY: AppKit delivers these notifications on the main thread; the block owns its window handle.
        let token = unsafe {
            center.addObserverForName_object_queue_usingBlock(
                Some(&NSString::from_str(name)),
                Some(&application),
                None,
                &block,
            )
        };
        OBSERVERS.with(|observers| observers.borrow_mut().0.push(token));
    }
}
