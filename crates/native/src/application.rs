//! AppKit notifications preserve native hide transitions even when JavaScript is suspended.
use block2::RcBlock;
use objc2::{
    MainThreadMarker, msg_send,
    rc::Retained,
    runtime::{AnyClass, AnyObject, ProtocolObject},
};
use objc2_foundation::{NSNotification, NSNotificationCenter, NSObjectProtocol, NSString};
use std::{cell::RefCell, ptr::NonNull};
use tauri::{Runtime, WebviewWindow};

type Token = Retained<ProtocolObject<dyn NSObjectProtocol>>;
struct Observers([Option<Token>; 2]);
impl Drop for Observers {
    fn drop(&mut self) {
        let center = NSNotificationCenter::defaultCenter();
        for token in self.0.iter().flatten() {
            // SAFETY: tokens are the exact observer objects returned by this center.
            unsafe {
                let object: &AnyObject = (**token).as_ref();
                center.removeObserver(object);
            }
        }
    }
}
thread_local! {
    static OBSERVERS: RefCell<Observers> = const { RefCell::new(Observers([None, None])) };
    static FULLSCREEN_OBSERVERS: RefCell<Observers> = const { RefCell::new(Observers([None, None])) };
}

/// Register hide/unhide observation on Tauri's main thread; replacement unregisters the old callbacks.
pub fn watch<R: Runtime>(
    window: WebviewWindow<R>,
    observed: impl Fn(&WebviewWindow<R>, &str, bool) + Send + Sync + 'static,
) -> tauri::Result<()> {
    let dispatch = window.clone();
    dispatch.run_on_main_thread(move || watch_on_main(window, observed))
}

fn watch_on_main<R: Runtime>(
    window: WebviewWindow<R>,
    observed: impl Fn(&WebviewWindow<R>, &str, bool) + Send + Sync + 'static,
) {
    let _main = MainThreadMarker::new().expect("Tauri dispatches observers on the main thread");
    let observed = std::sync::Arc::new(observed);
    let center = NSNotificationCenter::defaultCenter();
    let application = AnyClass::get(c"NSApplication").expect("AppKit owns this webview");
    // SAFETY: NSApplication.sharedApplication is process-owned and queried on the main thread.
    let application: Retained<AnyObject> = unsafe { msg_send![application, sharedApplication] };
    let hidden: bool = unsafe { msg_send![&*application, isHidden] };
    observed(&window, "initial", hidden);
    for (index, (name, hidden)) in [
        ("NSApplicationDidHideNotification", true),
        ("NSApplicationDidUnhideNotification", false),
    ]
    .into_iter()
    .enumerate()
    {
        let window = window.clone();
        let observed = observed.clone();
        let block = RcBlock::new(move |_notification: NonNull<NSNotification>| {
            observed(&window, name, hidden)
        });
        // SAFETY: AppKit delivers these notifications on the main thread; the block owns its window handle.
        let token = unsafe {
            center.addObserverForName_object_queue_usingBlock(
                Some(&NSString::from_str(name)),
                Some(&application),
                None,
                &block,
            )
        };
        OBSERVERS.with(|observers| {
            if let Some(previous) = observers.borrow_mut().0[index].replace(token) {
                // SAFETY: replacement removes exactly the token this center previously returned.
                unsafe {
                    center.removeObserver((*previous).as_ref());
                }
            }
        });
    }
}

/// Observe completed fullscreen transitions for one native window. Register before requesting
/// fullscreen; Tauri's is_fullscreen also reports the in-progress target, not completion.
/// Replacement unregisters the previous window's callbacks on the main thread.
pub fn watch_fullscreen<R: Runtime>(
    window: tauri::Window<R>,
    observed: impl Fn(bool) + Send + Sync + 'static,
) -> tauri::Result<()> {
    let dispatch = window.clone();
    dispatch.run_on_main_thread(move || {
        let _main = MainThreadMarker::new().expect("Tauri dispatches observers on the main thread");
        let pointer = window
            .ns_window()
            .expect("the observed native window exists");
        // SAFETY: Tauri supplies this live NSWindow; it is borrowed only on its main thread.
        let object = unsafe { &*pointer.cast::<AnyObject>() };
        let observed = std::sync::Arc::new(observed);
        let center = NSNotificationCenter::defaultCenter();
        for (index, (name, fullscreen)) in [
            ("NSWindowDidEnterFullScreenNotification", true),
            ("NSWindowDidExitFullScreenNotification", false),
        ]
        .into_iter()
        .enumerate()
        {
            let observed = observed.clone();
            let block =
                RcBlock::new(move |_notification: NonNull<NSNotification>| observed(fullscreen));
            // SAFETY: AppKit delivers this window's notifications on the main thread;
            // the center copies the block and the retained token controls its lifetime.
            let token = unsafe {
                center.addObserverForName_object_queue_usingBlock(
                    Some(&NSString::from_str(name)),
                    Some(object),
                    None,
                    &block,
                )
            };
            FULLSCREEN_OBSERVERS.with(|observers| {
                if let Some(previous) = observers.borrow_mut().0[index].replace(token) {
                    // SAFETY: this is the exact token this center returned.
                    unsafe {
                        center.removeObserver((*previous).as_ref());
                    }
                }
            });
        }
    })
}
