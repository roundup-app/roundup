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

// Ark focus traps use layout to recognize fields; jsdom gives every field zero height.
for (const field of [HTMLInputElement, HTMLTextAreaElement]) {
  Object.defineProperty(field.prototype, "offsetHeight", { configurable: true, get() { return this.isConnected && !this.closest("[hidden]") ? 1 : 0; } });
}

ShadowRoot.prototype.adoptedStyleSheets ??= [];

CSSStyleSheet.prototype.replaceSync ??= () => undefined;
