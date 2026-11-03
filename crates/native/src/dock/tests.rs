use super::*;
use objc2::msg_send;
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
    let methods: Vec<_> = std::iter::successors(Some(class), |class| class.superclass())
        .flat_map(|class| {
            class
                .instance_methods()
                .iter()
                // Categories can leave multiple methods for one selector. Snapshot
                // each method and the active lookup separately: they may differ already.
                .map(|method| {
                    (
                        class,
                        *method,
                        method.implementation(),
                        class
                            .instance_method(method.name())
                            .unwrap()
                            .implementation(),
                    )
                })
                .collect::<Vec<_>>()
        })
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
    app.setDelegate(None);
    let refusal = DockMenu::install(Vec::new, |_| {}).err();
    app.setDelegate(Some(&delegate));
    assert_eq!(
        refusal.as_deref(),
        Some("The application has no live delegate")
    );
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
    for (owner, method, implementation, dispatched) in methods {
        assert!(
            std::ptr::fn_addr_eq(implementation, method.implementation()),
            "{owner:?} {:?} implementation changed",
            method.name()
        );
        assert!(
            std::ptr::fn_addr_eq(
                dispatched,
                owner
                    .instance_method(method.name())
                    .unwrap()
                    .implementation()
            ),
            "{owner:?} {:?} dispatch changed",
            method.name()
        );
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
        native.performActionForItemAtIndex(index);
        let event = muda::MenuEvent::receiver().try_recv().unwrap();
        effects.push(menu.chosen(event.id.as_ref()).unwrap());
        assert_eq!(effects.last().unwrap(), expected);
        assert!(muda::MenuEvent::receiver().try_recv().is_err());
    }
    native.performActionForItemAtIndex(0);
    // AppKit disables pointer/keyboard activation; a forced programmatic action
    // may still emit muda's event, but it must never resolve to a supplied action.
    if let Ok(event) = muda::MenuEvent::receiver().try_recv() {
        assert_eq!(menu.chosen(event.id.as_ref()), None);
    }
    assert!(muda::MenuEvent::receiver().try_recv().is_err());
    closed.set(true);
    let replacement: Retained<NSMenu> = unsafe { msg_send![object, applicationDockMenu: &*app] };
    assert_eq!(replacement.numberOfItems(), 1);
    // Even a retained old native target cannot select a closed Project.
    native.performActionForItemAtIndex(1);
    let stale = muda::MenuEvent::receiver().try_recv().unwrap();
    assert_eq!(menu.chosen(stale.id.as_ref()), None);
    replacement.performActionForItemAtIndex(0);
    let event = muda::MenuEvent::receiver().try_recv().unwrap();
    assert_eq!(menu.chosen(event.id.as_ref()).as_deref(), Some("open"));
    assert!(muda::MenuEvent::receiver().try_recv().is_err());
    drop(menu);
    let absent: Option<Retained<NSMenu>> = unsafe { msg_send![object, applicationDockMenu: &*app] };
    assert!(absent.is_none());

    unsafe extern "C-unwind" fn competing(
        _delegate: &AnyObject,
        _selector: Sel,
        _application: &NSApplication,
    ) -> *mut NSMenu {
        std::ptr::null_mut()
    }
    let method = class.instance_method(sel!(applicationDockMenu:)).unwrap();
    let callback: unsafe extern "C-unwind" fn(&AnyObject, Sel, &NSApplication) -> *mut NSMenu =
        competing;
    // SAFETY: same Cocoa signature, on the main thread; restore before asserting.
    let original = unsafe {
        let implementation = std::mem::transmute::<
            unsafe extern "C-unwind" fn(&AnyObject, Sel, &NSApplication) -> *mut NSMenu,
            objc2::runtime::Imp,
        >(callback);
        method.set_implementation(implementation)
    };
    let refusal = DockMenu::install(Vec::new, |_| {}).err();
    // SAFETY: restore the original, signature-identical production callback.
    unsafe {
        method.set_implementation(original);
    }
    assert_eq!(
        refusal.as_deref(),
        Some("The application delegate already implements an incompatible Dock callback")
    );
}
