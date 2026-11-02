use super::*;
use objc2::{msg_send, rc::Retained};
use std::cell::Cell;

pub(crate) fn u5503_native_dock_menu_dispatches_the_chosen_action() {
    // This constructs Tao's actual application delegate, not an NSObject stand-in.
    fn runtime<R: tauri::Runtime>() -> R {
        R::new(Default::default()).unwrap()
    }
    let _runtime = runtime::<tauri::Wry>();
    let main = MainThreadMarker::new().unwrap();
    let app = NSApplication::sharedApplication(main);
    let delegate = app.delegate().unwrap();
    let object: &AnyObject = delegate.as_ref();
    let class = object.class();
    let methods: Vec<_> = class
        .instance_methods()
        .iter()
        .map(|method| (method.name(), method.implementation()))
        .collect();
    for selector in [
        sel!(applicationDidFinishLaunching:),
        sel!(applicationWillTerminate:),
        sel!(application:openURLs:),
        sel!(applicationShouldHandleReopen:hasVisibleWindows:),
    ] {
        assert!(class.instance_method(selector).is_some());
    }
    // Tao stores its runtime state behind this ivar. Preserve that exact allocation.
    let aux = class.instance_variable(c"auxState").unwrap();
    let state = unsafe { *aux.load::<*mut std::ffi::c_void>(object) };
    let closed = Rc::new(Cell::new(false));
    let openings = Rc::new(Cell::new(0));
    let menu = DockMenu::install(
        {
            let closed = closed.clone();
            let openings = openings.clone();
            move || {
                openings.set(openings.get() + 1);
                if closed.get() {
                    vec![("Open roundup".into(), Some("open".into()))]
                } else {
                    vec![
                        ("Waiting".into(), None),
                        ("Ada".into(), Some("/api:same".into())),
                        ("Ada".into(), Some("/web:same".into())),
                        ("Open roundup".into(), Some("open".into())),
                    ]
                }
            }
        },
        |error| panic!("Dock refresh failed: {error}"),
    )
    .unwrap();
    assert_eq!(
        DockMenu::install(Vec::new, |_| {}).err().as_deref(),
        Some("A Dock section is already installed")
    );
    assert!(std::ptr::eq(object, app.delegate().unwrap().as_ref()));
    assert_eq!(class, object.class());
    for (selector, implementation) in methods {
        assert!(std::ptr::fn_addr_eq(
            implementation,
            class.instance_method(selector).unwrap().implementation()
        ));
    }
    assert_eq!(state, unsafe { *aux.load::<*mut std::ffi::c_void>(object) });
    let before = openings.get();
    // Both opening and selection cross the native selectors AppKit uses.
    let native: Retained<NSMenu> = unsafe { msg_send![object, applicationDockMenu: &*app] };
    assert_eq!(openings.get(), before + 1);
    assert_eq!(native.numberOfItems(), 4);
    assert!(!native.itemAtIndex(0).unwrap().isEnabled());
    let mut effects = Vec::new();
    for (index, expected) in [(2, "/web:same"), (1, "/api:same"), (3, "open")] {
        unsafe {
            native.performActionForItemAtIndex(index);
        }
        let event = muda::MenuEvent::receiver().try_recv().unwrap();
        effects.push(menu.chosen(event.id.as_ref()).unwrap());
        assert_eq!(effects.last().unwrap(), expected);
        assert!(muda::MenuEvent::receiver().try_recv().is_err());
    }
    unsafe {
        native.performActionForItemAtIndex(0);
    }
    assert!(muda::MenuEvent::receiver().try_recv().is_err());
    closed.set(true);
    let replacement: Retained<NSMenu> = unsafe { msg_send![object, applicationDockMenu: &*app] };
    assert_eq!(replacement.numberOfItems(), 1);
    // Even a retained old native target cannot select a closed Project.
    unsafe {
        native.performActionForItemAtIndex(1);
    }
    let stale = muda::MenuEvent::receiver().try_recv().unwrap();
    assert_eq!(menu.chosen(stale.id.as_ref()), None);
    unsafe {
        replacement.performActionForItemAtIndex(0);
    }
    let event = muda::MenuEvent::receiver().try_recv().unwrap();
    assert_eq!(menu.chosen(event.id.as_ref()).as_deref(), Some("open"));
    assert!(muda::MenuEvent::receiver().try_recv().is_err());
    drop(menu);
    let absent: Option<Retained<NSMenu>> = unsafe { msg_send![object, applicationDockMenu: &*app] };
    assert!(absent.is_none());
}
