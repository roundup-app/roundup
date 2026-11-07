/** The nearest ancestor that scrolls along `axis`, else null. */
export const scrollerOf = (element: Element): Element | null => {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowX, overflowY } = getComputedStyle(node);

    if (/auto|scroll/.test(overflowX + overflowY) && (node.scrollHeight > node.clientHeight || node.scrollWidth > node.clientWidth)) return node;
  }

  return null;
};
