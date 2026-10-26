//! AppKit's accessibility preference is authoritative even when WebKit lacks its media query.
use block2::RcBlock;
use objc2::{
    MainThreadMarker, msg_send,
    rc::Retained,
    runtime::{AnyClass, AnyObject, ProtocolObject},
};
use objc2_foundation::{NSNotification, NSNotificationCenter, NSObjectProtocol, NSString};
use std::{cell::RefCell, ptr::NonNull};

type Token = Retained<ProtocolObject<dyn NSObjectProtocol>>;
struct Observer(Option<(Retained<NSNotificationCenter>, Token)>);
impl Drop for Observer {
    fn drop(&mut self) {
        if let Some((center, token)) = &self.0 {
            // SAFETY: removal uses the center and token that created this registration.
            unsafe {
                center.removeObserver((**token).as_ref());
            }
        }
    }
}
thread_local! { static OBSERVER: RefCell<Observer> = const { RefCell::new(Observer(None)) }; }

/// Observe the native preference on the main thread, including its initial value.
/// Unavailable AppKit selects the opaque fallback.
pub fn watch_transparency(changed: impl Fn(bool) + 'static) {
    let Some(_main) = MainThreadMarker::new() else {
        changed(true);
        return;
    };
    let Some(class) = AnyClass::get(c"NSWorkspace") else {
        changed(true);
        return;
    };
    // SAFETY: NSWorkspace's shared instance and notification center are retained AppKit objects.
    let workspace: Retained<AnyObject> = unsafe { msg_send![class, sharedWorkspace] };
    let center: Retained<NSNotificationCenter> =
        unsafe { msg_send![&*workspace, notificationCenter] };
    let read = move || {
        // SAFETY: invoked initially and by AppKit's accessibility notification on the main thread.
        unsafe { msg_send![&*workspace, accessibilityDisplayShouldReduceTransparency] }
    };
    changed(read());
    let block = RcBlock::new(move |_notification: NonNull<NSNotification>| changed(read()));
    // SAFETY: AppKit delivers workspace accessibility changes on the main thread; the block owns its captures.
    let token = unsafe {
        center.addObserverForName_object_queue_usingBlock(
            Some(&NSString::from_str(
                "NSWorkspaceAccessibilityDisplayOptionsDidChangeNotification",
            )),
            None,
            None,
            &block,
        )
    };
    OBSERVER.with(|observer| *observer.borrow_mut() = Observer(Some((center, token))));
}
