# Native integration

```text
desktop (workspace forbid)
  native::plugin → on_webview_ready → with_webview → owned Preferences
  idle-perf → native::watch → run_on_main_thread → existing evidence callback
```

This is the sole repository-owned unsafe integration crate. Other workspace crates
inherit `unsafe_code = "forbid"`. No pointer, untyped Objective-C receiver or native
object constructor with caller-supplied storage is public. `Preferences` retains
its object and a non-Send/non-Sync `MainThreadMarker`; construction off the main
thread returns `None`. The plugin obtains WKWebView only inside Tauri's callback,
checks the main thread before dereferencing, and never retains or replaces the
WKWebView. Its hook runs for the main and subsequently created webviews.

The idle observer is the existing hide/unhide notification subscription, moved
here so the measurement feature also obeys desktop's forbid. Registration is
marshalled to the main thread, the notification center retains its blocks, and
replacement and thread teardown unregister the exact retained observer tokens.
The evidence collector remains in desktop. This adds no presentation producer;
#3776 must reuse this native owner rather than creating another WKWebView owner.

## Installed facilities and reuse audit (2026-10-25)

- Installed Tauri **2.12.1** ([released 2026-09-30](https://crates.io/crates/tauri/2.12.1)) already supplies lifecycle registration and native
  dispatch. Its `PlatformWebview::inner` exposes a raw WKWebView; it supplies no
  safe API for WebKit's private near-60-fps preference. In
  `tauri-runtime-wry 2.12.1`, `Context::send_user_message` dispatches inline on the
  main thread or queues to that event loop; `WebviewMessage::WithWebview` obtains
  the live Wry view and invokes the callback while that view is held. Reuse these
  facilities, with the existing objc2 **0.6.4** / Foundation **0.3.2** retained
  objects and main-thread marker. [Tauri source and releases](https://github.com/tauri-apps/tauri/releases)
  show active October 2026 maintenance.
- [objc2-web-kit 0.3.2 WKPreferences](https://docs.rs/objc2-web-kit/0.3.2/objc2_web_kit/struct.WKPreferences.html)
  ([released 2025-10-04](https://crates.io/crates/objc2-web-kit/0.3.2)) offers maintained generated typed public bindings compatible with installed
  objc2 0.6. Its public WKPreferences bindings omit `_features`,
  `_setEnabled:forFeature:` and `_isEnabledForFeature:`. It cannot replace the
  private calls. [objc2 maintenance](https://github.com/madsmtm/objc2/commit/8a5abacd90d5403fc0463459a35826f892b9142e)
  continued on 2026-10-17. Select the already installed objc2 directly for these
  few private calls; retain runtime selector/feature refusal.
- [tauri-nspanel v2.1.1 manifest](https://github.com/ahkohd/tauri-nspanel/blob/ef6e3090a6083c653955ca0b6e7f6c6ae1453d40/Cargo.toml)
  requires Tauri 2.8.5, objc2 0.6.1 and Foundation/AppKit 0.3.1, semver compatible
  with this lockfile. Its v2.1 branch was updated **2026-10-08** at that revision.
  It provides NSPanel conversion, not WebKit preference control, so it is not an
  extraction dependency. The parent #3843 will integrate it here when it adds the
  panel; this extraction adds no unused panel wrapper or AppKit dependency.

## Macro and ownership audit

The current integration expands objc2 `msg_send!` and `sel!` only inside this
crate. Every receiver is created by WebKit or borrowed from Tauri; missing API
checks occur before the private feature setter. Desktop's Tauri command/context
macros remain under the workspace forbid and its existing mac-clippy lane.

The actual [v2.1.1 `panel!` macro](https://github.com/ahkohd/tauri-nspanel/blob/ef6e3090a6083c653955ca0b6e7f6c6ae1453d40/src/panel.rs)
expands at its invocation site: `objc2::define_class!`, an unsafe NSPanel
superclass declaration, unsafe NSObjectProtocol/Send/Sync implementations,
Objective-C methods and raw-pointer casts. Therefore #3843 must add its dependency
and invoke that macro **inside this crate**, keeping the generated panel type
private and marshalling operations through safe Tauri handles on the main thread.
Re-exporting the macro for desktop to invoke would violate the sole-owner rule;
upstream's generated Send/Sync implementations alone do not establish safe thread
use. No panel macro is invoked by this extraction. Third-party crate internals
are outside the repository-owned source restriction.

## Observers

S2297a's real-WebKit success proof now calls owned `Preferences` from the desktop
integration binary. Its missing-list/setter/feature proof moved intact into this
crate's main-thread test harness; App registration stays in desktop. No clause is
retired and no duplicate success proof is retained. U3787f's integration observer
calls the safe constructor from a worker thread and proves refusal before any
WebKit call. Type ownership prevents transferring an existing Preferences there.
The mac nextest profile includes both harnesses; Linux cannot claim their pass.

[Check run 40160846600](https://github.com/roundup-app/roundup/actions/runs/40160846600)
passed mac-clippy, all three pre-extraction S2297a proofs, and the six opt-in R24
measurement tests on 2026-10-25. These CI lanes cover compile/clippy/WebKit
observations for this extraction. This prerequisite claims none of #3843's shell,
storage, panel or native look-and-feel acceptance and requires no new Mac request.
