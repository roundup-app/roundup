const scrolls = (el: Element): boolean => {
  const style = getComputedStyle(el);
  const y = /auto|scroll/.test(style.overflowY) && el.scrollHeight > el.clientHeight;
  const x = /auto|scroll/.test(style.overflowX) && el.scrollWidth > el.clientWidth;

  return y || x;
};

/** U3748: marks the innermost scrolling element under the pointer with `data-scroll-hover`, which `scrollbar.css` draws the bar for. CSS cannot select "scrolls", so the marker is set here. */
export const trackScrollHover = (doc: Document): void => {
  let owner: Element | null = null;

  const mark = (next: Element | null) => {
    if (next === owner) return;
    owner?.removeAttribute("data-scroll-hover");
    next?.setAttribute("data-scroll-hover", "");
    owner = next;
  };

  doc.addEventListener("pointerover", (event) => {
    let el = event.target instanceof Element ? event.target : null;

    while (el && !scrolls(el)) el = el.parentElement;
    mark(el);
  });
  doc.documentElement.addEventListener("pointerleave", () => mark(null));
};
