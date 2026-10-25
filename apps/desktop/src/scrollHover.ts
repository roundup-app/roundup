import { OverlayScrollbars } from "overlayscrollbars";
import type { OverlayScrollbars as Scrollbars } from "overlayscrollbars";
import scrollbarStyles from "./scrollbar.css?inline";
import overlayStyles from "overlayscrollbars/styles/overlayscrollbars.css?inline";
import "overlayscrollbars/styles/overlayscrollbars.css";

const IDLE_MS = 500;

const idle = new WeakMap<Element, ReturnType<typeof setTimeout>>();

/** Z3742a: xterm 6 owns a virtual scrollbar, not a native overflow viewport.
 * Its public API has no scroll-only auto-hide delay; keep this timer only there.
 * Capability probes and CSS fallback failure: Issues #3742 and #4094. */
export const showScrollbars = (element: HTMLElement): void => {
  clearTimeout(idle.get(element));
  element.setAttribute("data-scroll-active", "");
  idle.set(element, setTimeout(() => {
    element.removeAttribute("data-scroll-active");
    idle.delete(element);
  }, IDLE_MS));
};

/** Z3742a: OverlayScrollbars 2.17 requires per-element initialization and cannot
 * host a native textarea thumb (zero height). External slots have no positioning
 * or ancestor clipping API. Retain discovery/placement for those native hosts;
 * the library owns visibility, drag, geometry and its idle delay. See #3742/#4094. */
export const trackScrollbars = (doc: Document): void => {
  const entries = new Map<HTMLElement, { bars: Scrollbars; slot: HTMLElement; width: number; height: number }>();
  const roots = new Map<Document | ShadowRoot, MutationObserver>();

  const place = (element: HTMLElement, slot: HTMLElement) => {
    const box = element.getBoundingClientRect();
    const hidden = !element.checkVisibility() || !box.width || !box.height;

    if (slot.hidden !== hidden) slot.hidden = hidden;

    // Slots stay inside dialog/popup pointer boundaries. A translated ancestor
    // becomes the fixed containing block, so adjust from the slot's current box.
    const origin = slot.getBoundingClientRect();

    let left = box.left;
    let top = box.top;
    let right = box.right;
    let bottom = box.bottom;
    const owningRoot = element.getRootNode();
    let parent: Element | null = element.parentElement ?? (owningRoot instanceof ShadowRoot ? owningRoot.host : null);

    while (parent) {
      const style = getComputedStyle(parent);
      const clip = parent.getBoundingClientRect();

      if (/auto|scroll|hidden|clip/.test(style.overflowX)) {
        left = Math.max(left, clip.left);
        right = Math.min(right, clip.right);
      }

      if (/auto|scroll|hidden|clip/.test(style.overflowY)) {
        top = Math.max(top, clip.top);
        bottom = Math.min(bottom, clip.bottom);
      }

      const root = parent.getRootNode();

      parent = parent.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
    }

    const clip = [top - box.top, box.right - right, box.bottom - bottom, left - box.left]
      .map((inset) => `${Math.max(0, inset)}px`).join(" ");

    const styles = {
      left: `${(parseFloat(slot.style.left) || 0) + box.left + element.clientLeft - origin.left}px`,
      top: `${(parseFloat(slot.style.top) || 0) + box.top + element.clientTop - origin.top}px`,
      width: `${element.clientWidth}px`,
      height: `${element.clientHeight}px`,
      "clip-path": `inset(${clip})`,
    };

    for (const [name, value] of Object.entries(styles)) {
      if (slot.style.getPropertyValue(name) !== value) slot.style.setProperty(name, value);
    }
  };

  const resize = new ResizeObserver((records) => {
    for (const { target } of records) {
      if (!(target instanceof HTMLElement)) continue;
      const entry = entries.get(target);

      if (entry) {
        entry.width = target.scrollWidth;
        entry.height = target.scrollHeight;
        place(target, entry.slot);
      }
    }
  });

  const discover = (root: ParentNode) => {
    for (const element of root.querySelectorAll<HTMLElement>("*")) {
      if (element.closest(".scrollbar-slot, .os-size-observer, .os-trinsic-observer, .xterm")) continue;

      if (element.shadowRoot) observe(element.shadowRoot);

      if (entries.has(element) || element === doc.body || element === doc.documentElement) continue;

      const style = getComputedStyle(element);
      const x = /auto|scroll/.test(style.overflowX);
      const y = /auto|scroll/.test(style.overflowY);

      // Explicitly hidden bars (Rail and tab strips) retain their existing policy.
      if ((!x && !y) || style.scrollbarWidth === "none") continue;

      const slot = doc.createElement("div");

      slot.className = "scrollbar-slot";
      slot.setAttribute("aria-hidden", "true");
      element.parentNode?.appendChild(slot);

      const bars = OverlayScrollbars({ target: element, elements: { viewport: element }, scrollbars: { slot } }, {
        overflow: { x: x ? "scroll" : "hidden", y: y ? "scroll" : "hidden" },
        scrollbars: { theme: "app-scrollbar", autoHide: "scroll", autoHideDelay: IDLE_MS, autoHideSuspend: false, dragScroll: true, clickScroll: false },
      });

      entries.set(element, { bars, slot, width: element.scrollWidth, height: element.scrollHeight });
      resize.observe(element);
      place(element, slot);
    }
  };

  const flush = () => {
    for (const [element, { bars, slot }] of entries) {
      if (element.isConnected) place(element, slot);
      else {
        resize.unobserve(element);
        bars.destroy();
        slot.remove();
        entries.delete(element);
      }
    }

    for (const [root, observer] of roots) {
      if (root instanceof ShadowRoot && !root.host.isConnected) {
        observer.disconnect();
        roots.delete(root);
      }
    }
  };

  const observe = (root: Document | ShadowRoot) => {
    if (roots.has(root)) return;

    if (root instanceof ShadowRoot) {
      const sheet = new CSSStyleSheet();

      sheet.replaceSync(`${overlayStyles}\n${scrollbarStyles}`);
      root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
    }

    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.target instanceof Element && record.target.closest(".scrollbar-slot, .os-size-observer, .os-trinsic-observer, .xterm")) continue;

        // Inspect the parent too: a newly mounted node can itself be the viewport.
        if (record.type === "childList" && (record.target instanceof Element || record.target instanceof Document || record.target instanceof ShadowRoot)) discover(record.target);
      }

      flush();
    });

    observer.observe(root, { childList: true, subtree: true });
    roots.set(root, observer);

    const updateField = (event: Event) => {
      const target = event.composedPath()[0];

      // Textarea values bypass DOM observers. Forcing unchanged geometry would
      // mutate the sibling thumbs during every keystroke of a fitting draft.
      if (!(target instanceof HTMLTextAreaElement)) return;
      const entry = entries.get(target);

      if (entry && (entry.width !== target.scrollWidth || entry.height !== target.scrollHeight)) {
        entry.width = target.scrollWidth;
        entry.height = target.scrollHeight;
        entry.bars.update(true);
      }
    };

    root.addEventListener("input", updateField, true);
    root.addEventListener("scroll", () => {
      for (const [element, { slot }] of entries) place(element, slot);
    }, true);
    discover(root);
  };

  observe(doc);
  doc.defaultView?.addEventListener("resize", () => {
    discover(doc);
    flush();
  });
};
