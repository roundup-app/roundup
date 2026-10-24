// jsdom has no layout, so it has no scrollIntoView; the Rail calls it on a jump.
Element.prototype.scrollIntoView ??= () => undefined;

// Ark's Select scrolls its list and watches its size; jsdom has neither.
Element.prototype.scrollTo ??= () => undefined;

globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };

// The harness also starts the scrollbar tracker here; jsdom paints no boxes and
// cannot adopt the shared styles into its library-owned shadow roots.
Element.prototype.checkVisibility ??= () => false;

ShadowRoot.prototype.adoptedStyleSheets ??= [];

CSSStyleSheet.prototype.replaceSync ??= () => undefined;
