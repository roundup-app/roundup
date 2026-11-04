//! A Dock section on the existing runtime delegate; AppKit owns the system entries.
use std::{
    cell::RefCell,
    collections::HashMap,
    rc::{Rc, Weak},
};

use muda::{ContextMenu, Menu, MenuItem};
use objc2::{
    MainThreadMarker, ffi,
    rc::Retained,
    runtime::{AnyObject, Sel},
    sel,
};
use objc2_app_kit::{NSApplication, NSMenu};

// The process has one application delegate. Weak ownership makes a dropped adapter inert.
thread_local! {
    static CURRENT: RefCell<Weak<RefCell<Section>>> = const { RefCell::new(Weak::new()) };
}

/// One Dock row: its plain title (the Dock's NSMenu draws nothing else, U5959c) and the
/// identity of its original action (`None` makes an inert head).
pub struct Row {
    pub title: String,
    pub action: Option<String>,
}

impl Row {
    pub fn plain(title: impl Into<String>, action: Option<String>) -> Self {
        Self {
            title: title.into(),
            action,
        }
    }
}

type Rows = Vec<Row>;

struct Section {
    refresh: Box<dyn Fn() -> Rows>,
    failure: Box<dyn Fn(String)>,
    menu: Menu,
    actions: HashMap<String, String>,
}

impl Section {
    fn refresh(&mut self) -> Result<(), String> {
        let menu = Menu::new();
        let mut actions = HashMap::new();
        for row in (self.refresh)() {
            // Muda allocates a fresh native identity, so even retained old targets are stale.
            let item = MenuItem::new(row.title.replace('&', "&&"), row.action.is_some(), None);
            if let Some(action) = row.action {
                actions.insert(item.id().as_ref().to_owned(), action);
            }
            menu.append(&item).map_err(|error| error.to_string())?;
        }
        self.menu = menu;
        self.actions = actions;
        Ok(())
    }
}

/// Main-thread owner of roundup's flat Dock section. No native pointer escapes.
/// Keep this owner alive while installed. Rows are `Row`s: plain title and original action identity;
/// no action makes an inert group head. Refresh runs synchronously at each native opening.
/// Consume existing Tauri menu events through `chosen`; no global event handler is replaced.
pub struct DockMenu {
    section: Rc<RefCell<Section>>,
}

impl DockMenu {
    /// Install on the live application delegate, refusing a competing callback or owner.
    /// Errors reach the caller; later menu-construction errors call `failure` and return no section.
    /// Installation/opening never activates the App or changes badges.
    pub fn install(
        refresh: impl Fn() -> Rows + 'static,
        failure: impl Fn(String) + 'static,
    ) -> Result<Self, String> {
        let main = MainThreadMarker::new().ok_or("Dock installation requires the main thread")?;
        if CURRENT.with_borrow(|current| current.upgrade().is_some()) {
            return Err("A Dock section is already installed".into());
        }
        let app = NSApplication::sharedApplication(main);
        let delegate = app
            .delegate()
            .ok_or("The application has no live delegate")?;
        let object: &AnyObject = delegate.as_ref();
        let class = object.class();
        let selector = sel!(applicationDockMenu:);
        let callback: unsafe extern "C-unwind" fn(&AnyObject, Sel, &NSApplication) -> *mut NSMenu =
            dock_menu;
        // SAFETY: Objective-C's IMP erases the function signature. The @ selector takes
        // self, _cmd and NSApplication*, returning NSMenu*. @ encodes object pointers.
        let implementation = unsafe {
            std::mem::transmute::<
                unsafe extern "C-unwind" fn(&AnyObject, Sel, &NSApplication) -> *mut NSMenu,
                objc2::runtime::Imp,
            >(callback)
        };
        if let Some(method) = class.instance_method(selector) {
            if !std::ptr::fn_addr_eq(method.implementation(), implementation) {
                return Err(
                    "The application delegate already implements an incompatible Dock callback"
                        .into(),
                );
            }
        } else {
            // SAFETY: only add an absent selector, on the main thread. Existing methods,
            // the delegate instance, ivars and runtime state stay intact.
            let registered = unsafe {
                ffi::class_addMethod(
                    std::ptr::from_ref(class).cast_mut(),
                    selector,
                    implementation,
                    c"@@:@".as_ptr(),
                )
            };
            if !registered.as_bool() {
                return Err("Registering the application delegate Dock callback failed".into());
            }
        }
        if !class
            .instance_method(selector)
            .is_some_and(|method| std::ptr::fn_addr_eq(method.implementation(), implementation))
        {
            return Err(
                "The application delegate Dock callback is missing after registration".into(),
            );
        }
        let mut section = Section {
            refresh: Box::new(refresh),
            failure: Box::new(failure),
            menu: Menu::new(),
            actions: HashMap::new(),
        };
        section.refresh()?;
        let section = Rc::new(RefCell::new(section));
        CURRENT.with_borrow_mut(|current| *current = Rc::downgrade(&section));
        Ok(Self { section })
    }

    /// Resolve exactly the current section's native menu event to its supplied identity.
    /// Non-Dock and retired native ids cannot select an action, even after Project close.
    pub fn chosen(&self, native_id: &str) -> Option<String> {
        self.section.borrow().actions.get(native_id).cloned()
    }
}

unsafe extern "C-unwind" fn dock_menu(
    _delegate: &AnyObject,
    _selector: Sel,
    _application: &NSApplication,
) -> *mut NSMenu {
    let Some(section) = CURRENT.with_borrow(Weak::upgrade) else {
        return std::ptr::null_mut();
    };
    let mut section = section.borrow_mut();
    if let Err(error) = section.refresh() {
        section.actions.clear();
        (section.failure)(error);
        return std::ptr::null_mut();
    }
    // Follow Cocoa's +0 callback convention even if the caller drops its owner during
    // refresh: the autorelease keeps the menu alive until AppKit retains it for tracking.
    // SAFETY: Muda's public accessor is a live NSMenu while Section owns its Menu.
    let menu = unsafe { Retained::retain(section.menu.ns_menu().cast::<NSMenu>()) }
        .expect("Muda owns a non-null NSMenu");
    drop(section);
    Retained::autorelease_return(menu)
}

#[cfg(test)]
pub(crate) mod tests;
