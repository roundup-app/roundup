import { useBrowserStorage } from "../state/storage";
import { beforeEach } from "vitest";

useBrowserStorage(window.localStorage);

beforeEach(() => useBrowserStorage(window.localStorage));

// jsdom has no layout, so it has no scrollIntoView; the Rail calls it on a jump.
Element.prototype.scrollIntoView ??= () => undefined;

// Ark's Select scrolls its list and watches its size; jsdom has neither.
Element.prototype.scrollTo ??= () => undefined;

globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };

// Pierre watches viewport intersections; jsdom never paints an intersecting box.
globalThis.IntersectionObserver ??= class { root = null; rootMargin = "0px"; scrollMargin = "0px"; thresholds = []; observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };

// The harness also starts the scrollbar tracker here; jsdom paints no boxes and
// cannot adopt the shared styles into its library-owned shadow roots.
Element.prototype.checkVisibility ??= () => false;

ShadowRoot.prototype.adoptedStyleSheets ??= [];

CSSStyleSheet.prototype.replaceSync ??= () => undefined;

// jsdom has no boxes; Zag checks layout visibility before focusing Dialog children.
// Keep hidden content excluded while allowing the real focus trap to run in tests.
Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get() {
  return this.isConnected && this.closest('[data-scope="dialog"][data-part="content"]') && !this.closest("[hidden]") ? 1 : 0;
} });
