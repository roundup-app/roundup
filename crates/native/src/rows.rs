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

/// Style `menu`'s items by position; looks past the last item are ignored, since `itemAtIndex:`
/// raises for them. Repeatable: the badge, appearance-resolved tone and head are rebuilt each
/// call, so a refresh at menu opening keeps ages and light/dark current. Returns whether a row
/// changed height (a new or different subtitle) and so needs the menu measured again.
pub fn apply(menu: &NSMenu, looks: &[Look], mtm: MainThreadMarker) -> bool {
    let dark = dark(mtm);
    let mut regrown = false;
    for (index, look) in looks.iter().enumerate() {
        let Ok(position) = isize::try_from(index) else {
            break;
        };
        if position >= menu.numberOfItems() {
            break;
        }
        let Some(item) = menu.itemAtIndex(position) else {
            break;
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
                let mut taller = false;
                if item.respondsToSelector(sel!(setSubtitle:)) {
                    let next = NSString::from_str(subtitle);
                    taller = item
                        .subtitle()
                        .is_none_or(|shown| !shown.isEqualToString(&next));
                    if taller {
                        item.setSubtitle(Some(&next));
                    }
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
                // AppKit caches an item's height from its last layout; without this a row that was
                // measured as one line keeps that height and clips its two lines (U5959a).
                // Only a changed subtitle changes the height; a badge or tone keeps it, so an
                // open menu is not re-measured under the user.
                if taller {
                    menu.itemChanged(&item);
                    regrown = true;
                }
            }
        }
    }
    regrown
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

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::look::Tone;

    fn agent(subtitle: &str) -> Look {
        Look::Agent {
            subtitle: subtitle.into(),
            badge: Some("5m".into()),
            symbol: "checkmark.circle.fill",
            tone: Tone::Accent,
        }
    }

    pub(crate) fn u5959a_looks_past_the_last_item_are_ignored() {
        let main = MainThreadMarker::new().expect("main-thread harness");
        let menu = NSMenu::new(main);
        let item = NSMenuItem::new(main);
        item.setTitle(&NSString::from_str("Logo Design"));
        menu.addItem(&item);
        apply(&menu, &[agent("one"), agent("two"), Look::Head], main);
        assert_eq!(menu.numberOfItems(), 1);
    }

    pub(crate) fn u5959a_a_refresh_after_install_keeps_every_row_height() {
        let main = MainThreadMarker::new().expect("main-thread harness");
        let menu = NSMenu::new(main);
        let item = NSMenuItem::new(main);
        item.setTitle(&NSString::from_str("Logo Design"));
        menu.addItem(&item);
        let looks = [agent("Ready · Acme")];
        assert!(apply(&menu, &looks, main), "install sets the subtitle");
        assert!(
            !apply(&menu, &looks, main),
            "the opening refresh regrew a row"
        );
    }

    pub(crate) fn u5959a_a_two_line_look_grows_a_measured_row() {
        let main = MainThreadMarker::new().expect("main-thread harness");
        let menu = NSMenu::new(main);
        menu.setAutoenablesItems(false);
        let item = NSMenuItem::new(main);
        item.setTitle(&NSString::from_str("Logo Design"));
        menu.addItem(&item);
        // `size` makes AppKit lay the menu out, so the item is measured as one line.
        let one_line = menu.size().height;
        apply(
            &menu,
            &[Look::Agent {
                subtitle: "Terminal closed; resume…".into(),
                badge: Some("5m".into()),
                symbol: "checkmark.circle.fill",
                tone: Tone::Accent,
            }],
            main,
        );
        let two_lines = menu.size().height;
        assert!(
            two_lines > one_line,
            "the measured row kept its one-line height: {one_line} then {two_lines}"
        );
    }
}
