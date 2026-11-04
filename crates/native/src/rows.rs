//! U5959: AppKit rows for the menu-bar and Dock lists. Tauri's and Muda's items take plain text,
//! so the two-line look (`subtitle`, `badge`, section heads, palette-coloured SF Symbol) is applied
//! to the live `NSMenu` after Muda builds it. Identity and activation stay Muda's.
use objc2::{AllocAnyThread, MainThreadMarker, rc::Retained, runtime::NSObjectProtocol, sel};
use objc2_app_kit::{
    NSApplication, NSColor, NSImage, NSImageSymbolConfiguration, NSMenu, NSMenuItem,
    NSMenuItemBadge,
};
use objc2_foundation::{NSArray, NSString};

use crate::look::{Look, Tone};

fn dark(mtm: MainThreadMarker) -> bool {
    NSApplication::sharedApplication(mtm)
        .effectiveAppearance()
        .name()
        .to_string()
        .contains("Dark")
}

fn disc(symbol: &str, tone: Tone, dark: bool) -> Option<Retained<NSImage>> {
    let image = NSImage::imageWithSystemSymbolName_accessibilityDescription(
        &NSString::from_str(symbol),
        None,
    )?;
    let (red, green, blue) = tone.srgb(dark);
    let fill = NSColor::colorWithSRGBRed_green_blue_alpha(red, green, blue, 1.0);
    // Palette layers run glyph first, disc second: a white symbol knocked out of a tone disc.
    let white = NSColor::colorWithSRGBRed_green_blue_alpha(1.0, 1.0, 1.0, 1.0);
    let palette = NSArray::from_slice(&[&*white, &*fill]);
    image.imageWithSymbolConfiguration(&NSImageSymbolConfiguration::configurationWithPaletteColors(
        &palette,
    ))
}

/// Style `menu`'s items by position. Repeatable: the badge, appearance-resolved tone and head
/// are rebuilt each call, so a refresh at menu opening keeps ages and light/dark current.
pub fn apply(menu: &NSMenu, looks: &[Look], mtm: MainThreadMarker) {
    let dark = dark(mtm);
    for (index, look) in looks.iter().enumerate() {
        let Ok(position) = isize::try_from(index) else {
            return;
        };
        let Some(item) = menu.itemAtIndex(position) else {
            return;
        };
        match look {
            Look::Plain => {}
            Look::Head => {
                if item.isSectionHeader() {
                    continue;
                }
                let head = NSMenuItem::sectionHeaderWithTitle(&item.title(), mtm);
                menu.removeItemAtIndex(position);
                menu.insertItem_atIndex(&head, position);
            }
            Look::Agent {
                subtitle,
                badge,
                symbol,
                tone,
            } => {
                // Older systems lack these selectors; they keep the one-line title.
                if item.respondsToSelector(sel!(setSubtitle:)) {
                    item.setSubtitle(Some(&NSString::from_str(subtitle)));
                }
                if item.respondsToSelector(sel!(setBadge:)) {
                    let badge = badge.as_deref().map(|text| {
                        NSMenuItemBadge::initWithString(
                            NSMenuItemBadge::alloc(),
                            &NSString::from_str(text),
                        )
                    });
                    item.setBadge(badge.as_deref());
                }
                item.setImage(disc(symbol, *tone, dark).as_deref());
            }
        }
    }
}

/// Style the menu of a Tauri tray icon on the main thread; used at set time and at each opening.
pub fn style_tray<R: tauri::Runtime>(
    tray: &tauri::tray::TrayIcon<R>,
    looks: Vec<Look>,
) -> tauri::Result<()> {
    tray.with_inner_tray_icon(move |inner| {
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        if let Some(menu) = inner.ns_status_item().and_then(|item| item.menu(mtm)) {
            apply(&menu, &looks, mtm);
        }
    })
}
