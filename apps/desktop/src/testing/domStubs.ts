import { useBrowserStorage } from "../state/storage";
import { configure } from "@solidjs/testing-library";
import { afterEach, beforeEach } from "vitest";
import { settled } from "../changes/chunks";

useBrowserStorage(window.localStorage);

beforeEach(() => useBrowserStorage(window.localStorage));

// Opening the Worktree panel starts two lazy chunks; one landing after jsdom is gone fails the lane with an Unhandled Error.
afterEach(settled);

// A lazily mounted tab (Todos, Progress) on a CPU-starved shard outlasts the 1000 ms default of `waitFor` and `findBy`; the 15 s test timeout decides instead.
configure({ asyncUtilTimeout: 10_000 });

// jsdom has no layout, so it has no scrollIntoView; the Rail calls it on a jump.
Element.prototype.scrollIntoView ??= () => undefined;

// Ark's Select scrolls its list and watches its size; jsdom has neither.
Element.prototype.scrollTo ??= () => undefined;

globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };

// Pierre watches viewport intersections; jsdom never paints an intersecting box.
globalThis.IntersectionObserver ??= class { root = null; rootMargin = "0px"; scrollMargin = "0px"; thresholds = []; observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };

// The harness also starts the scrollbar tracker here; jsdom paints no boxes and
// cannot adopt the shared styles into its library-owned shadow roots.
// A connected element counts as visible, as a browser reports one with a box.
Element.prototype.checkVisibility ??= function (this: Element) { return this.isConnected; };

ShadowRoot.prototype.adoptedStyleSheets ??= [];

CSSStyleSheet.prototype.replaceSync ??= () => undefined;

// jsdom has no boxes; Zag checks layout visibility before focusing the nonmodal Switcher and Ask dialogs.
// Keep hidden content excluded while allowing the real focus trap to run in tests.
Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get() {
  return this.isConnected && this.closest('.switcher[data-scope="dialog"], .ask-bar[data-scope="dialog"]') && !this.closest("[hidden]") ? 1 : 0;
} });

// xterm 6.1 builds its image canvas on open; jsdom has no canvas, so `getContext` answers null and xterm throws.
const context = Object.assign(Object.create(null), { measureText: () => ({ width: 0 }), clearRect() {}, drawImage() {}, fillRect() {}, putImageData() {}, getImageData: () => ({ data: new Uint8ClampedArray(4) }), createImageData: () => ({ data: new Uint8ClampedArray(4) }) });

HTMLCanvasElement.prototype.getContext = () => context;
