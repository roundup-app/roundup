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
  extraction dependency. The in-progress Capture slice below integrates the panel in this native owner.

## Macro and ownership audit

The current integration expands objc2 `msg_send!` and `sel!` only inside this
crate. Every receiver is created by WebKit or borrowed from Tauri; missing API
checks occur before the private feature setter. Desktop's Tauri command/context
macros remain under the workspace forbid and its existing mac-clippy lane.

The actual [v2.1.1 `panel!` macro](https://github.com/ahkohd/tauri-nspanel/blob/ef6e3090a6083c653955ca0b6e7f6c6ae1453d40/src/panel.rs)
expands at its invocation site: `objc2::define_class!`, an unsafe NSPanel
superclass declaration, unsafe NSObjectProtocol/Send/Sync implementations,
Objective-C methods and raw-pointer casts. The Capture slice invokes that macro **inside this crate**, keeping the generated
panel type private and marshalling operations through safe Tauri handles on the
main thread.
Re-exporting the macro for desktop to invoke would violate the sole-owner rule;
upstream's generated Send/Sync implementations alone do not establish safe thread
use. The Capture macro invocation is audited below. Third-party crate internals
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

## Capture panel integration (U3787f, in progress)

`capture_plugin` registers pinned tauri-nspanel 2.1.1 and positioner 2.4.0. Neither
plugin receives JS command permissions. `CapturePanel` contains only an AppHandle;
its operations dispatch to the main thread, returning actual native observations.
The private macro-generated class may become key after deliberate interaction, but
cannot become main. Showing orders it front without activating the application;
a repeated show leaves an already visible panel in place. Dismiss orders it out.
Release converts it back to its original Tauri class before destruction, while all
retained native references are still on the main thread.

Positioner 2.4.0's `calculate_position` uses full monitor bounds and its non-tray
operations cannot select a monitor or constrain to the usable area. The safe owner
therefore uses Tauri's cursor and monitor APIs to select the invoking display,
uses positioner to center, then constrains to Tauri's actual monitor work area.
The main window is never passed to these operations.

The exact pinned `panel!` expansion source declares a private Objective-C subclass,
unsafe NSObjectProtocol/Send/Sync implementations, object_setClass calls and raw
pointer casts. The generated wrapper stays in the private `capture` module. No
PanelHandle, NSObject receiver or native pointer crosses the safe interface.
`to_window` must remove its own plugin registration: removing it first prevents
upstream from restoring the original native class. No additional unsafe exception
is added. A compiler-expanded macOS audit remains required before delivery.

The actual-AppKit observers run in desktop's existing s2297a main-thread harness:
`u3787f_panel_does_not_activate_main_window` creates/shows/re-shows/dismisses/releases
through the safe interface and checks the hidden main window remains unfocused
and unmoved; its worker calls are marshalled through a running real event loop; `u3787f_panel_uses_invoking_display` compares the real panel's monitor
and bounds with the cursor monitor's work area. These are macOS-only observers;
Linux supplies no native pass. No existing test or then-clause was cut. The existing
WebKit success, missing-feature and off-thread refusal proofs remain unchanged.

This slice is not the production inactive-App quick-add path. Pending: production
registration, acknowledged chord replacement/release and collision handling, plus a
panel-only view forwarding edits/actions to the existing Capture/draft owner. Do
not point the panel at a second full App or initialize a second draft writer. No
production caller registers this plugin until that view and event path are ready.
The observers load only about:blank, never the full App or a second draft holder.
The eventual production caller supplies its panel-only entry URL from Rust; no
webview command accepts an arbitrary URL. Construction refuses an unregistered
native integration. Failed conversion/style setup destroys its hidden window.
Only after that integration and CI pass can an implementation SHA identify the
remaining observation of another App retaining activation through show, deliberate
panel typing, submit/dismiss and focus return, including multiple displays. No
Chromium or hidden-window assertion proves that external-App focus behavior.
