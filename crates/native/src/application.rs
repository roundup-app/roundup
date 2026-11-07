//! AppKit notifications preserve native hide transitions even when JavaScript is suspended.
use block2::RcBlock;
use objc2::{
    MainThreadMarker, msg_send,
    rc::Retained,
    runtime::{AnyClass, AnyObject, ProtocolObject},
};
use objc2_app_kit::NSApplication;
use objc2_foundation::{
    NSNotification, NSNotificationCenter, NSObjectProtocol, NSOperationQueue, NSString,
};
use std::{cell::RefCell, ptr::NonNull, sync::PoisonError};
use tauri::{Runtime, WebviewWindow};

type Token = Retained<ProtocolObject<dyn NSObjectProtocol>>;
struct Observers<const N: usize>([Option<Token>; N]);
impl<const N: usize> Drop for Observers<N> {
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
    static OBSERVERS: RefCell<Observers<2>> = const { RefCell::new(Observers([None, None])) };
    static FULLSCREEN_OBSERVERS: RefCell<Observers<3>> = const { RefCell::new(Observers([None, None, None])) };
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
    let Some(main) = MainThreadMarker::new() else {
        log::warn!(target: "roundup::shell", "application visibility observer needs the main thread");
        return;
    };
    let observed = std::sync::Arc::new(observed);
    let center = NSNotificationCenter::defaultCenter();
    let application = NSApplication::sharedApplication(main);
    observed(&window, "initial", application.isHidden());
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
                Some(application.as_ref()),
                None,
                &block,
            )
        };
        OBSERVERS.with(|observers| {
            if let Some(previous) = observers
                .borrow_mut()
                .0
                .get_mut(index)
                .and_then(|slot| slot.replace(token))
            {
                // SAFETY: replacement removes exactly the token this center previously returned.
                unsafe {
                    center.removeObserver((*previous).as_ref());
                }
            }
        });
    }
}

/// Preserve the normal position across fullscreen and observe its completed transitions.
/// Register before requesting
/// fullscreen; Tauri's is_fullscreen also reports the in-progress target, not completion.
/// Replacement unregisters the previous window's callbacks on the main thread.
pub fn watch_fullscreen<R: Runtime>(
    window: tauri::Window<R>,
    observed: impl Fn(bool) + Send + Sync + 'static,
) -> tauri::Result<()> {
    let dispatch = window.clone();
    dispatch.run_on_main_thread(move || {
        if MainThreadMarker::new().is_none() {
            log::warn!(target: "roundup::shell", "fullscreen observer needs the main thread");
            return;
        }
        let pointer = match window.ns_window() {
            Ok(pointer) => pointer,
            Err(error) => {
                crate::diagnostic("observe fullscreen", &error);
                return;
            }
        };
        // SAFETY: Tauri supplies this live NSWindow; it is borrowed only on its main thread.
        let object = unsafe { &*pointer.cast::<AnyObject>() };
        let observed = std::sync::Arc::new(observed);
        let center = NSNotificationCenter::defaultCenter();
        let normal_position = std::sync::Arc::new(std::sync::Mutex::new(None));
        for (index, (name, fullscreen)) in [
            ("NSWindowWillEnterFullScreenNotification", None),
            ("NSWindowDidEnterFullScreenNotification", Some(true)),
            ("NSWindowDidExitFullScreenNotification", Some(false)),
        ]
        .into_iter()
        .enumerate()
        {
            let observed = observed.clone();
            let window = window.clone();
            let normal_position = normal_position.clone();
            let block = RcBlock::new(move |_notification: NonNull<NSNotification>| {
                match fullscreen {
                    None => {
                        *normal_position
                            .lock()
                            .unwrap_or_else(PoisonError::into_inner) =
                            if window.is_maximized().unwrap_or(false) {
                                None
                            } else {
                                window.outer_position().ok()
                            };
                    }
                    Some(false) => {
                        let position = normal_position
                            .lock()
                            .unwrap_or_else(PoisonError::into_inner)
                            .take();
                        let window = window.clone();
                        let observed = observed.clone();
                        // Notification/delegate order is unspecified. Defer past both before
                        // queueing the position after Tao's asynchronous titlebar-style restore.
                        let restore = RcBlock::new(move || {
                            if let Some(position) = position
                                && let Err(error) = window.set_position(position)
                            {
                                crate::diagnostic("restore fullscreen position", &error);
                            }
                            observed(false);
                        });
                        // SAFETY: the main queue copies the block and runs it on AppKit's main
                        // thread; the block owns its safe Tauri handle and callback.
                        unsafe { NSOperationQueue::mainQueue().addOperationWithBlock(&restore) };
                    }
                    Some(true) => observed(true),
                }
            });
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
                if let Some(previous) = observers
                    .borrow_mut()
                    .0
                    .get_mut(index)
                    .and_then(|slot| slot.replace(token))
                {
                    // SAFETY: this is the exact token this center returned.
                    unsafe {
                        center.removeObserver((*previous).as_ref());
                    }
                }
            });
        }
    })
}

/// FA5980c: sets the Dock and ⌘-Tab icon from PNG bytes; the live App never calls it.
pub fn set_application_icon(png: &[u8]) {
    let Some(_main) = MainThreadMarker::new() else {
        return;
    };
    let (Some(application), Some(image)) =
        (AnyClass::get(c"NSApplication"), AnyClass::get(c"NSImage"))
    else {
        return;
    };
    let data = objc2_foundation::NSData::with_bytes(png);
    // SAFETY: both classes are AppKit's; the calls run on the main thread, and a nil image is refused.
    unsafe {
        let application: Retained<AnyObject> = msg_send![application, sharedApplication];
        let allocated: *mut AnyObject = msg_send![image, alloc];
        let image: *mut AnyObject = msg_send![allocated, initWithData: &*data];
        if let Some(image) = Retained::from_raw(image) {
            let _: () = msg_send![&*application, setApplicationIconImage: &*image];
        }
    }
}
