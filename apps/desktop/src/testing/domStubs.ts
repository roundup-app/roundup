import { useBrowserStorage } from "../state/storage";
import { configure } from "@solidjs/testing-library";
import { flush } from "solid-js";
import { afterEach, beforeEach } from "vitest";
import { settled } from "../changes/chunks";
import { isFocusFromKeyboard } from "@ui-sdk/core";

useBrowserStorage(window.localStorage);

beforeEach(() => useBrowserStorage(window.localStorage));

// Opening the Worktree panel starts two lazy chunks; one landing after jsdom is gone fails the lane with an Unhandled Error.
afterEach(settled);

// A lazily mounted tab (Todos, Progress) on a CPU-starved shard outlasts the 1000 ms default of `waitFor` and `findBy`; the 15 s test timeout decides instead.
configure({
  asyncUtilTimeout: 10_000,
  // ui-sdk keeps a tooltip's text in the page, `hidden` until it opens, and writes each announcement into an empty live region; text queries read what a surface shows, never either.
  defaultIgnore: "script, style, [role=tooltip], [role=tooltip] *, [data-ui-sdk-announcer], [data-ui-sdk-announcer] *",
  // Solid 2 batches a write until `flush`; an event's effects land before the test's next synchronous read, as a browser's microtask lands them.
  eventWrapper: dispatch => {
    const result: unknown = dispatch();

    flush();

    return result;
  },
});

// jsdom has no layout, so it has no scrollIntoView; the Rail calls it on a jump.
Element.prototype.scrollIntoView ??= () => undefined;

// Lists scroll to a highlighted row and watch their size; jsdom has neither.
Element.prototype.scrollTo ??= () => undefined;

// jsdom paints no boxes, so nothing sits under a point; ui-sdk's resizable handles ask, and a test that wants an answer sets its own.
Document.prototype.elementFromPoint ??= () => null;

globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };

// Pierre watches viewport intersections; jsdom never paints an intersecting box.
globalThis.IntersectionObserver ??= class { root = null; rootMargin = "0px"; scrollMargin = "0px"; thresholds = []; observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };

// The harness also starts the scrollbar tracker here; jsdom paints no boxes and
// cannot adopt the shared styles into its library-owned shadow roots.
// A connected element counts as visible, as a browser reports one with a box.
Element.prototype.checkVisibility ??= function (this: Element) { return this.isConnected; };

// ui-sdk's popups call `getAnimations` to wait out a transition; jsdom has none and nothing animates.
Element.prototype.getAnimations ??= () => [];

// ui-sdk marks a popup `popover="manual"` and shows it in the top layer. jsdom has no top layer and never matches `:popover-open`, so its default sheet hides every `[popover]` and an open popup would vanish from role queries.
// An inline display stands in for the top layer: it is on for as long as the popup is shown, as `:popover-open` would be.
HTMLElement.prototype.showPopover ??= function (this: HTMLElement) { this.style.display = "block"; };

HTMLElement.prototype.hidePopover ??= function (this: HTMLElement) { this.style.removeProperty("display"); };

// ui-sdk reads the last input modality from document listeners it installs on first use; a test that presses Tab before any popup has asked would be read as pointer input.
isFocusFromKeyboard();

// jsdom has no `inert` property. A browser reflects the attribute through it, and ui-sdk's exit writes it.
if (!("inert" in HTMLElement.prototype)) Object.defineProperty(HTMLElement.prototype, "inert", { configurable: true, get(this: HTMLElement) { return this.hasAttribute("inert"); }, set(this: HTMLElement, inert: boolean) { this.toggleAttribute("inert", inert); } });

ShadowRoot.prototype.adoptedStyleSheets ??= [];

CSSStyleSheet.prototype.replaceSync ??= () => undefined;

// xterm 6.1 builds its image canvas on open; jsdom has no canvas, so `getContext` answers null and xterm throws.
const context = Object.assign(Object.create(null), { measureText: () => ({ width: 0 }), clearRect() {}, drawImage() {}, fillRect() {}, putImageData() {}, getImageData: () => ({ data: new Uint8ClampedArray(4) }), createImageData: () => ({ data: new Uint8ClampedArray(4) }) });

HTMLCanvasElement.prototype.getContext = () => context;
