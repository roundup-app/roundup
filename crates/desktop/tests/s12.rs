//! S12 (`scenarios/app.md`): the App carries roundup's rendered icon.

use tauri::test::MockRuntime;

#[test]
fn s12_the_app_carries_the_1024_px_rendered_icon() {
    let context = desktop::context::<MockRuntime>();
    let icon = context
        .default_window_icon()
        .expect("the App embeds icons/icon.png");
    assert_eq!((icon.width(), icon.height()), (1024, 1024));
    assert_eq!(
        icon.rgba()[3],
        0,
        "the corner is transparent, outside the icon's rounded tile"
    );
}
