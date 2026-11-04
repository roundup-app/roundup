# U5959a Mac observation

U5959a: PASS
The first opening of the menu-bar list draws both lines of every Agent row; choosing a row and `Open roundup` still work through the new menu.
Base commit: 89f41ee84998e30d1d7946ae5bc495c0397b0344 (origin/main)
Code under test: `git diff 89f41ee84 -- crates/desktop/src crates/native/src` of the commit that holds this file; SHA-256 of that diff `1f48f94f6fe2cd18378ad2895250db4657910239a9143962dc6b124f19e2d323`. The observed bundle was built from exactly that tree, so the code under test equals the commit.
Machine: macOS 26.0.1, aarch64, unlocked screen, `caffeinate -dis`.
Build: debug bundle, `pnpm dlx @tauri-apps/cli@^2 build --debug --ci --target aarch64-apple-darwin --features custom-protocol --bundles app --no-sign`; bundle identifier `dev.roundup.appmenu6062` (local edit, not committed); a scratch `ROUNDUP_DATA_DIR` and a scratch Project.
Captures are kept outside the repository; the file names below are theirs.

Cause, observed on PR #6071's head with temporary file logs (removed): at set time `style_tray` read `has_menu=false` because tray-icon attaches the menu to the status item only while it opens. The first styling ran in the same millisecond as the Down click (`refresh_looks`, `has_menu=true`, `apply items=4`), after AppKit had measured the rows as one line. The first opening clipped the Agent name; the second opening drew both lines.

Steps and what each showed:
1. Launch, open the list from the status item for the first time (before the fix: first line clipped, `first-open-baseline.png`). After the fix: both lines of `Reply ok` and `Logo design work` drawn (`fixed-first-open.png`, `final-first-open.png`, `c-open1.png`).
2. Open it a second time: both lines drawn (`fixed-second-open.png`, `c-open2.png`).
3. Choose the `Reply ok` row: the App selected the Agent reply-ok (`c-agent-chosen.png`). Muda events still arrive.
4. Hide the App, open the list, choose `Open roundup`: the App window came back (`c-open-hidden.png`, `c-open-roundup.png`).
5. Create a Workstream with one real `claude` prompt ("reply ok"). Its Agent changed state to Ready; the list then showed its two-line row, no crash, no clip (`c-open-after-change.png`). No new crash report was written.

Dock menu (right-click the Dock icon), tried with the Section's menu applied each time: the Dock draws only the plain title. `image` alone drew no icon (`dock-image.png`); `subtitle` and `badge` drew nothing (`dock-badge.png`); an `attributedTitle` of two lines drew one plain line with the subtitle joined by a space and no colour or size (`dock-attr.png`). A section head draws grey. Dock.app renders a serialized copy of the menu, so this is a platform limit; no code change.
